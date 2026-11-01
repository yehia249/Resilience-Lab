// Local development only: narrowly scoped HTTP interface; never publicly exposed.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
const key = process.env.INTERNAL_TOKEN;
function docker(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: '/var/run/docker.sock', path, method }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () =>
        res.statusCode >= 300
          ? reject(Error('Docker ' + res.statusCode))
          : resolve(data ? JSON.parse(data) : null),
      );
    });
    req.on('error', reject);
    req.end();
  });
}
async function containers() {
  return docker(
    '/containers/json?all=true&filters=' +
      encodeURIComponent(JSON.stringify({ label: ['com.docker.compose.project=resilience-lab'] })),
  );
}
http
  .createServer(async (req, res) => {
    try {
      const provided = req.headers['x-internal-token'];
      if (
        !key ||
        typeof provided !== 'string' ||
        provided.length !== key.length ||
        !timingSafeEqual(Buffer.from(key), Buffer.from(provided))
      ) {
        res.writeHead(403).end();
        return;
      }
      if (req.url === '/kill-payment' && req.method === 'POST') {
        const list = await containers();
        const payment = list.filter((c) => c.Labels['com.docker.compose.service'] === 'payment');
        if (!payment.length) throw Error('No payment containers');
        for (const c of payment) {
          await docker(`/containers/${c.Id}/kill`, 'POST');
          setTimeout(
            () => void docker(`/containers/${c.Id}/start`, 'POST').catch(console.error),
            12000,
          );
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"killed":true}');
        return;
      }
      if (req.url === '/topology' && req.method === 'GET') {
        const list = await containers();
        const result = await Promise.all(
          ['gateway', 'catalog', 'cart', 'payment', 'postgres', 'redis'].map(async (name) => {
            const matches = list.filter((c) => c.Labels['com.docker.compose.service'] === name);
            let ready = 0;
            for (const c of matches) {
              const info = await docker(`/containers/${c.Id}/json`);
              if (
                info.State.Running &&
                (!info.State.Health || info.State.Health.Status === 'healthy')
              )
                ready++;
            }
            return { name, ready, desired: matches.length, cpuPct: null, memoryBytes: null };
          }),
        );
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
        return;
      }
      res.writeHead(404).end();
    } catch (error) {
      console.error(error);
      res.writeHead(503).end('{"error":"Docker adapter failed"}');
    }
  })
  .listen(8099, '0.0.0.0');
