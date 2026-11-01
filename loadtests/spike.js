import http from 'k6/http';
export const options={scenarios:{spike:{executor:'ramping-arrival-rate',startRate:25,timeUnit:'1s',preAllocatedVUs:50,maxVUs:150,stages:[{target:125,duration:'15s'},{target:125,duration:'60s'},{target:25,duration:'15s'}]}}};
export default function(){http.get(`${__ENV.BASE_URL||'http://web:8088'}/api/products`);}
