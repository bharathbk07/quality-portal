import {readFileSync} from 'node:fs';import {resolve} from 'node:path';import {parse} from 'ini';
const configuration=parse(readFileSync(process.env.CONFIG_FILE||resolve(process.cwd(),'configuration.ini'),'utf8'));
export function value(section,key,env=process.env){const result=env[key.toUpperCase()]??configuration[section]?.[key];if(result===undefined||result==='')throw new Error(`Missing configuration: [${section}] ${key}`);return String(result);}
export function number(section,key,env=process.env){const n=Number(value(section,key,env));if(!Number.isFinite(n)||n<0)throw new Error(`Invalid numeric configuration: ${section}.${key}`);return n;}
export function publicConfig(env=process.env){return Object.fromEntries(Object.keys(configuration.public).map(key=>[key,key==='test_duration'?value('public',key,env):number('public',key,env)]));}

export function optional(section,key,env=process.env){return String(env[key.toUpperCase()]||configuration[section]?.[key]||'');}
