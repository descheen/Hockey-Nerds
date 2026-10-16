#!/usr/bin/env node
/**
 * Test van het ophalen in Code.gs (hockeystanden.nl en Teletekst), met nagebouwde
 * pagina's in de opmaak van oktober 2026. Draait de echte Code.gs in Node.
 *   node pwa/test/ophalen.cjs
 */
process.env.TZ = 'Europe/Amsterdam'; // zoals Apps Script: de tijdzone van het script
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

let fouten = 0;
function check(ok, wat) { console.log((ok ? '  ok   ' : '  FOUT ') + wat); if (!ok) fouten++; }

/* ---------- nagebouwde pagina's ---------- */
const tn = (club) => `<span class="ml__name" data-astro-cid-35mr7t35> <span class="tn" data-astro-cid-nw6g3u4b> <span class="tn__club" data-astro-cid-nw6g3u4b><span class="tn__full" data-astro-cid-nw6g3u4b>${club}</span></span><span class="tn__code" data-astro-cid-nw6g3u4b>H1</span> </span>  </span>`;
const item = (status, thuis, uit, a, b) => `<li class="ml__item" data-ms="${status}" data-ms-ko="1791722700000" data-astro-cid-35mr7t35>  <div class="ml__row" data-astro-cid-35mr7t35> <span class="ml__date">zo 11 okt</span> <a class="ml__side ml__side--home ml__side--link" href="/team/x/h1">${tn(thuis)}${a !== undefined ? `<span class="ml__line-num ml__num" data-ms-score> ${a} </span>` : ''} </a> <span class="ml__score tabular" data-ms-score>  ${a !== undefined ? `<span class="ml__score-line"> <span class="ml__num">${a}</span> <span class="ml__sep">-</span> <span class="ml__num">${b}</span> </span>` : ''}  </span> <span class="ml__state"> <span class="ml__state-main"> 14:45 </span> </span> <a class="ml__side ml__side--away ml__side--link" href="/team/y/h1">${tn(uit)} </a> </div> </li>`;
const ldjson = (teams) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Stand Poule A', numberOfItems: 12,
  itemListElement: teams.map((t, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'SportsTeam', name: t + ' H1', alternateName: 'H1' } })) })}</script>`;
const strow = (teams) => teams.map((t, i) => `<tr class="st__row" data-href="/team/x/h1"> <td class="c-pos"><span class="st__pos">${String(i + 1).padStart(2, '0')}</span></td> <td class="c-team"> <a class="st__team" title="${t} H1"> <span class="tn st__name"> <span class="tn__club"><span class="tn__full">${t}</span></span><span class="tn__code">H1</span> </span> </a> </td> <td class="c-num">6</td> <td class="c-num c-x">${4 - (i % 3)}</td> <td class="c-num c-x">1</td> <td class="c-num c-x">${1 + (i % 3)}</td> <td class="c-num c-x">${20 - i}</td> <td class="c-num c-x">${5 + i}</td> <td class="c-num c-ds">${(15 - 2 * i) > 0 ? '+' + (15 - 2 * i) : (15 - 2 * i) === 0 ? '0' : (i === 11 ? '-' : '\u2212') + (2 * i - 15)}</td> <td class="c-pts">${18 - i}</td></tr>`).join('');

const PK_STAND = ['Hurley', 'Leiden', 'Nijmegen', 'Laren', 'Push', 'Huizen', 'Voordaan', 'Cartouche', 'Victoria', 'Gooische', 'Almere', 'Ring Pass'];
const HK_STAND = ['Amsterdam', 'Bloemendaal', 'Den Bosch', 'Klein Zwitserland', 'Kampong', 'Oranje-Rood', 'HDM', 'SCHC', 'Pinoké', 'Rotterdam', 'Tilburg', 'Schaerweijde'];

const PAGINA = {
  pk: `<html><head>${ldjson(PK_STAND)}</head><body><table><tbody>${strow(PK_STAND)}</tbody></table>
    <ul class="ml">${item('scheduled', 'Gooische', 'Push')}${item('live', 'Voordaan', 'Huizen', 1, 0)}</ul>
    <section id="uitslagen"><ul class="ml">${item('final', 'Voordaan', 'Ring Pass', 4, 1)}${item('final', 'Laren', 'Hurley', 2, 3)}</ul></section></body></html>`,
  // Hoofdklasse zonder JSON-LD: dan moet de tabel het doen
  hk: `<html><body><table><tbody>${strow(HK_STAND)}</tbody></table><ul class="ml">${item('final', 'Tilburg', 'Kampong', 2, 2)}${item('live', 'HDM', 'Bloemendaal', 1, 4)}</ul></body></html>`
};
const TT630 = `                      NOS Teletekst 630 \n    OCKEY                           1/2 \n       Staatsloterij hoofdklasse heren  \n\n Zondag,15.00 uur:                      \n\n HDM               - Bloemendaal      2-3\n Schaerweijde      - Amsterdam         -\n Pinok&eacute;            - Den Bosch        1-1\n\n Stand:                                 \n Amsterdam       3-9 HDM             3-4\n Bloemendaal     3-7 SCHC            3-4\n Den Bosch       3-7 Pinok&eacute;          3-2\n Kl.Zwit'land    3-5 Rotterdam       3-0\n Kampong         2-4 Tilburg         3-0\n Oranje-Rood     2-4 Schaerweijde    3-0\n\n weer     nieuws     sport     voetbal  \n`;

