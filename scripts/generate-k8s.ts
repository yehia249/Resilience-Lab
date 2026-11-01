import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { stringify } from 'yaml';
const resources: object[] = [];
function add(
  kind: string,
  name: string,
  spec: Record<string, unknown>,
  namespace = 'lab',
  apiVersion = 'v1',
) {
  resources.push({
    apiVersion,
    kind,
    metadata: { name, namespace, ...(kind === 'Deployment' ? { labels: { app: name } } : {}) },
    ...spec,
  });
}
for (const name of ['lab', 'lab-payment'])
  resources.push({
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name,
      labels: {
        'kubernetes.io/metadata.name': name,
        'pod-security.kubernetes.io/enforce': 'baseline',
      },
    },
  });
const env = {
  REDIS_URL: 'redis://redis.lab.svc.cluster.local:6379',
  SITE_ORIGIN: 'https://REPLACE_HOST',
  CHAOS_ENABLED: 'true',
  CHAOS_ADAPTER: 'kubernetes',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector.lab.svc.cluster.local:4318',
  POD_KILL_PROXY_URL: 'http://pod-kill-proxy.lab-payment.svc.cluster.local:8099/kill-payment',
  TRUST_PROXY: 'true',
  BASELINE_RPS: '25',
};
for (const ns of ['lab', 'lab-payment']) add('ConfigMap', 'lab-config', { data: env }, ns);
add('ConfigMap', 'postgres-init', {
  data: { 'init.sql': await readFile('scripts/init.sql', 'utf8') },
});
add('ConfigMap', 'web-config', {
  data: {
    'default.conf': (await readFile('infra/nginx.conf', 'utf8'))
      .replace('127.0.0.11', '10.43.0.10')
      .replace('http://gateway:8080', 'http://gateway.lab.svc.cluster.local:8080')
      .replace('http://telemetry-api:8095', 'http://telemetry-api.lab.svc.cluster.local:8095')
      .replace(
        '  listen 8088;',
        '  listen 8088;\n  set_real_ip_from 10.42.0.0/16;\n  real_ip_header X-Forwarded-For;\n  real_ip_recursive on;',
      ),
  },
});
for (const name of ['prometheus', 'otel'])
  add('ConfigMap', name + '-config', {
    data: {
      [name === 'prometheus' ? 'prometheus.yml' : 'otel.yaml']: await readFile(
        `infra/observability/${name === 'prometheus' ? 'prometheus.yml' : 'otel.yaml'}`,
        'utf8',
      ),
    },
  });
