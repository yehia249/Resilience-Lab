import http from 'k6/http';
import {check} from 'k6';
export const options={scenarios:{baseline:{executor:'constant-arrival-rate',rate:25,timeUnit:'1s',duration:'5m',preAllocatedVUs:30,maxVUs:60}},thresholds:{http_req_failed:['rate<0.02'],http_req_duration:['p(95)<250']}};
export default function(){check(http.get(`${__ENV.BASE_URL||'http://web:8088'}/api/products`),{'catalog responds':r=>r.status===200});}
