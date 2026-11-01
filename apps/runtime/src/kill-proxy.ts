import { server } from './platform';
import { kube, tokenMatches } from './chaos';
export async function killProxy() {
  const { app, listen } = await server(8099);
  app.get('/status', async (req, reply) => {
    if (!tokenMatches(req.headers['x-internal-token'], process.env.INTERNAL_TOKEN))
      return reply.code(403).send({ error: 'Forbidden' });
    const [deployment, pods] = (await Promise.all([
      kube('/apis/apps/v1/namespaces/lab-payment/deployments/payment'),
      kube('/api/v1/namespaces/lab-payment/pods?labelSelector=app%3Dpayment'),
    ])) as [
      { spec: { replicas: number } },
      {
        items: {
          metadata: { deletionTimestamp?: string };
          status?: { phase?: string; conditions?: { type: string; status: string }[] };
        }[];
      },
    ];
    const ready = pods.items.filter(
      (p) =>
        !p.metadata.deletionTimestamp &&
        p.status?.phase === 'Running' &&
        p.status.conditions?.some((c) => c.type === 'Ready' && c.status === 'True'),
    ).length;
    return { ready, desired: deployment.spec.replicas };
  });
  app.post('/kill-payment', async (req, reply) => {
    if (!tokenMatches(req.headers['x-internal-token'], process.env.INTERNAL_TOKEN))
      return reply.code(403).send({ error: 'Forbidden' });
    const list = (await kube(
      '/api/v1/namespaces/lab-payment/pods?labelSelector=app%3Dpayment',
    )) as { items: { metadata: { name: string; labels: Record<string, string> } }[] };
    if (!list.items.length) return reply.code(503).send({ error: 'No payment pods' });
    for (const p of list.items) {
      if (p.metadata.labels.app !== 'payment') throw Error('Unexpected label');
      await kube(
        `/api/v1/namespaces/lab-payment/pods/${encodeURIComponent(p.metadata.name)}`,
        'DELETE',
      );
    }
    return { killed: list.items.length };
  });
  await listen();
}
