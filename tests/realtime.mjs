import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createChatHub} from '../realtime.mjs';
const tick=()=>new Promise(r=>setTimeout(r,5));
class ResponseMock extends EventEmitter{headers={};status=0;text='';writableLength=0;writeHead(status,headers){this.status=status;this.headers=headers}flushHeaders(){}write(value){this.text+=value}end(value=''){this.text+=value;this.emit('close')}}
const hub=createChatHub({heartbeatMs:60000}),req={headers:{cookie:'test-cookie'}};
let allowed=true;const auth=async()=>allowed?new Response('{}'):new Response('{"error":"Unauthorized"}',{status:401});
const denied=new ResponseMock();allowed=false;await hub.connect(req,denied,auth);assert.equal(denied.status,401);assert.equal(hub.size,0);allowed=true;
const a=new ResponseMock(),b=new ResponseMock();await hub.connect(req,a,auth);await hub.connect(req,b,auth);assert.equal(a.headers['Content-Type'],'text/event-stream; charset=utf-8');assert.equal(hub.size,2);const before=a.text;hub.signal();await tick();assert(a.text.length>before.length);assert(!a.text.includes('test-cookie'));assert(!a.text.includes('author'));
allowed=false;hub.signal();await tick();assert.equal(hub.size,0);const stopped=a.text;hub.signal();await tick();assert.equal(a.text,stopped);
allowed=true;for(let i=0;i<4;i++)await hub.connect(req,new ResponseMock(),auth);const limited=new ResponseMock();await hub.connect(req,limited,auth);assert.equal(limited.status,429);hub.close();assert.equal(hub.size,0);
const short=createChatHub({heartbeatMs:60000,lifetimeMs:10});await short.connect(req,new ResponseMock(),auth);await new Promise(r=>setTimeout(r,20));assert.equal(short.size,0);
console.log('Passed: authenticated live chat, broadcasts, revoked sessions, connection limits and stream cleanup.');
