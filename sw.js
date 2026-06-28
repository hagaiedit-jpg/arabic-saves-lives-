/* Service worker for "ערבית מצילה חיים" — offline-first field use.
   Bump CACHE when shipping changes that must invalidate old caches. */
const CACHE = 'asl-v4';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg'];

self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL).catch(function(){}); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function cacheFirst(req){
  return caches.match(req).then(function(c){
    return c || fetch(req).then(function(r){
      if (r && r.ok) { var cl = r.clone(); caches.open(CACHE).then(function(ca){ ca.put(req, cl); }); }
      return r;
    });
  });
}

// Best-effort daily reminder (Android installed PWA; not available on iOS)
self.addEventListener('periodicsync', function(e){
  if (e.tag === 'daily-reminder') {
    e.waitUntil(self.registration.showNotification('ערבית מצילה חיים', {
      body: 'זמן לתרגל — כמה דקות שומרות על המוכנות בשטח',
      icon: './icon.svg', badge: './icon.svg', tag: 'daily-reminder'
    }));
  }
});

// Tapping a notification focuses/opens the app
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window'}).then(function(list){
    for (var i=0;i<list.length;i++){ if('focus' in list[i]) return list[i].focus(); }
    if (clients.openWindow) return clients.openWindow('./');
  }));
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return; // never touch writes (POST/PATCH to Supabase/Cloudinary)
  var url;
  try { url = new URL(req.url); } catch(_) { return; }

  // App page -> network first, fall back to cached shell (so the app opens with no signal)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function(r){
        var cl = r.clone(); caches.open(CACHE).then(function(c){ c.put('./index.html', cl); });
        return r;
      }).catch(function(){ return caches.match('./index.html').then(function(r){ return r || caches.match('./'); }); })
    );
    return;
  }

  // Recordings (Cloudinary) + fonts -> cache first, so they keep working offline once fetched
  if (url.hostname.indexOf('res.cloudinary.com') !== -1 || url.hostname.indexOf('fonts.g') !== -1) {
    e.respondWith(cacheFirst(req).catch(function(){ return caches.match(req); }));
    return;
  }

  // Supabase content (GET) -> network first, cache fallback for offline
  if (url.hostname.indexOf('supabase') !== -1) {
    e.respondWith(
      fetch(req).then(function(r){
        if (r && r.ok) { var cl = r.clone(); caches.open(CACHE).then(function(c){ c.put(req, cl); }); }
        return r;
      }).catch(function(){ return caches.match(req); })
    );
    return;
  }

  // Everything else -> cache, then network
  e.respondWith(caches.match(req).then(function(c){ return c || fetch(req); }));
});
