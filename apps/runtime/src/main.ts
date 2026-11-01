// OTel is preloaded before Fastify/pg/ioredis through --import in containers.
import { service } from './platform';
const entries: Record<string, () => Promise<unknown>> = {
  gateway: () => import('../../gateway/src/index').then((m) => m.start()),
  catalog: () => import('../../catalog/src/index').then((m) => m.start()),
  cart: () => import('../../cart/src/index').then((m) => m.start()),
  payment: () => import('../../payment/src/index').then((m) => m.start()),
  'order-worker': () => import('../../order-worker/src/index').then((m) => m.start()),
  'chaos-controller': () => import('../../chaos-controller/src/index').then((m) => m.start()),
  'traffic-generator': () => import('../../traffic-generator/src/index').then((m) => m.start()),
  'telemetry-api': () => import('../../telemetry-api/src/index').then((m) => m.start()),
};
entries['pod-kill-proxy'] = () => import('./kill-proxy').then((m) => m.killProxy());
if (!entries[service]) throw Error(`Unknown service ${service}`);
await entries[service]();
