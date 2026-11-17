const CACHE='sinfportfeli-pwa-v3';
const PUBLIC_ASSETS=['/theme.css','/offline.html','/icons/app-192.png','/icons/app-512.png','/icons/app-maskable-512.png','/icons/apple-touch-icon.png','/manifest.webmanifest','/pwa.css','/pwa.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC_ASSETS)))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('sinfportfeli-pwa-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',event=>{const req=event.request,url=new URL(req.url);if(req.method!=='GET'||url.origin!==self.location.origin)return;
 if(req.mode==='navigate'){event.respondWith(fetch(req,{cache:'no-store'}).catch(async()=>{const cached=await caches.match('/offline.html');return cached||new Response('Internetga ulaning.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})}));return}
 if(PUBLIC_ASSETS.includes(url.pathname)&&!url.search){event.respondWith(fetch(req).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)))}return response}).catch(async()=>await caches.match(req)||new Response('',{status:503})))}
});