const secure = {
  allowPrivilegeEscalation: false,
  readOnlyRootFilesystem: true,
  capabilities: { drop: ['ALL'] },
  seccompProfile: { type: 'RuntimeDefault' },
};
type DeploymentOptions = {
  namespace?: string;
  replicas?: number;
  requests?: { cpu: string; memory: string };
  limits?: { cpu: string; memory: string };
  env?: object[];
  command?: string[];
  args?: string[];
  volumes?: object[];
  volumeMounts?: object[];
  serviceAccountName?: string;
  probe?: object;
  uid?: number;
  readOnly?: boolean;
};
function deployment(name: string, image: string, port: number, o: DeploymentOptions = {}) {
  const ns = o.namespace ?? 'lab';
  add(
    'Deployment',
    name,
    {
      spec: {
        replicas: o.replicas ?? 1,
        selector: { matchLabels: { app: name } },
        strategy: ['postgres', 'redis', 'prometheus'].includes(name)
          ? { type: 'Recreate' }
          : { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
        template: {
          metadata: { labels: { app: name } },
          spec: {
            automountServiceAccountToken: !!o.serviceAccountName,
            serviceAccountName: o.serviceAccountName,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: o.uid ?? 1000,
              fsGroup: o.uid ?? 1000,
            },
            containers: [
              {
                name,
                image,
                imagePullPolicy: 'IfNotPresent',
                ports: [{ containerPort: port }],
                securityContext: { ...secure, readOnlyRootFilesystem: o.readOnly ?? true },
                resources: {
                  requests: o.requests ?? { cpu: '50m', memory: '96Mi' },
                  limits: o.limits ?? { cpu: '300m', memory: '256Mi' },
                },
                envFrom:
                  name === 'web' ||
                  ['postgres', 'redis', 'prometheus', 'jaeger', 'otel-collector'].includes(name)
                    ? undefined
                    : [
                        { configMapRef: { name: 'lab-config' } },
                        { secretRef: { name: 'lab-secrets' } },
                      ],
                env: o.env ?? [
                  { name: 'SERVICE', value: name },
                  { name: 'PORT', value: String(port) },
                ],
                command: o.command,
                args: o.args,
                readinessProbe: o.probe ?? {
                  httpGet: { path: '/readyz', port },
                  initialDelaySeconds: 5,
                  periodSeconds: 5,
                },
                livenessProbe: o.probe ?? {
                  httpGet: { path: '/healthz', port },
                  initialDelaySeconds: 25,
                  periodSeconds: 10,
                },
                startupProbe: o.probe ?? {
                  httpGet: { path: '/healthz', port },
                  failureThreshold: 30,
                  periodSeconds: 3,
                },
                volumeMounts: [{ name: 'tmp', mountPath: '/tmp' }, ...(o.volumeMounts ?? [])],
              },
            ],
            volumes: [{ name: 'tmp', emptyDir: {} }, ...(o.volumes ?? [])],
          },
        },
      },
    },
    ns,
    'apps/v1',
  );
  add(
    'Service',
    name,
    { spec: { selector: { app: name }, ports: [{ port, targetPort: port }] } },
    ns,
  );
}
const appConfigs: [string, number, number, string, string, string, string][] = [
  ['gateway', 8080, 2, '100m', '128Mi', '400m', '256Mi'],
  ['catalog', 8081, 2, '100m', '128Mi', '300m', '256Mi'],
  ['cart', 8082, 1, '50m', '96Mi', '200m', '192Mi'],
  ['payment', 8083, 2, '100m', '128Mi', '300m', '256Mi'],
  ['order-worker', 8084, 1, '50m', '96Mi', '200m', '192Mi'],
  ['chaos-controller', 8090, 1, '20m', '64Mi', '100m', '128Mi'],
  ['traffic-generator', 8091, 1, '100m', '128Mi', '300m', '256Mi'],
  ['telemetry-api', 8095, 1, '100m', '128Mi', '300m', '256Mi'],
];
for (const [name, port, replicas, cpu, memory, limitCpu, limitMemory] of appConfigs) {
  const ns = name === 'payment' ? 'lab-payment' : 'lab';
  deployment(name, 'ghcr.io/yehia249/resilience-lab-service:main', port, {
    replicas,
    namespace: ns,
    requests: { cpu, memory },
    limits: { cpu: limitCpu, memory: limitMemory },
    serviceAccountName: name === 'telemetry-api' ? 'telemetry' : undefined,
  });
  add(
    'PodDisruptionBudget',
    name,
    { spec: { minAvailable: replicas > 1 ? 1 : 0, selector: { matchLabels: { app: name } } } },
    ns,
    'policy/v1',
  );
}
add('Service', 'payment', {
  spec: { type: 'ExternalName', externalName: 'payment.lab-payment.svc.cluster.local' },
});
for (const [name, max] of [
  ['gateway', 5],
  ['catalog', 4],
  ['cart', 3],
  ['payment', 4],
] as const) {
  add(
    'HorizontalPodAutoscaler',
    name,
    {
      spec: {
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name },
        minReplicas: name === 'cart' ? 1 : 2,
        maxReplicas: max,
        metrics: [
          {
            type: 'Resource',
            resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 60 } },
          },
        ],
        behavior: {
          scaleUp: {
            stabilizationWindowSeconds: 0,
            policies: [{ type: 'Pods', value: 2, periodSeconds: 15 }],
          },
          scaleDown: {
            stabilizationWindowSeconds: 120,
            policies: [{ type: 'Pods', value: 1, periodSeconds: 30 }],
          },
        },
      },
    },
    name === 'payment' ? 'lab-payment' : 'lab',
    'autoscaling/v2',
  );
}
for (const [name, size] of [
  ['postgres', '10Gi'],
  ['redis', '1Gi'],
  ['prometheus', '3Gi'],
])
  add('PersistentVolumeClaim', name, {
    spec: {
      accessModes: ['ReadWriteOnce'],
      resources: { requests: { storage: size } },
      storageClassName: 'local-path',
    },
  });
