import fs from 'node:fs/promises';
const files=new Map([
 ['/manifest.webmanifest',['manifest.webmanifest','application/manifest+json; charset=utf-8']],['/sw.js',['sw.js','text/javascript; charset=utf-8']],['/pwa.js',['pwa.js','text/javascript; charset=utf-8']],['/pwa.css',['pwa.css','text/css; charset=utf-8']],['/offline.html',['offline.html','text/html; charset=utf-8']],
 ...['app-192.png','app-512.png','app-maskable-512.png','apple-touch-icon.png'].map(file=>['/icons/'+file,['icons/'+file,'image/png']])
]);
export async function publicAppAsset(pathname,method='GET'){const file=files.get(pathname);if(!file||!['GET','HEAD'].includes(method))return null;const headers={'Content-Type':file[1],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};if(pathname==='/sw.js')headers['Service-Worker-Allowed']='/';return new Response(method==='HEAD'?null:await fs.readFile(new URL('./'+file[0],import.meta.url)),{headers})}
