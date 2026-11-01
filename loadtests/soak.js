import http from 'k6/http';
export const options={scenarios:{soak:{executor:'constant-arrival-rate',rate:25,timeUnit:'1s',duration:'1h',preAllocatedVUs:30,maxVUs:60}},thresholds:{http_req_failed:['rate<0.02']}};
export default function(){http.get(`${__ENV.BASE_URL||'http://web:8088'}/api/products`);}
