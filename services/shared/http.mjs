import {value,number} from './config.mjs';
import Fastify from 'fastify';
import {timingSafeEqual,createHash} from 'node:crypto';
import {Registry,Counter,Histogram,collectDefaultMetrics} from 'prom-client';
export function equal(a,b){return timingSafeEqual(createHash('sha256').update(a||'').digest(),createHash('sha256').update(b||'').digest());}
export function createService(name,{internal=true,secret=process.env.SERVICE_TOKEN,logger=true}={}){
 if(internal&&!secret)throw new Error('SERVICE_TOKEN is required');
 const app=Fastify({logger:logger?{redact:['req.headers.authorization','req.headers.cookie','req.headers["x-service-token"]','password','token']}:false,bodyLimit:number('security','body_limit_bytes'),requestIdHeader:false});
 const registry=new Registry();collectDefaultMetrics({register:registry,prefix:name.replace(/-/g,'_')+'_'});const count=new Counter({name:'http_requests_total',help:'HTTP requests',labelNames:['service','method','route','status'],registers:[registry]});const latency=new Histogram({name:'http_request_duration_seconds',help:'HTTP duration',labelNames:['service','route'],registers:[registry]});
 app.addHook('onRequest',async(req,reply)=>{req.start=process.hrtime.bigint();reply.header('x-request-id',req.id);if(internal&&!['/health/live','/metrics'].includes(req.url)&&!equal(req.headers['x-service-token'],secret))return reply.code(401).send({error:'Internal authentication required'});});
 app.addHook('onResponse',async(req,reply)=>{const route=req.routeOptions.url||'unmatched';count.inc({service:name,method:req.method,route,status:reply.statusCode});latency.observe({service:name,route},Number(process.hrtime.bigint()-req.start)/1e9);});
 app.get('/health/live',async()=>({status:'ok',service:name}));app.get('/metrics',async(_req,reply)=>reply.type(registry.contentType).send(await registry.metrics()));
 app.setErrorHandler((error,req,reply)=>{req.log.error({err:error},'Request failed');reply.code(error.validation?400:error.statusCode&&error.statusCode>=400&&error.statusCode<=599?error.statusCode:502).send({error:error.validation?'Invalid request payload':error.expose||error.statusCode&&error.statusCode<500?error.message:'A dependent service could not complete this request',requestId:req.id});});
 return app;
}
export async function callService(base,path,{method='GET',body,requestId,timeout=number('timeouts','service_ms'),token=process.env.SERVICE_TOKEN}={}){const r=await fetch(base+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),'x-service-token':token??'','x-correlation-id':requestId??''},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout),redirect:'error'});const data=await r.json();if(!r.ok){const e=new Error(data.error||'Upstream request failed');e.statusCode=r.status;e.expose=true;throw e;}return data;}
export async function start(app,port){await app.listen({host:value('services','bind_host'),port:Number(port)});for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});}
