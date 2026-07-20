const CACHE='english-grammar-12-v5-audio-v2';
const CORE=['./','index.html','styles.css','questions.js','app.js','manifest.webmanifest','icon.svg','icon-192.svg','icon-512.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

async function networkFirst(request){
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response && response.ok){
      const cache=await caches.open(CACHE);
      cache.put(request,response.clone());
    }
    return response;
  }catch(error){
    return (await caches.match(request)) || Response.error();
  }
}

async function cacheFirst(request){
  const cached=await caches.match(request);
  if(cached) return cached;
  const response=await fetch(request);
  if(response && response.ok){
    const cache=await caches.open(CACHE);
    cache.put(request,response.clone());
  }
  return response;
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  const critical=event.request.mode==='navigate'
    || /\/(index\.html|app\.js|sw\.js)$/.test(url.pathname);
  event.respondWith(critical ? networkFirst(event.request) : cacheFirst(event.request));
});
