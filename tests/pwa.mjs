import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {publicAppAsset} from '../pwa-assets.mjs';
const manifest=JSON.parse(await fs.readFile('manifest.webmanifest','utf8'));
assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'/');
for(const [file,size] of [['app-192.png',192],['app-512.png',512],['app-maskable-512.png',512],['apple-touch-icon.png',180]]){const b=await fs.readFile('icons/'+file);assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);assert.equal((await publicAppAsset('/icons/'+file)).status,200)}
assert.match((await publicAppAsset('/manifest.webmanifest')).headers.get('content-type'),/manifest/);
assert.equal((await publicAppAsset('/sw.js')).headers.get('service-worker-allowed'),'/');
for(const path of ['/index.html','/api/session','/images/private.jpg','/../server.mjs'])assert.equal(await publicAppAsset(path),null);
assert.equal(await publicAppAsset('/sw.js','POST'),null);
const listeners={},cached=[],put=[];let offline=false,skipped=false;
const context={URL,Response,self:{location:{origin:'https://example.com'},addEventListener:(name,fn)=>listeners[name]=fn,clients:{claim:async()=>{}},skipWaiting:()=>skipped=true},caches:{open:async()=>({addAll:async paths=>cached.push(...paths),put:async(req)=>put.push(req.url)}),keys:async()=>[],match:async()=>new Response('offline screen')},fetch:async()=>{if(offline)throw Error('offline');return new Response('network')}};
vm.runInNewContext(await fs.readFile('sw.js','utf8'),context);
let pending;listeners.install({waitUntil:p=>pending=p});await pending;
assert(cached.includes('/offline.html'));assert(!cached.some(x=>/api|index.html|student.html|images/.test(x)));
function request(path,mode='cors',method='GET'){let response;listeners.fetch({request:{url:'https://example.com'+path,mode,method},respondWith:p=>response=p,waitUntil:p=>pending=p});return response}
assert.equal(request('/api/session'),undefined);assert.equal(request('/images/private.jpg'),undefined);assert.equal(request('/api/chat','cors','POST'),undefined);
assert.equal(await(await request('/','navigate')).text(),'network');offline=true;assert.equal(await(await request('/student/1','navigate')).text(),'offline screen');assert.equal(put.length,0);
listeners.message({data:{type:'SKIP_WAITING'}});assert(skipped);
const dom=new JSDOM('<main></main>',{url:'https://example.com/?install=1',runScripts:'outside-only'}),w=dom.window;
w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
w.eval(await fs.readFile('pwa.js','utf8'));assert(w.document.querySelector('dialog').open);
const button=w.document.querySelector('.pwa-panel button');assert(button.hidden);
let prompted=0;const event=new w.Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>prompted++;event.userChoice=Promise.resolve({outcome:'accepted'});w.dispatchEvent(event);assert(!button.hidden);assert.equal(prompted,0);button.click();await new Promise(r=>setTimeout(r,0));assert.equal(prompted,1);assert(button.hidden);
w.dispatchEvent(new w.Event('offline'));assert.equal(w.document.querySelector('.pwa-banner').hidden,false);w.dispatchEvent(new w.Event('online'));assert.equal(w.document.querySelector('.pwa-banner').hidden,true);dom.window.close();
console.log('PWA assets, privacy, offline fallback and installation UI passed');
