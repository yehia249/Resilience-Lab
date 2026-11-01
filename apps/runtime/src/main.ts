// OTel is preloaded before Fastify/pg/ioredis through --import in containers.
import { service } from './platform';
const entries: Record<string, () => Promise<unknown>> = {
  gateway: () => import('./shop').then((m) => m.gateway()),
  catalog: () => import('./shop').then((m) => m.catalog()),
  cart: () => import('./shop').then((m) => m.cart()),
  payment: () => import('./shop').then((m) => m.payment()),
  'order-worker': () => import('./worker').then((m) => m.worker()),
  'chaos-controller': () => import('./chaos').then((m) => m.chaos()),
  'traffic-generator': () => import('./traffic').then((m) => m.traffic()),
  'telemetry-api': () => import('./telemetry').then((m) => m.telemetry()),
};
entries['pod-kill-proxy'] = () => import('./kill-proxy').then((m) => m.killProxy());
if (!entries[service]) throw Error(`Unknown service ${service}`);
await entries[service]();
