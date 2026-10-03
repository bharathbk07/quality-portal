import {publicConfig} from '../../../services/shared/config.mjs';
export async function GET(){return Response.json(publicConfig());}