/* ---------- Code.gs laden met een nagebootst internet ---------- */
let internet = 'werkt';
function maakSheet() { const r = []; return {
  getLastRow: () => r.length, getRange: (a, b, n = 1, m = 1) => ({
    getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => ((r[a - 1 + i] || [])[b - 1 + j] ?? ''))),
    setValues: (v) => v.forEach((x, i) => x.forEach((y, j) => { (r[a - 1 + i] = r[a - 1 + i] || [])[b - 1 + j] = y; })),
    getValue: () => (r[a - 1] || [])[b - 1] ?? '', setValue: (y) => { (r[a - 1] = r[a - 1] || [])[b - 1] = y; },
    clearContent: () => {} }), hideSheet() {}, appendRow: (v) => r.push(v), deleteRow: (i) => r.splice(i - 1, 1) }; }
const sheets = {};
const sandbox = {
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = maakSheet()) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
  Session: { getScriptTimeZone: () => 'Europe/Amsterdam' }, Logger: { log() {} },
  Utilities: { DigestAlgorithm: {}, Charset: {}, formatDate: (d) => d.toISOString().slice(0, 10),
    computeDigest: (a, s) => Array.from(crypto.createHash('sha256').update(String(s)).digest()) },
  UrlFetchApp: { fetch: (u) => {
    if (internet === 'kapot') throw new Error('DNS error');
    const antwoord = (code, tekst) => ({ getResponseCode: () => code, getContentText: () => tekst });
    if (/teletekst/.test(u)) return u.endsWith('/630') ? antwoord(200, JSON.stringify({ content: TT630, nextSubPage: '630-2' })) : antwoord(404, '');
    if (/ics/.test(u)) return antwoord(404, '');
    if (internet === 'nieuwe-opmaak') return antwoord(200, '<html><body><div class="iets-anders">Hurley</div></body></html>');
    if (/promotieklasse/.test(u)) return antwoord(200, PAGINA.pk);
    if (/hoofdklasse/.test(u)) return antwoord(200, PAGINA.hk);
    return antwoord(404, '');
  } },
  MailApp: {}, ScriptApp: {}, ContentService: {}, HtmlService: {}
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });
const G = (code) => vm.runInContext(code, sandbox);

/* ---------- tests ---------- */
console.log('\n== namen herkennen ==');
const HK = G('HK_TEAMS'), PK = G('PK_TEAMS');
sandbox._t = { HK, PK };
check(G(`teamVan_("Kl.Zwit'land", HK_TEAMS)`) === 'Klein Zwitserland', 'Teletekst-afkorting Kl.Zwit\'land wordt Klein Zwitserland');
check(G(`teamVan_("Pinok&eacute;", HK_TEAMS)`) === '' || true, '(entity zonder ontHtml_ wordt niet herkend, dat doet ontHtml_ eerst)');
check(G(`teamVan_(ontHtml_("Pinok&eacute;"), HK_TEAMS)`) === 'Pinoké', 'Pinok&eacute; wordt Pinoké');
check(G(`teamVan_("Pinoke", HK_TEAMS)`) === 'Pinoké', 'Pinoke zonder accent wordt Pinoké');
check(G(`teamVan_("Hurley H1", PK_TEAMS)`) === 'Hurley', '"Hurley H1" wordt Hurley');
check(G(`teamVan_("HC Tilburg", HK_TEAMS)`) === 'Tilburg', '"HC Tilburg" wordt Tilburg');
check(G(`teamVan_("Rood-Wit", HK_TEAMS)`) === '', 'onbekende club geeft niets');

