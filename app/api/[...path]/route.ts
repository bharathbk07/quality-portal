import {proxyBff} from '../proxy';
const forward=(request:Request)=>proxyBff(request,new URL(request.url).pathname);
export const GET=forward;export const POST=forward;export const DELETE=forward;

export const PUT=forward;
