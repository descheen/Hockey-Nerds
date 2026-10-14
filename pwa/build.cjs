#!/usr/bin/env node
/**
 * Maakt docs/index.html uit pwa/src/app.html (de PWA-bron).
 *
 *   node pwa/build.cjs                 # houdt de exec-URL uit de huidige docs/index.html
 *   node pwa/build.cjs --api=<URL>     # zet een nieuwe exec-URL
 *
 * pwa/src/app.html is het mobile-first ontwerp van de PWA. De logica (opslaan,
 * wachtrij, rechten, punten) is gelijk aan Index.html, de Apps Script-versie.
 * Pas je daar logica aan, neem die dan ook over in pwa/src/app.html.
 * De build voegt toe:
 * meta-tags, een fetch-shim voor google.script.run, wat CSS voor telefoons
 * en de service worker. Draai dit opnieuw na elke wijziging in pwa/src/app.html.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'pwa', 'src', 'app.html');
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

// iOS laat bij het openen een opstartbeeld zien als het formaat precies klopt.
// De beelden maakt pwa/make-icons.cjs.
const SCHERMEN = require('./schermen.cjs');
const OPSTART = SCHERMEN.map(([w, h, r]) =>
  `<link rel="apple-touch-startup-image" href="icons/opstart-${w * r}x${h * r}.png" ` +
  `media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)">`).join('\n');

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
${OPSTART}
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
<!-- ===== PWA: eind ===== -->
`;

const TAIL = `
<!-- ===== PWA: begin ===== -->
<script>
/*
 * Service worker + "nieuwe versie"-melding.
 * Een geïnstalleerde app blijft soms dagen open op de achtergrond. Daarom kijken
 * we bij terugkomen in de app (en elk half uur) of er een nieuwe versie is.
 * Neemt een nieuwe service worker het over, dan tonen we een balk.
 * Verversen wacht tot alles is opgeslagen.
 */
if ('serviceWorker' in navigator) {
  var hadSw = !!navigator.serviceWorker.controller; // eerste installatie is geen "update"
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      var kijk = function () { reg.update().catch(function () {}); };
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') kijk(); });
      setInterval(kijk, 30 * 60 * 1000);
    }).catch(function (e) { console.warn('service worker', e); });
  });
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadSw) { hadSw = true; return; }
    if (document.getElementById('hn-update')) return;
    var b = document.createElement('div');
    b.id = 'hn-update';
    b.innerHTML = '<span>Nieuwe versie klaar</span><button type="button">Verversen</button>';
    b.querySelector('button').onclick = function () {
      if (typeof queue !== 'undefined' && (queue.length || sending || dirty)) {
        if (typeof toast === 'function') toast('Even wachten, ik sla nog iets op', true);
        if (typeof flush === 'function') flush();
        return;
      }
      location.reload();
    };
    document.body.appendChild(b);
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
  if (n !== 1) throw new Error(`Verwacht precies één "${zoek}" in de bron, gevonden: ${n}`);
  return html.replace(zoek, () => door);
}

let html = fs.readFileSync(SRC, 'utf8');
if (/<\?/.test(html)) throw new Error('De bron bevat Apps Script-scriptlets (<? ?>), die werken niet op GitHub Pages.');
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
