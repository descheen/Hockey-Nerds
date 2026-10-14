#!/usr/bin/env node
/**
 * Lokale proefopstelling:
 *   - http://localhost:8787/       serveert docs/ (zoals GitHub Pages)
 *   - http://127.0.0.1:8788/exec   draait de ECHTE Code.gs + doPost-snippet.gs
 *     met nagebootste Apps Script-diensten (sheet in het geheugen).
 *
 * De API zit bewust op een andere origin en doet net als Google een 302 naar
 * een tweede adres met Access-Control-Allow-Origin: *, zodat CORS en redirects
 * echt getest worden.
 *
 *   node pwa/test/mock-server.cjs
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs');
const WEB_PORT = +process.env.WEB_PORT || 8787;
const API_PORT = +process.env.API_PORT || 8788;
const API_URL = `http://127.0.0.1:${API_PORT}/macros/s/MOCK/exec`;

/* ---------- nagebootste Apps Script-diensten ---------- */
function maakSheet() {
  const rijen = []; // rijen[r][c], 0-based
  const sh = {
    getLastRow: () => { let n = rijen.length; while (n && !(rijen[n - 1] || []).some(v => v !== '' && v != null)) n--; return n; },
    getRange: (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((rijen[r - 1 + i] || [])[c - 1 + j] ?? ''))),
      setValues: (v) => v.forEach((rij, i) => rij.forEach((x, j) => { (rijen[r - 1 + i] = rijen[r - 1 + i] || [])[c - 1 + j] = x; })),
      getValue: () => (rijen[r - 1] || [])[c - 1] ?? '',
      setValue: (x) => { (rijen[r - 1] = rijen[r - 1] || [])[c - 1] = x; },
      clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (rijen[r - 1 + i]) rijen[r - 1 + i][c - 1 + j] = ''; }
    }),
    hideSheet: () => {},
    appendRow: (v) => { rijen[sh.getLastRow()] = v.slice(); },
    deleteRow: (r) => { rijen.splice(r - 1, 1); }
  };
  return sh;
}
const sheets = {};
const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = maakSheet())
};

const sandbox = {
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Session: { getScriptTimeZone: () => 'Europe/Amsterdam' },
  Logger: { log: (...a) => console.log('[Logger]', ...a) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    formatDate: (d) => d.toISOString().slice(0, 10)
  },
  UrlFetchApp: { fetch: () => { throw new Error('geen internet in de mock'); } },
  MailApp: { getRemainingDailyQuota: () => 100, sendEmail: () => {} },
  ScriptApp: { getProjectTriggers: () => [], getService: () => ({ getUrl: () => API_URL }), deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create() {} }) }) }) },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (s) => ({ _s: s, _m: 'text/plain', setMimeType(m) { this._m = m; return this; }, getContent() { return this._s; } })
  },
  HtmlService: {}
};
vm.createContext(sandbox);
for (const f of ['Code.gs', 'doPost-snippet.gs']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}

/* ---------- demodata (SEED=leeg voor een kale poule) ---------- */
// Vaste "willekeur", zodat screenshots elke keer hetzelfde zijn.
if (process.env.SEED !== 'leeg') vm.runInContext(`(function () {
  var r = 7; function rnd(n) { r = (r * 9301 + 49297) % 233280; return Math.floor(r / 233280 * n); }
  var s = readState_();
  s.players.forEach(function (p) { s.pins[p] = hashPin_(p, '1234'); });
  var gespeeld = { hk: 3, pk: 6 };
  ['hk', 'pk'].forEach(function (ck) {
    var c = s.comps[ck], t = c.teams;
    for (var i = 0; i <= gespeeld[ck]; i++) {
      var m = c.matches[i], prog = (PROGRAMMA[ck] || {})[i];
      var paar = prog ? prog[rnd(prog.length)].split(' - ') : [t[(i * 2) % t.length], t[(i * 2 + 5) % t.length]];
      m.home = paar[0]; m.away = paar[1];
      if (i < gespeeld[ck]) m.actual = rnd(5) + '-' + rnd(4);
      s.players.forEach(function (p, pi) {
        if (i === gespeeld[ck] && (p === 'Rein' || p === 'David')) return; // nog in te vullen
        c.preds[p].wvdw[i] = rnd(5) + '-' + rnd(4);
      });
    }
    var basis = c.preds.Rein.standing.slice();
    ['Tijn', 'David'].forEach(function (p) {
      var l = basis.slice(); for (var k = 0; k < 4; k++) { var a = rnd(12), b = rnd(12), x = l[a]; l[a] = l[b]; l[b] = x; }
      c.preds[p].standing = l; c.preds[p].kampioen = l[rnd(3)]; c.preds[p].winter = l[rnd(3)];
    });
    var live = basis.slice(); for (var k = 0; k < 5; k++) { var a = rnd(12), b = rnd(12), x = live[a]; live[a] = live[b]; live[b] = x; }
    c.live = { standing: live, updated: '2026-10-12T08:00:00.000Z' };
  });
  writeState_(s);
})();`, sandbox);

/* ---------- API: zoals script.google.com ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const antwoorden = new Map(); let teller = 0;
let vertraging = 0, uit = false, siteUit = false, swVersie = ''; // te zetten via /__mock?delay=ms&down=1&site=0&sw=x
const log = [];

http.createServer((req, res) => {
  const url = new URL(req.url, API_URL);
  if (url.pathname === '/__mock') {
    if (url.searchParams.has('delay')) vertraging = +url.searchParams.get('delay');
    if (url.searchParams.has('down')) uit = url.searchParams.get('down') === '1';
    if (url.searchParams.has('sw')) swVersie = url.searchParams.get('sw');
    if (url.searchParams.has('site')) siteUit = url.searchParams.get('site') === '0';
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ vertraging, uit, siteUit, log }));
  }
  if (uit) { req.socket.destroy(); return; }
  if (req.method === 'POST' && url.pathname.endsWith('/exec')) {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => setTimeout(() => {
      const ct = req.headers['content-type'] || '';
      log.push({ ct, body: body.slice(0, 200) });
      const out = sandbox.doPost({ postData: { contents: body, type: ct } });
      const id = String(++teller);
      antwoorden.set(id, out);
      // Google: 302 naar script.googleusercontent.com, beide met ACAO *
      res.writeHead(302, { Location: `/macros/echo?user_content_key=${id}`, 'Access-Control-Allow-Origin': '*' });
      res.end();
    }, vertraging));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/macros/echo') {
    const out = antwoorden.get(url.searchParams.get('user_content_key'));
    if (!out) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': out._m + '; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(out.getContent());
  }
  if (req.method === 'OPTIONS') { res.writeHead(405); return res.end(); } // Apps Script kent geen preflight
  res.writeHead(404); res.end();
}).listen(API_PORT, '127.0.0.1');

/* ---------- statische site: zoals GitHub Pages ---------- */
// (Playwright's setOffline raakt service workers niet, daarom vallen we hier echt uit.)
http.createServer((req, res) => {
  if (siteUit) { req.socket.destroy(); return; }
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(DOCS, path.normalize(p));
  if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
  let data = fs.readFileSync(file);
  if (file.endsWith('sw.js') && swVersie) data = data.toString() + `\n// nagebootste nieuwe versie: ${swVersie}\n`;
  if (file.endsWith('index.html')) data = data.toString().replace(/var HN_API = '[^']*';/, `var HN_API = '${API_URL}';`);
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(data);
}).listen(WEB_PORT, 'localhost');

console.log(`site: http://localhost:${WEB_PORT}/   api: ${API_URL}`);
