// Development frontend compatibility. Deployed requests go gateway → BFF directly.
import {proxyBff} from '../proxy';
export const GET=(request:Request)=>proxyBff(request,'/api/assistant');
export const POST=(request:Request)=>proxyBff(request,'/api/assistant');
