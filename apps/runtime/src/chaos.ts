import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { server, redis, emit, faultGauge } from './platform';
import { FaultRequest, Fault, type ActiveFault } from '../../../packages/common/src/schemas';
export function hashIp(ip: string) {
  const salt = process.env.IP_HASH_SECRET;
  if (!salt) throw Error('IP_HASH_SECRET is required');
  return createHmac('sha256', salt + Math.floor(Date.now() / 86400000))
    .update(ip)
    .digest('hex');
}
export function tokenMatches(value: unknown, expected: string | undefined) {
  return (
    typeof value === 'string' &&
    !!expected &&
    Buffer.byteLength(value) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  );
}
export async function kube(path: string, method = 'GET') {
  const token = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
  const ca = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  return new Promise<unknown>((resolve, reject) => {
    const req = https.request(
      {
        hostname: process.env.KUBERNETES_SERVICE_HOST,
        port: Number(process.env.KUBERNETES_SERVICE_PORT ?? 443),
        path,
        method,
        ca,
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 300) reject(Error(`Kubernetes API ${res.statusCode}`));
          else {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          }
        });
      },
    );
    req.setTimeout(5000, () => req.destroy(Error('Kubernetes timeout')));
    req.on('error', reject);
    req.end();
  });
}
async function killPayment() {
  if (process.env.CHAOS_ADAPTER === 'kubernetes') {
    // The chaos service account can only delete payment pods through a dedicated proxy.
    // Kubernetes RBAC cannot restrict delete permission by label: the proxy validates it.
    const url = process.env.POD_KILL_PROXY_URL;
    if (!url) throw Error('Payment-only kill proxy is required');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-internal-token': process.env.INTERNAL_TOKEN ?? '' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw Error(`Kill proxy ${res.status}`);
  } else {
    // A separate Docker adapter owns the socket; this app never mounts docker.sock.
    const res = await fetch(
      process.env.LOCAL_KILL_URL ?? 'http://local-adapter:8099/kill-payment',
      {
        method: 'POST',
        headers: { 'x-internal-token': process.env.INTERNAL_TOKEN ?? '' },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) throw Error(`Docker adapter ${res.status}`);
  }
}
export async function chaos() {
  const { app, listen } = await server(8090);
  app.get('/v1/faults/active', async () => ({
    active: JSON.parse((await redis.get('fault.active')) ?? 'null'),
    cooldownUntil: Number((await redis.get('fault.cooldown')) ?? 0),
    chaosEnabled: process.env.CHAOS_ENABLED !== 'false',
  }));
  app.get('/v1/limits', () => ({
    oneGlobalFault: true,
    cooldownSeconds: 15,
    perIp: 3,
    windowSeconds: 600,
    chaosEnabled: process.env.CHAOS_ENABLED !== 'false',
  }));
  app.post('/v1/faults', async (req, reply) => {
    if (!tokenMatches(req.headers['x-internal-token'], process.env.INTERNAL_TOKEN))
      return reply.code(403).send({ error: 'Gateway authentication required' });
    if (process.env.CHAOS_ENABLED === 'false')
      return reply.code(403).send({ error: 'Chaos is disabled' });
    const { type } = FaultRequest.parse(req.body);
    const owner = String(req.headers['x-visitor-hash'] ?? '');
    if (!/^[a-f0-9]{64}$/.test(owner))
      return reply.code(400).send({ error: 'Invalid visitor identity' });
    const startedAt = Date.now();
    const fault: ActiveFault = {
      id: randomUUID(),
      type,
      owner,
      startedAt,
      expiresAt:
        startedAt + (type === 'KILL_PAYMENT' ? 90000 : type === 'SPIKE_TRAFFIC' ? 60000 : 30000),
    };
    // Slot acquisition, cooldown and visitor quota are one atomic operation.
    const result = await redis.eval(
      `if redis.call('EXISTS',KEYS[1])==1 then return 1 end
if tonumber(redis.call('GET',KEYS[2]) or '0')>tonumber(ARGV[1]) then return 2 end
if tonumber(redis.call('GET',KEYS[3]) or '0')>=3 then return 3 end
redis.call('SET',KEYS[1],ARGV[2],'PX',ARGV[3]);redis.call('INCR',KEYS[3]);if redis.call('TTL',KEYS[3])<0 then redis.call('EXPIRE',KEYS[3],600) end;return 0`,
      3,
      'fault.active',
      'fault.cooldown',
      `quota:${owner}`,
      startedAt,
      JSON.stringify(fault),
      fault.expiresAt - startedAt + 20000,
    );
    if (result !== 0)
      return reply.code(result === 3 ? 429 : 409).send({
        error:
          result === 1
            ? 'Another visitor is running a fault'
            : result === 2
              ? 'System is cooling down'
              : 'Three faults per ten minutes; try later',
      });
    try {
      await redis.set(`fault:${type}`, '1', 'PX', fault.expiresAt - startedAt);
      await redis.set('recovery.pending', JSON.stringify(fault), 'EX', 600);
      if (type === 'KILL_PAYMENT') await killPayment();
      faultGauge.set({ type }, 1);
      await emit('fault-injected', `${type.replaceAll('_', ' ').toLowerCase()} injected`, 'warn');
      return { active: fault };
    } catch (error) {
      await redis.del('fault.active', `fault:${type}`, 'recovery.pending');
      await emit('fault-failed', 'Fault adapter failed; slot released', 'error');
      throw error;
    }
  });
  app.post('/v1/faults/clear', async (req, reply) => {
    if (!tokenMatches(req.headers['x-admin-token'], process.env.ADMIN_TOKEN))
      return reply.code(403).send({ error: 'Admin token required' });
    const f = await redis.get('fault.active');
    if (f) await clear(Fault.parse(JSON.parse(f)));
    return { cleared: true };
  });
  async function clear(f: ActiveFault) {
    const cleared = await redis.eval(
      `local raw=redis.call('GET',KEYS[1]);if raw and cjson.decode(raw).id==ARGV[1] then redis.call('DEL',KEYS[1],KEYS[2]);redis.call('SET',KEYS[3],ARGV[2],'PX',15000);return 1 end;return 0`,
      3,
      'fault.active',
      `fault:${f.type}`,
      'fault.cooldown',
      f.id,
      Date.now() + 15000,
    );
    if (cleared) {
      faultGauge.set({ type: f.type }, 0);
      await emit(
        'fault-cleared',
        `${f.type.replaceAll('_', ' ').toLowerCase()} cleared; cooldown started`,
      );
    }
  }
  const timer = setInterval(() => {
    void (async () => {
      const raw = await redis.get('fault.active');
      if (!raw) return;
      const f = Fault.parse(JSON.parse(raw));
      let recovered = false;
      if (f.type === 'KILL_PAYMENT') {
        try {
          const res = await fetch((process.env.PAYMENT_URL ?? 'http://payment:8083') + '/readyz', {
            signal: AbortSignal.timeout(750),
          });
          recovered = res.ok;
        } catch {
          /* still restarting */
        }
      }
      if (Date.now() >= f.expiresAt || recovered) await clear(f);
    })().catch((error) => app.log.error(error));
  }, 1000);
  app.addHook('onClose', async () => clearInterval(timer));
  await listen();
}
