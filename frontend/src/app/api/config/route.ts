import {proxyBff} from '../proxy';
export const GET=(request:Request)=>proxyBff(request,'/api/config');
