import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {Snapshot,FaultType,CheckoutResponse,Product} from '../packages/common/src/schemas';
import {sleep} from '../packages/common/src/resilience';
const base=process.env.BASE_URL??'http://localhost:8088';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Integration fixtures require localhost; never reset public visitor quotas');
const measurements:object[]=[];
function docker(args:string[]){return execFileSync(process.platform==='win32'?'wsl':'docker',process.platform==='win32'?['-d','ResilienceLab','--cd',process.cwd(),'--','docker',...args]:args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
function resetQuota(){docker(['compose','exec','-T','redis','redis-cli','EVAL',"local keys=redis.call('KEYS','quota:*');for _,key in ipairs(keys) do redis.call('DEL',key) end;return #keys",'0']);}
async function snapshot(){return Snapshot.parse(await(await fetch(base+'/v1/snapshot')).json());}
async function until(fn:()=>Promise<boolean>,ms=150000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(1000);}throw Error('Integration condition timed out');}
async function inject(type:FaultType){return fetch(base+'/api/chaos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type})});}
async function ready(){await until(async()=>{const s=await snapshot();return !s.fault&&s.cooldownUntil<Date.now()&&s.metrics.p95!==null&&s.metrics.p95<250;});}
const invalid=await fetch(base+'/api/chaos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'SHELL',command:'anything'})});if(invalid.status!==400)throw Error('Fault schema must reject free-form input');
await ready();resetQuota();
const products=Product.array().parse(await(await fetch(base+'/api/products')).json());
async function checkout(){const cartId=randomUUID();const headers={'content-type':'application/json','x-cart-id':cartId,'idempotency-key':cartId};await fetch(base+'/api/cart',{method:'PUT',headers,body:JSON.stringify({items:[{productId:products[0].id,quantity:1}]})});return CheckoutResponse.parse(await(await fetch(base+'/api/checkout',{method:'POST',headers,body:JSON.stringify({cartId})})).json());}
for(const type of FaultType.options){await ready();resetQuota();const started=Date.now();const baseline=await snapshot();const response=await inject(type);if(!response.ok)throw Error(`${type}: injection failed ${response.status}: ${await response.text()}`);const second=await inject(type);if(second.status!==409)throw Error('Global fault slot failed');
if(type==='KILL_PAYMENT'){await Promise.all(Array.from({length:12},checkout));await until(async()=>(await snapshot()).breaker==='open',15000);const order=await checkout();if(order.status!=='queued')throw Error('Open breaker must queue checkout');measurements.push({type,queuedOrderId:order.orderId,checkoutMs:order.latencyMs});}
if(type==='ADD_CATALOG_LATENCY'||type==='SLOW_DATABASE'){const start=performance.now();const r=await fetch(base+'/api/products');if(!r.ok)throw Error('Latency fault browse failed');const elapsed=performance.now()-start;if(elapsed<200)throw Error('Expected real latency injection');measurements.push({type,requestMs:elapsed});}
if(type==='SPIKE_TRAFFIC'){await sleep(18000);const during=await snapshot();if(during.metrics.rps===null||baseline.metrics.rps===null||during.metrics.rps<=baseline.metrics.rps)throw Error('Traffic did not increase');measurements.push({type,baselineRps:baseline.metrics.rps,spikeRps:during.metrics.rps});}
await until(async()=>{const s=await snapshot();return s.recoveries.some(r=>r.fault_type===type&&Date.parse(r.created_at)>=started-1000);});const after=await snapshot();measurements.push({type,recovery:after.recoveries.find(r=>r.fault_type===type&&Date.parse(r.created_at)>=started-1000)});console.log(`${type}: verified real effect and recovery`);
}
await mkdir('docs/benchmarks',{recursive:true});await writeFile('docs/benchmarks/integration.json',JSON.stringify({measuredAt:new Date().toISOString(),target:base,measurements},null,2));console.log('All fault integration contracts passed. Visitor quotas reset only inside the isolated local fixture.');
