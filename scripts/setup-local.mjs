import {value} from '../services/shared/config.mjs';
import {randomBytes} from 'node:crypto';
import {existsSync,writeFileSync,readFileSync,appendFileSync} from 'node:fs';
const secret=()=>randomBytes(32).toString('hex');
if(existsSync('.env')){
  const previous=readFileSync('.env','utf8');
  if(!/^SETTINGS_ENCRYPTION_KEY=.+$/m.test(previous)){
    appendFileSync('.env',`\nSETTINGS_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\n`);
    console.log('Added database settings encryption key; preserved existing credentials.');
  }else console.log('.env already exists; preserved existing settings.');
}else{
  writeFileSync('.env',`ADMIN_PASSWORD=${secret()}\nSESSION_SECRET=${secret()}\nSERVICE_TOKEN=${secret()}\nPOSTGRES_PASSWORD=${secret()}\nSETTINGS_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\nGATEWAY_PORT=${value('services','gateway_port')}\nPUBLIC_ORIGINS=${value('security','public_origins')}\n`,{mode:0o600});
  console.log('Created .env with startup credentials. Configure optional connections in the application.');
}