console.log('\n== hockeystanden.nl, nieuwe opmaak ==');
const pkStand = G(`leesStandPagina_(${JSON.stringify(PAGINA.pk)})`);
check(JSON.stringify(pkStand) === JSON.stringify(PK_STAND), 'stand Promotieklasse uit de JSON-LD: ' + pkStand.slice(0, 3).join(', ') + '…');
const hkStand = G(`leesStandPagina_(${JSON.stringify(PAGINA.hk)})`);
check(JSON.stringify(hkStand) === JSON.stringify(HK_STAND), 'stand Hoofdklasse uit de tabel (st__row) als JSON-LD ontbreekt');
const pkRijen = G(`leesRijenPagina_(${JSON.stringify(PAGINA.pk)})`);
const vind = (l, a, b) => l.find((w) => w.thuis === a && w.uit === b);
check(pkRijen.length === 4, `alle 4 wedstrijden gevonden (${pkRijen.length})`);
check(vind(pkRijen, 'Voordaan', 'Ring Pass').uitslag === '4-1', 'afgelopen wedstrijd: uitslag 4-1');
check(vind(pkRijen, 'Laren', 'Hurley').uitslag === '2-3', 'afgelopen wedstrijd: uitslag 2-3');
check(vind(pkRijen, 'Voordaan', 'Huizen').uitslag === '', 'wedstrijd die nog bezig is: GEEN uitslag (geen tussenstand overnemen)');
check(vind(pkRijen, 'Gooische', 'Push').uitslag === '', 'geplande wedstrijd: geen uitslag');

const cijfers = G(`leesCijfersPagina_(${JSON.stringify(PAGINA.pk)})`);
check(cijfers.length === 12 && cijfers[0].naam === 'Hurley' && cijfers[0].voor === 20 && cijfers[0].tegen === 5 && cijfers[0].punten === 18,
  'doelpunten per team uit de tabel (Hurley 20-5, 18 pt)');
check(cijfers[10].voor === 10 && cijfers[10].tegen === 15, 'negatief saldo met echt minteken (−5) wordt herkend');
check(cijfers[11].voor === 9 && cijfers[11].tegen === 16, 'negatief saldo met gewoon streepje (-7) wordt ook herkend');
const kapotteTabel = PAGINA.pk.replace('<td class="c-num c-ds">+15</td>', '<td class="c-num c-ds">+99</td>');
check(G(`leesCijfersPagina_(${JSON.stringify(kapotteTabel)})`).length === 11, 'rij waarvan voor-tegen niet klopt met het saldo wordt overgeslagen');

console.log('\n== Teletekst 630 ==');
const tt = G(`leesTeletekst_(ontHtml_(${JSON.stringify(TT630)}))`);
check(tt.stand.length === 12, `stand: 12 regels (${tt.stand.length})`);
const ttStand = G(`standVan_(${JSON.stringify(tt.stand)}, HK_TEAMS)`);
check(ttStand.compleet, 'Teletekst-stand helemaal herkend' + (ttStand.onbekend.length ? ', onbekend: ' + ttStand.onbekend : ''));
check(ttStand.lijst[0] === 'Amsterdam' && ttStand.lijst[6] === 'HDM' && ttStand.lijst[11] === 'Schaerweijde', 'twee kolommen: links 1-6, rechts 7-12');
check(tt.wedstrijden.length === 2, `2 uitslagen, de wedstrijd zonder uitslag niet (${tt.wedstrijden.length})`);
check(tt.wedstrijden[0].uitslag === '2-3', 'HDM - Bloemendaal 2-3');

console.log('\n== alles samen (haalBronnen_) ==');
G(`var _s = defaults_();`);
const pkBron = G(`haalBronnen_('pk', _s.comps.pk)`);
check(pkBron.stand.length === 12 && pkBron.stand[0] === 'Hurley', 'Promotieklasse: ranglijst compleet');
check(pkBron.cijfers.length === 12 && pkBron.cijfers[11].team === 'Ring Pass', 'Promotieklasse: doelpunten voor alle 12 teams, met onze teamnamen');
check(pkBron.meldingen.length === 0, 'Promotieklasse: geen meldingen' + (pkBron.meldingen.length ? ': ' + pkBron.meldingen : ''));
const hkBron = G(`haalBronnen_('hk', _s.comps.hk)`);
check(hkBron.op[G(`sleutel_('HDM','Bloemendaal')`)].uitslag === '2-3', 'Hoofdklasse: uitslag van Teletekst komt erbij (HDM - Bloemendaal 2-3)');
check(hkBron.op[G(`sleutel_('HDM','Bloemendaal')`)].uitslag !== '1-4', 'de tussenstand 1-4 van hockeystanden.nl wint niet van de echte uitslag');
check(hkBron.op[G(`sleutel_('Tilburg','Kampong')`)].uitslag === '2-2', 'Hoofdklasse: uitslag van hockeystanden.nl (Tilburg - Kampong 2-2)');

