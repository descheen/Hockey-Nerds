#!/usr/bin/env node
/**
 * End-to-end test van de PWA tegen de mock (pwa/test/mock-server.cjs).
 *   node pwa/test/mock-server.cjs &   then   node pwa/test/e2e.cjs
 * Schermafbeeldingen komen in pwa/test/shots/.
 */
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const SITE = 'http://localhost:8787/';
const MOCK = 'http://127.0.0.1:8788/__mock';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
function check(ok, wat) { console.log((ok ? '  ok   ' : '  FOUT ') + wat); if (!ok) fouten++; }
const mock = (q) => fetch(MOCK + '?' + q).then((r) => r.json());

async function geenHorizontaleScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function toestel(browser, naam, device, metOffline) {
  console.log(`\n== ${naam} ==`);
  const ctx = await browser.newContext({ ...device, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  const consoleFouten = [];
  // "Failed to load resource" komt van de nagebootste storing, die hoort erbij.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) consoleFouten.push(m.text()); });
  page.on('pageerror', (e) => consoleFouten.push(String(e)));

  // 1. inlogscherm
  await page.goto(SITE);
  await page.waitForSelector('#pick button');
  check((await page.$$('#pick button')).length === 4, 'inlogscherm toont 4 spelers (getPlayers via CORS + 302)');
  await page.screenshot({ path: path.join(SHOTS, `${naam}-1-login.png`) });

  // 2. foute pincode (Rein heeft na de eerste run al een pin, dus eerst goed inloggen)
  await page.click('#pick button[data-p="Rein"]');
  await page.fill('#pin', '1234');
  await page.click('#go');
  await page.waitForSelector('#nav button');
  check(true, 'inloggen werkt, app-shell staat');
  check(await page.evaluate(() => ME === 'Rein' && ADMIN === true), 'ME/ADMIN gezet uit login-antwoord');

  // 3. elk tabblad: renderen, geen horizontale scroll van de pagina
  const tabs = await page.$$eval('#nav button', (bs) => bs.map((b) => b.dataset.tab));
  for (const t of tabs) {
    await page.click(`#nav button[data-tab="${t}"]`);
    await page.waitForTimeout(150);
    check(await geenHorizontaleScroll(page), `tab "${t}": pagina scrolt niet horizontaal`);
    await page.screenshot({ path: path.join(SHOTS, `${naam}-tab-${t}.png`), fullPage: false });
  }

  // 3b. mobiel ontwerp: opstartscherm weg, onderbalk, tikgebieden, geen tabellen, contrast
  check(await page.evaluate(() => document.documentElement.classList.contains('klaar')), 'opstartscherm verdwijnt na het laden');
  const balk = await page.$$eval('#nav button', (bs) => bs.map((b) => {
    const r = b.getBoundingClientRect(), lbl = [...b.querySelectorAll('span')].find((x) => x.offsetWidth);
    return { tab: b.dataset.tab, h: r.height, w: r.width, onder: innerHeight - r.bottom, past: !!lbl && lbl.scrollWidth <= lbl.clientWidth + 1, tekst: lbl && lbl.textContent };
  }));
  check(balk.length === 5 && balk.map((b) => b.tab).join() === 'stand,wvdw,pred,live,info', 'onderbalk: Stand, Wedstrijd, Voorspellingen, Competitie, Meer');
  check(balk.every((b) => b.h >= 44 && b.w >= 44), 'onderbalk: elk vak minstens 44×44');
  check(balk.every((b) => b.past), 'onderbalk: alle labels passen (' + balk.map((b) => b.tekst).join(', ') + ')');
  check(balk.every((b) => b.onder >= 0 && b.onder < 40), 'onderbalk staat onderin het scherm');
  for (const t of ['stand', 'wvdw', 'pred', 'live', 'info', 'result']) {
    const te = await page.evaluate((t) => {
      tab = t; render();
      document.querySelectorAll('#view details').forEach((d) => { d.open = true; });
      const klein = [...document.querySelectorAll('#view button,#view select,#view input:not([type=checkbox]),#view textarea,#view summary,#view .pts.tik')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => { const r = el.getBoundingClientRect(); return { el: el.tagName + '.' + el.className + ' ' + (el.textContent || '').trim().slice(0, 20), h: r.height }; })
        .filter((x) => x.h < 43.5);
      return { klein, tabellen: document.querySelectorAll('#view table').length, breed: document.documentElement.scrollWidth > innerWidth + 1 };
    }, t);
    check(!te.klein.length, `scherm "${t}": alle tikgebieden minstens 44px` + (te.klein.length ? ': ' + JSON.stringify(te.klein.slice(0, 3)) : ''));
    check(!te.tabellen && !te.breed, `scherm "${t}": geen tabellen, niets breder dan het scherm`);
  }
  const contrast = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
    const lum = (hex) => { const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255).map((x) => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const r = (a, b) => { const x = lum(v(a)), y = lum(v(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const paren = [['--txt', '--surface-2'], ['--dim', '--surface-2'], ['--faint', '--bg'], ['--faint', '--surface'], ['--acc-txt', '--surface'], ['--on-acc', '--acc'], ['--ok', '--surface-2'], ['--bad', '--surface']];
    return paren.map(([a, b]) => [a + ' op ' + b, Math.round(r(a, b) * 10) / 10]);
  });
  check(contrast.every((c) => c[1] >= 4.5), 'contrast minstens 4.5:1 (' + contrast.map((c) => c[0] + ' ' + c[1]).join(', ') + ')');

  // 3c. wedstrijd van de week: één ronde per scherm, zwiepen en pijlen, snelle score-invoer
  await page.click('#nav button[data-tab="wvdw"]');
  const r0 = await page.evaluate(() => huidigeVenster());
  const zwiep = (dx) => page.evaluate((dx) => {
    const el = document.querySelector('.wedstrijd .duel');
    const t = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(200)], changedTouches: [t(200)], bubbles: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(200 + dx)], bubbles: true }));
  }, dx);
  check((await page.$$('.wedstrijd')).length === 2, 'één speelronde per scherm (twee wedstrijdkaarten)');
  await zwiep(-150);
  check(await page.evaluate(() => huidigeVenster()) === r0 + 1, 'naar links zwiepen: volgende ronde');
  await zwiep(150);
  check(await page.evaluate(() => huidigeVenster()) === r0, 'naar rechts zwiepen: terug');
  await page.click('.pager [data-ronde="' + (r0 - 1) + '"]');
  check(await page.evaluate(() => huidigeVenster()) === r0 - 1, 'pijl terug werkt');
  await page.click('.pager [data-ronde="nu"]');
  check(await page.evaluate(() => huidigeVenster()) === r0, '"terug naar nu" werkt');
  const groot = await page.$eval('.mijnvak .sc.groot input', (el) => el.getBoundingClientRect().height);
  check(groot >= 56, `score-invoer is groot (${Math.round(groot)}px)`);
  await page.click('.mijnvak .sc.groot input[data-half="h"]');
  await page.keyboard.type('3');
  check(await page.evaluate(() => document.activeElement.dataset.half === 'a'), 'na één cijfer springt de cursor naar het uitvak');
  await page.keyboard.type('1');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'opgeslagen', null, { timeout: 8000 });
  const mijnScore = await page.evaluate((r) => new Promise((ok) =>
    google.script.run.withSuccessHandler((x) => ok(x.state.comps.hk.preds.Rein.wvdw[r])).getState('Rein', '1234')), r0);
  check(mijnScore === '3-1', 'snelle score-invoer opgeslagen op de server (' + mijnScore + ')');

  // 3d. status: offline en weer online
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  check(await page.textContent('#status') === 'offline', 'status toont "offline" zonder netwerk');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  check(await page.textContent('#status') !== 'offline', 'status herstelt als het netwerk terug is');
  await page.click('#nav button[data-tab="stand"]');

  // 4. opslaan (applyPatches) en terugkrijgen van de server
  // (de eindstand-voorspellingen zitten op slot zodra de competitie loopt, dus een uitslag als beheerder)
  const waarde = { iphone: '3-1', android: '2-2', 'iphone-se': '4-0' }[naam];
  await page.evaluate((v) => patch(['comps', 'hk', 'matches', 21, 'actual'], v), waarde);
  await page.waitForFunction(() => document.getElementById('status').textContent === 'opgeslagen', null, { timeout: 8000 });
  const terug = await page.evaluate(() => new Promise((ok, nee) =>
    google.script.run.withSuccessHandler(ok).withFailureHandler(nee).getState('Rein', '1234')));
  check(terug.state.comps.hk.matches[21].actual === waarde, 'applyPatches: wijziging staat op de server');

  // 5. de shim zelf: handlers, user object, failure handler bij serverfout
  const shim = await page.evaluate(() => new Promise((ok) => {
    var uit = {};
    google.script.run.withSuccessHandler(function (r, u) { uit.user = u; uit.err = r && r.error;
      google.script.run.withSuccessHandler(function () { uit.adminOk = true; ok(uit); })
        .withFailureHandler(function (e) { uit.adminFout = String(e); ok(uit); })
        .adminAction('Rein', '1234', 'setAppUrl', location.href);
    }).withUserObject('X').getState('Tijn', 'fout');
  }));
  check(shim.user === 'X' && shim.err === 'Niet ingelogd.', 'withUserObject + app-fout via success handler (zoals google.script.run)');
  check(shim.adminOk === true, 'adminAction (setAppUrl) komt door');

  // 6. herladen: automatisch inloggen uit localStorage, SW actief
  await page.reload();
  await page.waitForSelector('#nav button');
  check(true, 'herladen logt automatisch in');
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active && !!navigator.serviceWorker.controller; });
  check(sw, 'service worker actief en bestuurt de pagina');
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  check(manifest.display === 'standalone' && manifest.icons.length === 4, 'manifest geladen');

  // 7. server onbereikbaar tijdens opslaan: failure handler, opnieuw proberen
  await mock('down=1');
  await page.evaluate(() => patch(['comps', 'hk', 'matches', 20, 'actual'], '1-1'));
  await page.waitForFunction(() => document.getElementById('status').textContent === 'geen verbinding', null, { timeout: 8000 });
  check(true, 'storing: status "geen verbinding", wijziging blijft in de wachtrij');
  await mock('down=0');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'opgeslagen', null, { timeout: 12000 });
  check(true, 'na storing wordt de wachtrij alsnog opgeslagen');

  if (metOffline) {
    // 8. helemaal offline openen: shell uit cache, laatst bekende stand
    await page.waitForTimeout(500);
    await mock('down=1&site=0');
    await page.reload();
    await page.waitForSelector('#nav button', { timeout: 10000 });
    const toast = await page.textContent('#toast');
    check(/Offline/.test(toast), 'offline: app opent uit cache met melding "' + toast + '"');
    await page.screenshot({ path: path.join(SHOTS, `${naam}-offline.png`) });
    await mock('down=0&site=1');
  }

  // 9. nieuwe versie: balk verschijnt, verversen wacht op opslaan
  check(!(await page.$('#hn-update')), 'geen update-balk bij de eerste installatie');
  await mock('sw=' + naam + Date.now());
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForSelector('#hn-update', { timeout: 10000 });
  check(true, 'nieuwe service worker: balk "Nieuwe versie klaar" verschijnt');
  await page.screenshot({ path: path.join(SHOTS, `${naam}-update.png`) });
  await page.evaluate(() => patch(['comps', 'hk', 'matches', 19, 'actual'], '0-0'));
  await page.click('#hn-update button');
  check(/Even wachten/.test(await page.textContent('#toast')) && !!(await page.$('#hn-update')), 'verversen wacht als er nog iets opgeslagen moet worden');
  await page.waitForFunction(() => document.getElementById('status').textContent === 'opgeslagen', null, { timeout: 8000 });
  await Promise.all([page.waitForNavigation(), page.click('#hn-update button')]);
  await page.waitForSelector('#nav button');
  check(!(await page.$('#hn-update')), 'na verversen: nieuwe versie geladen, balk weg');

  // 10. uitloggen wist de offline-kopie
  await page.click('#nav button[data-tab="info"]');
  await page.click('#btnLogout');
  await page.waitForSelector('#pick button');
  // Na het herladen haalt het inlogscherm getPlayers op (dat mag), maar jouw login/stand is weg.
  const bewaard = await page.evaluate(async () => (await (await caches.open('hn-api')).keys()).length);
  check(bewaard <= 1, `uitloggen wist jouw offline-kopie (nog ${bewaard} item: de spelerslijst)`);

  // 11. als gewone speler: alles alleen-lezen, zelfde regels voor tikgebieden en breedte
  await page.click('#pick button[data-p="Tijn"]');
  await page.fill('#pin', '1234');
  await page.click('#go');
  await page.waitForSelector('#nav button');
  check(await page.evaluate(() => ME === 'Tijn' && ADMIN === false), 'inloggen als gewone speler (Tijn)');
  for (const t of ['stand', 'wvdw', 'pred', 'live', 'info', 'result']) {
    const te = await page.evaluate((t) => {
      tab = t; render();
      document.querySelectorAll('#view details').forEach((d) => { d.open = true; });
      const klein = [...document.querySelectorAll('#view button,#view select,#view input:not([type=checkbox]),#view summary,#view .pts.tik')]
        .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 43.5).length;
      return { klein, beheer: document.querySelectorAll('#view [data-adm]').length, breed: document.documentElement.scrollWidth > innerWidth + 1 };
    }, t);
    check(!te.klein && !te.breed && !te.beheer, `speler, scherm "${t}": geen beheerknoppen, tikgebieden en breedte in orde`);
  }
  await page.screenshot({ path: path.join(SHOTS, `${naam}-speler.png`) });
  await page.click('#nav button[data-tab="info"]');
  await page.click('#btnLogout');
  await page.waitForSelector('#pick button');

  check(consoleFouten.length === 0, 'geen JS-fouten in de console' + (consoleFouten.length ? ': ' + consoleFouten.join(' | ') : ''));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await toestel(browser, 'iphone', devices['iPhone 13'], true);
  await toestel(browser, 'android', devices['Pixel 7'], true);
  await toestel(browser, 'iphone-se', devices['iPhone SE'], false);
  await browser.close();
  const log = (await mock('')).log;
  check(log.every((l) => /^text\/plain/.test(l.ct)), `alle ${log.length} API-verzoeken waren text/plain (geen preflight)`);
  console.log(fouten ? `\n${fouten} FOUT(EN)` : '\nAlles groen.');
  process.exit(fouten ? 1 : 0);
})();
