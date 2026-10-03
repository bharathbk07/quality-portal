import {number} from '../shared/config.mjs';
const field = (key,label,type='text',section='ai',choices) => ({key,label,type,section,maxLength:number('validation','settings_value_max_chars'),...(choices?{choices}:{})});
const providers=[['openai','OpenAI'],['google','Google Gemini'],['claude','Anthropic Claude'],['lmstudio','LM Studio'],['ollama','Ollama'],['compatible','OpenAI-compatible'],['cursor','Cursor']];
export const catalog = [
  {id:'ai',label:'AI defaults',description:'Choose the default provider for copilots and repository enrichment.',fields:[field('AI_PROVIDER','Default provider','select','ai',providers.filter(([id])=>id!=='cursor').map(([value,label])=>({value,label})))]},
  ...providers.map(([id,label])=>({id,label,description:id==='cursor'?'Repository coding agents through the Cursor Python SDK.':'Configure this provider without restarting the portal.',fields:[
    ...(id==='cursor'?[field('CURSOR_BRIDGE_URL','Optional SDK bridge URL','url','ai_cursor'),field('CURSOR_BRIDGE_TOKEN','Bridge token','secret','ai_cursor')]:[field(id.toUpperCase()+'_BASE_URL','API base URL','url','ai_'+id)]),
    field(id.toUpperCase()+'_MODEL','Model ID','text','ai_'+id),field(id.toUpperCase()+'_API_KEY','API key','secret','ai_'+id),
    ...(id==='google'?[field('GOOGLE_API_VERSION','API version','text','ai_google')]:[])
  ]})),
  {id:'langsmith',label:'LangSmith',description:'Monitor model latency, tokens and failures. Content capture is optional.',fields:[
    field('LANGSMITH_TRACING','Enable tracing','boolean','langsmith'),field('LANGSMITH_ENDPOINT','Regional API endpoint','url','langsmith'),field('LANGSMITH_PROJECT','Project name','text','langsmith'),field('LANGSMITH_API_KEY','API key','secret','langsmith'),field('LANGSMITH_WORKSPACE_ID','Workspace ID (optional)','text','langsmith'),field('LANGSMITH_CAPTURE_CONTENT','Capture prompts and responses','boolean','langsmith'),field('LANGSMITH_UI_URL','Dashboard URL','url','langsmith')
  ]},
  {id:'telemetry',label:'Observability & APM',description:'Connect existing Prometheus, Jaeger, Grafana and OpenTelemetry installations.',fields:[
    field('PROMETHEUS_URL','Prometheus API URL','url','telemetry'),field('JAEGER_URL','Jaeger API URL','url','telemetry'),field('GRAFANA_URL','Grafana dashboard URL','url','telemetry'),field('OTEL_ENDPOINT','OpenTelemetry endpoint','url','telemetry'),field('TELEMETRY_BEARER_TOKEN','Telemetry bearer token','secret','telemetry')
  ]},
  {id:'repository',label:'Git access',description:'Credentials for private repository imports. Repository host restrictions remain server policy.',fields:[field('GIT_HTTP_TOKEN','Git access token','secret','repository')]},
  {id:'tools',label:'Testing tools',description:'Store links to your existing testing tools and CI. The portal continues to use these tools for execution.',fields:[
    ...[['K6_URL','k6 / Grafana'],['JMETER_URL','JMeter / CI'],['PLAYWRIGHT_URL','Playwright reports'],['LIGHTHOUSE_URL','Lighthouse / CI'],['AXE_URL','Accessibility reports'],['LITMUS_URL','LitmusChaos']].map(([key,label])=>field(key,label,'url','tools'))
  ]}
];
export const settingsBody={type:'object',required:['version','values'],additionalProperties:false,properties:{version:{type:'integer',minimum:0},values:{type:'object',additionalProperties:{anyOf:[{type:'string',maxLength:number('validation','settings_value_max_chars')},{type:'null'}]},maxProperties:number('validation','settings_max_fields')}}};