deployment('postgres', 'postgres:16.11-alpine', 5432, {
  uid: 70,
  readOnly: false,
  requests: { cpu: '100m', memory: '256Mi' },
  limits: { cpu: '500m', memory: '512Mi' },
  env: [
    { name: 'POSTGRES_USER', value: 'lab' },
    { name: 'POSTGRES_DB', value: 'lab' },
    { name: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' },
    {
      name: 'POSTGRES_PASSWORD',
      valueFrom: { secretKeyRef: { name: 'lab-secrets', key: 'POSTGRES_PASSWORD' } },
    },
  ],
  probe: { exec: { command: ['pg_isready', '-U', 'lab', '-d', 'lab'] }, periodSeconds: 5 },
  volumes: [
    { name: 'data', persistentVolumeClaim: { claimName: 'postgres' } },
    { name: 'init', configMap: { name: 'postgres-init' } },
  ],
  volumeMounts: [
    { name: 'data', mountPath: '/var/lib/postgresql/data' },
    { name: 'init', mountPath: '/docker-entrypoint-initdb.d' },
    { name: 'tmp', mountPath: '/var/run/postgresql' },
  ],
});
deployment('redis', 'redis:7.4.6-alpine', 6379, {
  uid: 999,
  requests: { cpu: '50m', memory: '64Mi' },
  limits: { cpu: '200m', memory: '128Mi' },
  args: [
    'redis-server',
    '--appendonly',
    'yes',
    '--maxmemory',
    '80mb',
    '--maxmemory-policy',
    'noeviction',
  ],
  probe: { exec: { command: ['redis-cli', 'ping'] }, periodSeconds: 5 },
  volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'redis' } }],
  volumeMounts: [{ name: 'data', mountPath: '/data' }],
});
deployment('prometheus', 'prom/prometheus:v3.7.2', 9090, {
  serviceAccountName: 'prometheus',
  uid: 65534,
  requests: { cpu: '200m', memory: '512Mi' },
  limits: { cpu: '500m', memory: '768Mi' },
  args: [
    '--config.file=/etc/prometheus/prometheus.yml',
    '--storage.tsdb.retention.time=6h',
    '--storage.tsdb.retention.size=2GB',
  ],
  probe: { httpGet: { path: '/-/ready', port: 9090 }, periodSeconds: 5 },
  volumes: [
    { name: 'config', configMap: { name: 'prometheus-config' } },
    { name: 'data', persistentVolumeClaim: { claimName: 'prometheus' } },
  ],
  volumeMounts: [
    { name: 'config', mountPath: '/etc/prometheus' },
    { name: 'data', mountPath: '/prometheus' },
  ],
});
deployment('jaeger', 'jaegertracing/all-in-one:1.76.0', 16686, {
  uid: 10001,
  requests: { cpu: '100m', memory: '256Mi' },
  limits: { cpu: '300m', memory: '512Mi' },
  env: [
    { name: 'COLLECTOR_OTLP_ENABLED', value: 'true' },
    { name: 'MEMORY_MAX_TRACES', value: '20000' },
  ],
  probe: { httpGet: { path: '/', port: 14269 }, periodSeconds: 5 },
});
add('Service', 'jaeger-otlp', {
  spec: { selector: { app: 'jaeger' }, ports: [{ port: 4317, targetPort: 4317 }] },
});
// Collector uses the dedicated Jaeger OTLP service name in Kubernetes.
const collector = resources.find(
  (r) =>
    (r as { kind: string; metadata: { name: string } }).kind === 'ConfigMap' &&
    (r as { metadata: { name: string } }).metadata.name === 'otel-config',
) as { data: Record<string, string> };
collector.data['otel.yaml'] = collector.data['otel.yaml'].replace(
  'jaeger:4317',
  'jaeger-otlp:4317',
);
deployment('otel-collector', 'otel/opentelemetry-collector-contrib:0.139.0', 4318, {
  uid: 10001,
  requests: { cpu: '50m', memory: '128Mi' },
  limits: { cpu: '200m', memory: '256Mi' },
  args: ['--config=/etc/otel/otel.yaml'],
  probe: { tcpSocket: { port: 4318 }, periodSeconds: 5 },
  volumes: [{ name: 'config', configMap: { name: 'otel-config' } }],
  volumeMounts: [{ name: 'config', mountPath: '/etc/otel' }],
});
add('Service', 'otel-metrics', {
  spec: { selector: { app: 'otel-collector' }, ports: [{ port: 8889, targetPort: 8889 }] },
});
const prom = resources.find(
  (r) =>
    (r as { kind: string; metadata: { name: string } }).kind === 'ConfigMap' &&
    (r as { metadata: { name: string } }).metadata.name === 'prometheus-config',
) as { data: Record<string, string> };
prom.data['prometheus.yml'] = stringify({
  global: { scrape_interval: '2s', evaluation_interval: '2s' },
  scrape_configs: [
    {
      job_name: 'services',
      kubernetes_sd_configs: [{ role: 'pod', namespaces: { names: ['lab', 'lab-payment'] } }],
      relabel_configs: [
        {
          source_labels: ['__meta_kubernetes_pod_label_app'],
          action: 'keep',
          regex: appConfigs.map((v) => v[0]).join('|'),
        },
        { source_labels: ['__meta_kubernetes_pod_label_app'], target_label: 'service' },
        { source_labels: ['__meta_kubernetes_pod_phase'], action: 'keep', regex: 'Running' },
      ],
    },
    { job_name: 'otel', static_configs: [{ targets: ['otel-metrics:8889'] }] },
  ],
});
add('ServiceAccount', 'prometheus', {});
for (const ns of ['lab', 'lab-payment']) {
  add(
    'Role',
    'prometheus-read',
    { rules: [{ apiGroups: [''], resources: ['pods'], verbs: ['get', 'list', 'watch'] }] },
    ns,
    'rbac.authorization.k8s.io/v1',
  );
  add(
    'RoleBinding',
    'prometheus-read',
    {
      subjects: [{ kind: 'ServiceAccount', name: 'prometheus', namespace: 'lab' }],
      roleRef: { kind: 'Role', name: 'prometheus-read', apiGroup: 'rbac.authorization.k8s.io' },
    },
    ns,
    'rbac.authorization.k8s.io/v1',
  );
}
deployment('web', 'ghcr.io/yehia249/resilience-lab-web:main', 8088, {
  uid: 101,
  requests: { cpu: '20m', memory: '32Mi' },
  limits: { cpu: '100m', memory: '64Mi' },
  probe: { httpGet: { path: '/', port: 8088 }, periodSeconds: 5 },
  volumes: [{ name: 'config', configMap: { name: 'web-config' } }],
  volumeMounts: [{ name: 'config', mountPath: '/etc/nginx/conf.d' }],
});
deployment('pod-kill-proxy', 'ghcr.io/yehia249/resilience-lab-service:main', 8099, {
  namespace: 'lab-payment',
  requests: { cpu: '10m', memory: '64Mi' },
  limits: { cpu: '100m', memory: '128Mi' },
  serviceAccountName: 'payment-killer',
  env: [
    { name: 'SERVICE', value: 'pod-kill-proxy' },
    { name: 'PORT', value: '8099' },
  ],
});
add('ServiceAccount', 'payment-killer', {}, 'lab-payment');
add(
  'Role',
  'payment-killer',
  {
    rules: [
      { apiGroups: [''], resources: ['pods'], verbs: ['list', 'delete'] },
      {
        apiGroups: ['apps'],
        resources: ['deployments'],
        resourceNames: ['payment'],
        verbs: ['get'],
      },
    ],
  },
  'lab-payment',
  'rbac.authorization.k8s.io/v1',
);
add(
  'RoleBinding',
  'payment-killer',
  {
    subjects: [{ kind: 'ServiceAccount', name: 'payment-killer', namespace: 'lab-payment' }],
    roleRef: { kind: 'Role', name: 'payment-killer', apiGroup: 'rbac.authorization.k8s.io' },
  },
  'lab-payment',
  'rbac.authorization.k8s.io/v1',
);
add('ServiceAccount', 'telemetry', {});
for (const ns of ['lab', 'lab-payment']) {
  add(
    'Role',
    'telemetry-read',
    {
      rules: [
        { apiGroups: ['apps'], resources: ['deployments'], verbs: ['get', 'list'] },
        { apiGroups: [''], resources: ['pods', 'events'], verbs: ['get', 'list', 'watch'] },
        { apiGroups: ['metrics.k8s.io'], resources: ['pods'], verbs: ['get', 'list'] },
      ],
    },
    ns,
    'rbac.authorization.k8s.io/v1',
  );
  add(
    'RoleBinding',
    'telemetry-read',
    {
      subjects: [{ kind: 'ServiceAccount', name: 'telemetry', namespace: 'lab' }],
      roleRef: { kind: 'Role', name: 'telemetry-read', apiGroup: 'rbac.authorization.k8s.io' },
    },
    ns,
    'rbac.authorization.k8s.io/v1',
  );
}
// Namespaced default-deny, DNS, and explicit application flows. No public data stores.
for (const ns of ['lab', 'lab-payment']) {
  add(
    'NetworkPolicy',
    'default-deny',
    { spec: { podSelector: {}, policyTypes: ['Ingress', 'Egress'] } },
    ns,
    'networking.k8s.io/v1',
  );
  add(
    'NetworkPolicy',
    'dns',
    {
      spec: {
        podSelector: {},
        policyTypes: ['Egress'],
        egress: [
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' },
                },
                podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
              },
            ],
            ports: [
              { port: 53, protocol: 'UDP' },
              { port: 53, protocol: 'TCP' },
            ],
          },
        ],
      },
    },
    ns,
    'networking.k8s.io/v1',
  );
}
function flow(
  name: string,
  from: string[],
  to: string[],
  ports: number[],
  fromNs = 'lab',
  toNs = 'lab',
) {
  const dest = {
    namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': toNs } },
    podSelector: { matchExpressions: [{ key: 'app', operator: 'In', values: to }] },
  };
  const source = {
    namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': fromNs } },
    podSelector: { matchExpressions: [{ key: 'app', operator: 'In', values: from }] },
  };
  add(
    'NetworkPolicy',
    name + '-out',
    {
      spec: {
        podSelector: source.podSelector,
        policyTypes: ['Egress'],
        egress: [{ to: [dest], ports: ports.map((port) => ({ port })) }],
      },
    },
    fromNs,
    'networking.k8s.io/v1',
  );
  add(
    'NetworkPolicy',
    name + '-in',
    {
      spec: {
        podSelector: dest.podSelector,
        policyTypes: ['Ingress'],
        ingress: [{ from: [source], ports: ports.map((port) => ({ port })) }],
      },
    },
    toNs,
    'networking.k8s.io/v1',
  );
}
flow('web-api', ['web'], ['gateway', 'telemetry-api'], [8080, 8095]);
flow('gateway-services', ['gateway'], ['catalog', 'cart', 'chaos-controller'], [8081, 8082, 8090]);
flow(
  'payment-calls',
  ['gateway', 'order-worker', 'chaos-controller'],
  ['payment'],
  [8083],
  'lab',
  'lab-payment',
);
flow('kill-proxy', ['chaos-controller'], ['pod-kill-proxy'], [8099], 'lab', 'lab-payment');
flow('traffic', ['traffic-generator'], ['gateway'], [8080]);
flow(
  'data',
  appConfigs.filter((v) => v[0] !== 'payment').map((v) => v[0]),
  ['postgres', 'redis'],
  [5432, 6379],
);
flow(
  'payment-data',
  ['payment', 'pod-kill-proxy'],
  ['postgres', 'redis'],
  [5432, 6379],
  'lab-payment',
  'lab',
);
flow(
  'otel',
  appConfigs.map((v) => v[0]),
  ['otel-collector'],
  [4318],
);
flow(
  'payment-otel',
  ['payment', 'pod-kill-proxy'],
  ['otel-collector'],
  [4318],
  'lab-payment',
  'lab',
);
flow('collector-jaeger', ['otel-collector'], ['jaeger'], [4317]);
flow('telemetry-obs', ['telemetry-api'], ['prometheus', 'jaeger'], [9090, 16686]);
flow(
  'prom-scrape',
  ['prometheus'],
  appConfigs
    .filter((v) => v[0] !== 'payment')
    .map((v) => v[0])
    .concat('otel-collector'),
  [8080, 8081, 8082, 8084, 8090, 8091, 8095, 8889],
);
flow('prom-payment', ['prometheus'], ['payment'], [8083], 'lab', 'lab-payment');
add(
  'NetworkPolicy',
  'ingress-web',
  {
    spec: {
      podSelector: { matchLabels: { app: 'web' } },
      policyTypes: ['Ingress'],
      ingress: [
        {
          from: [
            {
              namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
              podSelector: { matchLabels: { 'app.kubernetes.io/name': 'traefik' } },
            },
          ],
          ports: [{ port: 8088 }],
        },
      ],
    },
  },
  'lab',
  'networking.k8s.io/v1',
);
// Kube API destinations are injected as /32 addresses by deploy.sh from the cluster endpoint.
for (const ns of ['lab', 'lab-payment'])
  add(
    'NetworkPolicy',
    'kube-api',
    {
      spec: {
        podSelector: {
          matchExpressions: [
            {
              key: 'app',
              operator: 'In',
              values: ns === 'lab' ? ['telemetry-api', 'prometheus'] : ['pod-kill-proxy'],
            },
          ],
        },
        policyTypes: ['Egress'],
        egress: [
          { to: [{ ipBlock: { cidr: '10.43.0.1/32' } }], ports: [{ port: 443 }, { port: 6443 }] },
        ],
      },
    },
    ns,
    'networking.k8s.io/v1',
  );
