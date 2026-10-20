#!/usr/bin/env node
/**
 * Legt elk hoofdscherm vast op iPhone 13, iPhone SE en Pixel 7.
 *   node pwa/test/mock-server.cjs &   then   node pwa/test/screens.cjs voor|na
 * Uitvoer: pwa/test/screens/<label>/<toestel>-<scherm>.png (in CSS-pixels, klein genoeg voor git).
 */
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const LABEL = process.argv[2] || 'na';
const OUT = path.join(__dirname, 'screens', LABEL);
fs.mkdirSync(OUT, { recursive: true });
const SCHERMEN = [['stand', 'stand'], ['wvdw', 'wedstrijd'], ['pred', 'voorspellingen'], ['live', 'competitie'], ['info', 'meer'], ['result', 'eindstand']];
const TOESTELLEN = [['iphone13', devices['iPhone 13']], ['iphonese', devices['iPhone SE']], ['pixel7', devices['Pixel 7']]];

(async () => {
  const browser = await chromium.launch();
  for (const [naam, device] of TOESTELLEN) {
    const ctx = await browser.newContext({ ...device, serviceWorkers: 'block', reducedMotion: 'reduce' });
    // De demodata hoort bij midden oktober 2026; zet de klok daar vast, anders verlopen de rondes in de test.
    await ctx.clock.setFixedTime(new Date('2026-10-14T19:00:00+02:00'));
    const page = await ctx.newPage();
    await page.goto('http://localhost:8787/');
    await page.waitForSelector('#pick button');
    await page.click('#pick button[data-p="Rein"]');
    await page.screenshot({ path: path.join(OUT, `${naam}-0-login.png`), scale: 'css' });
    await page.fill('#pin', '1234');
    await page.click('#go');
    await page.waitForSelector('#nav button');
    await page.evaluate(() => { const b = document.getElementById('bericht'); if (b) b.querySelector('.bk-verder').click(); if (document.getElementById('recap')) sluitRecap(); });
    let n = 1;
    for (const [tab, label] of SCHERMEN) {
      await page.evaluate((t) => { tab = t; render(); window.scrollTo(0, 0); }, tab);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, `${naam}-${n++}-${label}.png`), scale: 'css' });
    }
    await ctx.close();
    console.log(naam, 'klaar');
  }
  await browser.close();
})();
