#!/usr/bin/env node
/** Rendert pwa/icon.svg naar de PNG-iconen in docs/icons. Nodig: playwright. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
const OUT = path.join(__dirname, '..', 'docs', 'icons');
// Gewone iconen krijgen afgeronde hoeken van het OS zelf (Android) of niet (desktop),
// dus die krijgen zelf een ronde vorm. Maskable en Apple: vol vlak, het OS snijdt bij.
const ICONS = [
  ['icon-192.png', 192, true], ['icon-512.png', 512, true],
  ['maskable-512.png', 512, false], ['maskable-192.png', 192, false],
  ['apple-touch-icon.png', 180, false], ['favicon-32.png', 32, true]
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, rond] of ICONS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">
      <div style="width:${size}px;height:${size}px;overflow:hidden;border-radius:${rond ? size * 0.22 : 0}px">
      ${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`);
    await page.screenshot({ path: path.join(OUT, name), omitBackground: true });
    console.log(name);
  }
  await browser.close();
})();
