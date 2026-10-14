#!/usr/bin/env node
/** Rendert pwa/icon.svg naar de iconen en de iOS-opstartbeelden in docs/icons. Nodig: playwright. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const SCHERMEN = require('./schermen.cjs');

const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
const OUT = path.join(__dirname, '..', 'docs', 'icons');
// Gewone iconen krijgen zelf afgeronde hoeken (desktop, sommige Androids tonen ze zo).
// Maskable en Apple: vol vlak, het OS snijdt bij.
const ICONS = [
  ['icon-192.png', 192, true], ['icon-512.png', 512, true],
  ['maskable-512.png', 512, false], ['maskable-192.png', 192, false],
  ['apple-touch-icon.png', 180, false], ['favicon-32.png', 32, true]
];
const sized = (s) => svg.replace('<svg ', `<svg width="${s}" height="${s}" `);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, rond] of ICONS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">
      <div style="width:${size}px;height:${size}px;overflow:hidden;border-radius:${rond ? size * 0.22 : 0}px">${sized(size)}</div></body></html>`);
    await page.screenshot({ path: path.join(OUT, name), omitBackground: true });
    console.log(name);
  }
  // Opstartbeelden: zelfde uitstraling als het opstartscherm in de app.
  for (const [w, h, r] of SCHERMEN) {
    const p2 = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: r });
    await p2.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
      background:#0b0f17;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
      <div style="width:96px;height:96px;border-radius:24px;overflow:hidden;box-shadow:0 10px 30px rgba(255,122,26,.22)">${sized(96)}</div>
      <div style="color:#eef2f9;font-size:22px;font-weight:800;letter-spacing:-.02em">Hockey <span style="color:#ff7a1a">NERDS</span></div>
      </body></html>`);
    const naam = `opstart-${w * r}x${h * r}.png`;
    await p2.screenshot({ path: path.join(OUT, naam) });
    await p2.close();
    console.log(naam);
  }
  await browser.close();
})();