add(
  'Ingress',
  'web',
  {
    spec: {
      ingressClassName: 'traefik',
      rules: [
        {
          host: 'REPLACE_HOST',
          http: {
            paths: [
              {
                path: '/',
                pathType: 'Prefix',
                backend: { service: { name: 'web', port: { number: 8088 } } },
              },
            ],
          },
        },
      ],
    },
  },
  'lab',
  'networking.k8s.io/v1',
);
await mkdir('infra/k8s/base', { recursive: true });
await writeFile('infra/k8s/base/resources.yaml', resources.map((r) => stringify(r)).join('---\n'));
await writeFile(
  'infra/k8s/base/kustomization.yaml',
  'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - resources.yaml\n',
);
for (const name of ['local', 'prod']) {
  await mkdir(`infra/k8s/overlays/${name}`, { recursive: true });
  await writeFile(
    `infra/k8s/overlays/${name}/kustomization.yaml`,
    `apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - ../../base\n${name === 'local' ? 'images:\n  - name: ghcr.io/yehia249/resilience-lab-service\n    newName: resilience-lab/service\n    newTag: local\n  - name: ghcr.io/yehia249/resilience-lab-web\n    newName: resilience-lab/web\n    newTag: local\n' : ''}`,
  );
}
console.log(`Generated ${resources.length} Kubernetes resources`);
