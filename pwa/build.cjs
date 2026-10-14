#!/usr/bin/env node
/**
 * Maakt docs/index.html uit Index.html (de Apps Script-versie).
 *
 *   node pwa/build.cjs                 # houdt de exec-URL uit de huidige docs/index.html
 *   node pwa/build.cjs --api=<URL>     # zet een nieuwe exec-URL
 *
 * Index.html blijft de bron. De PWA-versie krijgt alleen extra's erbij:
 * meta-tags, een fetch-shim voor google.script.run, wat CSS voor telefoons
 * en de service worker. Draai dit opnieuw na elke wijziging in Index.html.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'Index.html');
const OUT = path.join(ROOT, 'docs', 'index.html');
const SW = path.join(ROOT, 'docs', 'sw.js');
const PLACEHOLDER = 'https://script.google.com/macros/s/VUL-HIER-JE-DEPLOYMENT-ID-IN/exec';

function huidigeApi() {
  const arg = process.argv.find(a => a.startsWith('--api='));
  if (arg) return arg.slice(6).trim();
  try {
    const m = fs.readFileSync(OUT, 'utf8').match(/var HN_API = '([^']*)';/);
    if (m) return m[1];
  } catch (e) { /* nog geen docs/index.html */ }
  return PLACEHOLDER;
}

const API = huidigeApi();
if (!/^https?:\/\/[^'"\s<>]+$/.test(API)) throw new Error('Ongeldige exec-URL: ' + API);

const HEAD = `
<!-- ===== PWA: begin ===== -->
<script>
/* Apps Script exec-URL (Implementeren > Implementaties beheren > Web-app). */
var HN_API = '${API}';
</script>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Hockey NERDS</title>
<meta name="description" content="Hockey NERDS: voorspellingen voor de Hoofdklasse en Promotieklasse.">
<meta name="theme-color" content="#0f1420">
<meta name="color-scheme" content="dark">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="NERDS">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="format-detection" content="telephone=no">
<script>
/*
 * Fetch-shim: dezelfde API als google.script.run, maar via doPost.
 *   google.script.run.withSuccessHandler(f).withFailureHandler(g).login(who, pin)
 * Antwoord {ok:true,r} gaat naar de success handler, {ok:false,fout} en
 * netwerkfouten naar de failure handler (met een Error), net als in Apps Script.
 */
(function () {
  var FUNCTIES = ['login', 'getState', 'getPlayers', 'applyPatches', 'adminAction', 'haalVoorstellen', 'geefToestemming'];
  var offlineGemeld = false;

  function melding(m) { if (typeof toast === 'function') toast(m, true); }

  function roep(fn, args, ok, fail, user) {
    var p = /VUL-HIER/.test(HN_API)
      ? Promise.reject(new Error('De exec-URL (HN_API) is nog niet ingevuld.'))
      : fetch(HN_API, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ fn: fn, args: args }),
          redirect: 'follow',
          credentials: 'omit'
        });
    p.then(function (res) {
      if (!res.ok) throw new Error('Server antwoordde met ' + res.status);
      // De service worker zet deze header als hij offline een oud antwoord geeft.
      if (res.headers.get('X-HN-Cache')) {
        if (!offlineGemeld) { offlineGemeld = true; melding('Offline: je ziet de laatst bekende gegevens'); }
      } else offlineGemeld = false;
      return res.text();
    }).then(function (tekst) {
      var uit;
      try { uit = JSON.parse(tekst); } catch (e) { throw new Error('Onverwacht antwoord van de server.'); }
      if (!uit || uit.ok !== true) throw new Error((uit && uit.fout) || 'Onbekende fout.');
      return uit.r;
    }).then(function (r) {
      if (ok) ok(r, user);
    }, function (err) {
      if (fail) fail(err, user);
      else { console.error('[' + fn + ']', err); melding('Geen verbinding met de server'); }
    });
  }

  function runner(ok, fail, user) {
    var r = {
      withSuccessHandler: function (f) { return runner(f, fail, user); },
      withFailureHandler: function (f) { return runner(ok, f, user); },
      withUserObject: function (u) { return runner(ok, fail, u); }
    };
    FUNCTIES.forEach(function (fn) {
      r[fn] = function () { roep(fn, Array.prototype.slice.call(arguments), ok, fail, user); };
    });
    return r;
  }

  window.google = window.google || {};
  google.script = google.script || {};
  // Elke keer een verse runner, zodat handlers van de ene aanroep niet aan de volgende blijven hangen.
  Object.defineProperty(google.script, 'run', { get: function () { return runner(null, null, undefined); } });
})();
</script>
<style>
/* PWA: telefoon, notch en home-indicator */
html{background:var(--bg,#0f1420);-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{min-height:100vh;min-height:100dvh;
  padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  -webkit-tap-highlight-color:transparent;overscroll-behavior-y:none}
.toast{bottom:calc(20px + env(safe-area-inset-bottom));max-width:calc(100vw - 32px);text-align:center}
/* iOS zoomt in op velden kleiner dan 16px en zoomt daarna niet terug */
@media (pointer:coarse){input,select,textarea{font-size:16px}}
</style>
<!-- ===== PWA: eind ===== -->
`;

const TAIL = `
<!-- ===== PWA: begin ===== -->
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('service worker', e); });
  });
}
// Bij uitloggen ook de offline-kopie van jouw gegevens van dit toestel halen.
(function () {
  var oud = logout;
  logout = function () {
    var klaar = function () { oud(); };
    if (window.caches) caches.delete('hn-api').then(klaar, klaar); else klaar();
  };
})();
</script>
<!-- ===== PWA: eind ===== -->
`;

function vervangEenmaal(html, zoek, door) {
  const n = html.split(zoek).length - 1;
  if (n !== 1) throw new Error(`Verwacht precies één "${zoek}" in Index.html, gevonden: ${n}`);
  return html.replace(zoek, () => door);
}

let html = fs.readFileSync(SRC, 'utf8');
if (/<\?/.test(html)) throw new Error('Index.html bevat Apps Script-scriptlets (<? ?>), die werken niet op GitHub Pages.');
html = vervangEenmaal(html, '<meta charset="utf-8">', '<meta charset="utf-8">' + HEAD);
html = vervangEenmaal(html, '</body>', TAIL + '</body>');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);

// Nieuwe cache-versie in de service worker, zodat telefoons de nieuwe shell ophalen.
const hash = crypto.createHash('sha256').update(html).digest('hex').slice(0, 10);
const sw = fs.readFileSync(SW, 'utf8').replace(/var VERSIE = '[^']*';/, `var VERSIE = '${hash}';`);
fs.writeFileSync(SW, sw);

console.log(`docs/index.html gemaakt (shell ${hash})`);
console.log(`exec-URL: ${API}${/VUL-HIER/.test(API) ? '   <-- nog invullen!' : ''}`);
