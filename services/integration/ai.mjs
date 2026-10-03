import { value, number } from '../shared/config.mjs';
export function registerAiRoutes(app, {env, fetcher}) {
  async function forward(req, path) {
    const response = await fetcher(value('services','ai_service_url',env)+path, {
      method:req.method, headers:{'Content-Type':'application/json','x-service-token':env.SERVICE_TOKEN || app.aiToken || '', 'x-correlation-id':req.id},
      body:req.method==='GET'?undefined:JSON.stringify(req.body),
      signal:AbortSignal.timeout(number('timeouts','service_ms',env)),redirect:'error'
    });
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error || 'AI service request failed'),{statusCode:response.status,expose:true});
    return data;
  }
  for(const [method,path] of [['GET','/ai/status'],['POST','/ai/generate'],['POST','/ai/test'],['POST','/ai/cursor/agents'],['GET','/ai/cursor/agents/:id']]) {
    app.route({method,url:path,handler:req=>forward(req,path.includes(':id')?path.replace(':id',encodeURIComponent(req.params.id)):path)});
  }
}
