import {createHash} from 'node:crypto';
// Streams carry invalidations only; chat contents still pass through the authenticated API.
export function createChatHub({heartbeatMs=20000,lifetimeMs=300000}={}){
 const clients=new Set(),counts=new Map();
 async function connect(req,res,authorize){
  const key=createHash('sha256').update(req.headers.cookie||'').digest('hex');
  const initial=await authorize();if(res.destroyed)return;if(!initial.ok){res.writeHead(initial.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(await initial.text());return}
  if(clients.size>=128||(counts.get(key)||0)>=4){res.writeHead(429,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Juda ko‘p chat oynasi ochilgan.'}));return}
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});res.flushHeaders?.();res.write('retry: 3000\n\n');
  let closed=false,busy=false,dirty=false;let heartbeat,lifetime;
  function cleanup(){if(closed)return;closed=true;clearInterval(heartbeat);clearTimeout(lifetime);clients.delete(client);const n=(counts.get(key)||1)-1;if(n)counts.set(key,n);else counts.delete(key)}
  async function send(){if(closed)return;if(busy){dirty=true;return}busy=true;try{do{dirty=false;const auth=await authorize();if(closed)return;if(!auth.ok){cleanup();res.end();return}if(res.writableLength>65536){cleanup();res.end();return}res.write('event: changed\ndata: {}\n\n')}while(dirty&&!closed)}catch{cleanup();res.end()}finally{busy=false}}
  const client={send,close(){cleanup();res.end()}};clients.add(client);counts.set(key,(counts.get(key)||0)+1);res.once('close',cleanup);
  heartbeat=setInterval(send,heartbeatMs);heartbeat.unref?.();lifetime=setTimeout(()=>client.close(),lifetimeMs);lifetime.unref?.();await send();
 }
 return {connect,signal(){for(const client of clients)void client.send()},close(){for(const client of [...clients])client.close()},get size(){return clients.size}};
}
