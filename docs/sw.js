/*
 * Hockey NERDS service worker.
 * - Shell (index.html, manifest, iconen): in de cache, zodat de app offline opent.
 *   De pagina zelf is network-first, dan krijg je online altijd de nieuwste versie.
 * - API (POST naar de Apps Script exec-URL): network-first. Alleen leesacties
 *   (getPlayers, getState, login) krijgen offline het laatst bekende antwoord.
 *   Opslaan gaat altijd rechtstreeks naar de server, nooit uit een cache.
 * VERSIE wordt gezet door pwa/build.cjs.
 */
var VERSIE = '83b9765d02';
var SHELL_CACHE = 'hn-shell-v3-' + VERSIE; // v3: lettertype en nieuwe uitstraling
var API_CACHE = 'hn-api';
var SHELL = [
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon.svg',
  './fonts/barlow-condensed-latin-600-normal.woff2',
  './fonts/barlow-condensed-latin-700-normal.woff2',
  './fonts/barlow-condensed-latin-800-normal.woff2'
];
var LEES = { getPlayers: true, getState: true, login: true };

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (c) { return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('hn-shell-') === 0 && k !== SHELL_CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url = new URL(req.url);

  if (req.method === 'POST' && /\/exec$/.test(url.pathname)) {
    event.respondWith(api(req));
    return;
  }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(pagina(req));
    return;
  }
  // Iconen en manifest: cache-first.
  event.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok) { var kopie = res.clone(); caches.open(SHELL_CACHE).then(function (c) { c.put(req, kopie); }); }
      return res;
    });
  }));
});

/** Pagina: eerst het netwerk (met een grens), anders de bewaarde shell. */
function pagina(req) {
  var netwerk = fetch(req).then(function (res) {
    if (res.ok) { var kopie = res.clone(); caches.open(SHELL_CACHE).then(function (c) { c.put('./', kopie); }); }
    return res;
  });
  var traag = new Promise(function (resolve) { setTimeout(resolve, 4000); });
  var uitCache = function () { return caches.open(SHELL_CACHE).then(function (c) { return c.match('./'); }); };
  return Promise.race([netwerk.catch(function () { return null; }), traag.then(function () { return null; })])
    .then(function (res) {
      if (res) return res;
      return uitCache().then(function (hit) { return hit || netwerk; });
    });
}

function api(req) {
  return req.clone().text().then(function (body) {
    var fn = null;
    try { fn = JSON.parse(body).fn; } catch (e) {}
    if (!LEES[fn]) return fetch(req);

    return sleutel(body).then(function (key) {
      return fetch(req).then(function (res) {
        if (!res.ok) return res;
        return res.clone().text().then(function (tekst) {
          var goed = false;
          try { var j = JSON.parse(tekst); goed = j.ok === true && !(j.r && j.r.error); } catch (e) {}
          if (goed) {
            caches.open(API_CACHE).then(function (c) {
              c.put(key, new Response(tekst, { headers: { 'Content-Type': 'application/json' } }));
            });
          }
          return res;
        });
      }, function (err) {
        return caches.open(API_CACHE).then(function (c) { return c.match(key); }).then(function (hit) {
          if (!hit) throw err;
          return hit.text().then(function (tekst) {
            return new Response(tekst, { headers: { 'Content-Type': 'application/json', 'X-HN-Cache': '1' } });
          });
        });
      });
    });
  });
}

/** Cachesleutel per verzoek. Gehasht, zodat er geen pincode leesbaar in staat. */
function sleutel(body) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)).then(function (buf) {
    var hex = Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    return new Request(self.registration.scope + '__api/' + hex);
  });
}