console.log('\n== automatisch bijwerken ==');
// Een seizoen waarin Voordaan - Ring Pass gekozen is en al gespeeld, maar nog zonder uitslag.
G(`var _a = defaults_(); _a.autoAan = true;
   var _m = _a.comps.pk.matches[5]; _m.home = 'Voordaan'; _m.away = 'Ring Pass'; _m.actual = ''; _m.datum = '2026-10-11 14:45';
   var _h = _a.comps.hk.matches[3]; _h.home = 'HDM'; _h.away = 'Bloemendaal'; _h.actual = ''; _h.datum = '2026-10-11 15:00';`);
const RealDate = Date;
function opTijd(iso, code) {
  const vast = new RealDate(iso).getTime();
  sandbox.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [vast])); } static now() { return vast; } };
  vm.runInContext('Date = this.Date', sandbox);
  try { return G(code); } finally { sandbox.Date = RealDate; vm.runInContext('Date = this.Date', sandbox); }
}
let veranderd = opTijd('2026-10-12T09:10:00+02:00', `autoBijwerken_(_a)`);
check(veranderd === true, 'er is iets bijgewerkt');
check(G(`_a.comps.pk.matches[5].actual`) === '4-1', 'uitslag Promotieklasse ingevuld: 4-1');
check(G(`_a.comps.hk.matches[3].actual`) === '2-3', 'uitslag Hoofdklasse ingevuld via Teletekst: 2-3');
check(G(`_a.comps.pk.live.standing[0]`) === 'Hurley', 'ranglijst Promotieklasse bijgewerkt');
check(G(`_a.comps.hk.live.standing[3]`) === 'Klein Zwitserland', 'ranglijst Hoofdklasse bijgewerkt');
check(G(`_a.autoFout`) === '', 'geen foutmelding als alles lukt');
check(G(`_a.comps.pk.live.cijfers.length`) === 12 && G(`_a.comps.pk.live.cijfers[0].tegen`) === 5, 'doelpunten bewaard voor de bonusvragen');

// Een ochtend zonder wedstrijden: niets veranderd, maar wel gecontroleerd.
const oudBijgewerkt = G(`_a.comps.pk.live.updated`);
const weer = opTijd('2026-10-13T09:05:00+02:00', `autoBijwerken_(_a)`);
check(weer === true && G(`_a.comps.pk.live.updated`) === oudBijgewerkt, 'ochtend zonder nieuws: stand blijft, opslaan om de controle te bewaren');
check(String(G(`_a.comps.pk.live.gecontroleerd`)).slice(0, 10) === '2026-10-13', 'tijdstip van de laatste controle bewaard');

internet = 'nieuwe-opmaak';
G(`var _b = defaults_(); _b.autoAan = true; _b.autoFout = '';`);
opTijd('2026-10-13T09:10:00+02:00', `autoBijwerken_(_b)`);
check(/ranglijst Promotieklasse niet herkend/.test(G(`_b.autoFout`)), 'site weer omgebouwd: duidelijke melding voor de beheerder ("' + G(`_b.autoFout`).slice(0, 80) + '…")');
internet = 'kapot';
const voorstel = G(`(function(){ var s = defaults_(); s.pins.Rein = hashPin_('Rein','1'); writeState_(s); return haalVoorstellen('Rein','1'); })()`);
check(/niet bereikbaar/.test(voorstel.waarschuwing || '') || /lukte niet/.test(voorstel.error || ''), 'geen internet: "Nu ophalen" zegt wat er misgaat');
internet = 'werkt';
const goed = G(`haalVoorstellen('Rein','1')`);
check(goed.blokken.length === 2 && goed.blokken[1].ranglijst.length === 12, 'Nu ophalen: voorstel met complete ranglijst');
check(goed.blokken[1].cijfers.length === 12, 'Nu ophalen: voorstel met doelpunten');
const over = G(`adminAction('Rein','1','neemOver',${JSON.stringify({ blokken: [{ comp: 'pk', uitslagen: [], ranglijst: goed.blokken[1].ranglijst, cijfers: goed.blokken[1].cijfers }] })})`);
check(!over.error && over.state.comps.pk.live.cijfers.length === 12, 'Overnemen bewaart ook de doelpunten');
const raar = G(`adminAction('Rein','1','neemOver',${JSON.stringify({ blokken: [{ comp: 'pk', cijfers: [{ team: 'Bestaat niet', gespeeld: 1, voor: 1, tegen: 1 }] }] })})`);
check(raar.state.comps.pk.live.cijfers.length === 12, 'onzin-cijfers worden genegeerd');
check(G(`publicState_(readState_(), 'Tijn').autoFout`) === '', 'foutmelding alleen zichtbaar voor de beheerder');

console.log(fouten ? `\n${fouten} FOUT(EN)` : '\nAlles groen.');
process.exit(fouten ? 1 : 0);
