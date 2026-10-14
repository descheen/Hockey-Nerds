/**
 * Hockey NERDS — web-app op Google Sheets
 * Plak dit in Extensies > Apps Script van je sheet, in het bestand Code.gs.
 * Zie INSTRUCTIES.md voor de installatie.
 */

var DATA_SHEET = '__APPDATA';
var N_MATCH = 22;
var VERSIE = 26;

// Verhoog dit als de punten veranderen, dan nemen bestaande poules ze over.
var PTS_VERSIE = 2;

// Hoeveel uur na de aanvang een wedstrijd zeker is afgelopen.
var WACHT_UUR = 2.5;

/**
 * Waar de app zijn gegevens vandaan haalt.
 * De pagina van hockeystanden.nl geeft de officiele ranglijst en de wedstrijden
 * rond vandaag. De agendafeed heeft alleen de Hoofdklasse, maar wel het hele
 * seizoen, dus die vult de gaten als je een paar weken niet kijkt.
 */
var BRON = {
  hk: {
    pagina: 'https://hockeystanden.nl/standen/staatsloterij-hoofdklasse-heren',
    feed: 'https://ics.maak-agenda.nl/v2/league/hoofdklasse-heren.ics'
  },
  pk: {
    pagina: 'https://hockeystanden.nl/standen/promotieklasse-heren',
    feed: ''
  }
};

/* ============ web-app ingang ============ */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Hockey NERDS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/* ============ opslag ============ */

function dataSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(DATA_SHEET);
  if (!sh) {
    sh = ss.insertSheet(DATA_SHEET);
    sh.getRange('A1').setValue('');
    try { sh.hideSheet(); } catch (e) {}
  }
  return sh;
}

function readState_() {
  var sh = dataSheet_();
  var last = Math.max(1, sh.getLastRow());
  var vals = sh.getRange(1, 1, last, 1).getValues();
  var raw = vals.map(function (r) { return r[0] === null ? '' : String(r[0]); }).join('');
  if (!raw) { var s = defaults_(); writeState_(s); return s; }
  try {
    return migrate_(JSON.parse(raw));
  } catch (e) {
    var f = defaults_();
    writeState_(f);
    return f;
  }
}

/**
 * Schrijft eerst en ruimt daarna pas op, zodat een onderbreking nooit alles wist.
 * De vorige toestand blijft in kolom B staan, dat is de ongedaan-maken-knop.
 */
function writeState_(state) {
  var sh = dataSheet_();
  var raw = JSON.stringify(state);
  var CHUNK = 40000; // celgrens is 50.000 tekens
  var parts = [];
  for (var i = 0; i < raw.length; i += CHUNK) parts.push([raw.substr(i, CHUNK)]);
  if (!parts.length) parts = [['']];

  var oudRijen = Math.max(0, sh.getLastRow());
  var oud = oudRijen > 0 ? sh.getRange(1, 1, oudRijen, 1).getValues() : [];
  while (oud.length && !String(oud[oud.length - 1][0] || '').length) oud.pop();   // lege staart weg
  if (oud.length && String(oud[0][0] || '').length) {
    sh.getRange(1, 2, oud.length, 1).setValues(oud);            // vorige toestand bewaren
    if (oudRijen > oud.length) sh.getRange(oud.length + 1, 2, oudRijen - oud.length, 1).clearContent();
    dagBackup_(oud.map(function (r) { return r[0]; }).join(''));
  }
  sh.getRange(1, 1, parts.length, 1).setValues(parts);           // eerst schrijven
  if (oudRijen > parts.length) {                                  // dan pas opruimen
    sh.getRange(parts.length + 1, 1, oudRijen - parts.length, 1).clearContent();
  }
  return state;
}

/** Hoogstens één back-up per dag, in een apart tabblad. */
function dagBackup_(raw) {
  try {
    if (!raw) return;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('__BACKUPS');
    if (!sh) { sh = ss.insertSheet('__BACKUPS'); try { sh.hideSheet(); } catch (e) {} }
    var vandaag = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var laatste = sh.getLastRow();
    if (laatste > 0 && String(sh.getRange(laatste, 1).getValue()) === vandaag) return;
    sh.appendRow([vandaag, raw.substring(0, 45000)]);
    while (sh.getLastRow() > 30) sh.deleteRow(1);                 // hoogstens 30 dagen bewaren
  } catch (e) { /* een mislukte back-up mag nooit het opslaan blokkeren */ }
}

/** Zet de vorige toestand terug (kolom B). */
function herstelVorige_() {
  var sh = dataSheet_();
  var laatste = Math.max(1, sh.getLastRow());
  var kolomB = sh.getRange(1, 2, laatste, 1).getValues()
    .map(function (r) { return r[0] === null ? '' : String(r[0]); }).join('');
  if (!kolomB) return null;
  var vorige;
  try { vorige = migrate_(JSON.parse(kolomB)); } catch (e) { return null; }
  writeState_(vorige);
  return vorige;
}

/* ============ startdata ============ */

var HK_TEAMS = ['Amsterdam', 'Bloemendaal', 'Den Bosch', 'HDM', 'Kampong', 'Klein Zwitserland',
  'Oranje-Rood', 'Pinoké', 'Rotterdam', 'SCHC', 'Schaerweijde', 'Tilburg'];
var PK_TEAMS = ['Almere', 'Cartouche', 'Gooische', 'Huizen', 'Hurley', 'Laren',
  'Leiden', 'Nijmegen', 'Push', 'Ring Pass', 'Victoria', 'Voordaan'];

/**
 * Alle wedstrijden per speelronde, zes per ronde, thuisploeg eerst.
 * Beide competities zijn compleet. Vul je een ronde aan via Beheer,
 * dan komt dat achter deze lijst.
 */
var PROGRAMMA = {
  hk: {
    0: ['SCHC - Oranje-Rood', 'Amsterdam - Tilburg', 'Den Bosch - Kampong', 'HDM - Schaerweijde', 'Bloemendaal - Rotterdam', 'Klein Zwitserland - Pinoké'],
    1: ['Schaerweijde - Klein Zwitserland', 'Rotterdam - Amsterdam', 'Pinoké - Bloemendaal', 'Kampong - SCHC', 'Tilburg - Den Bosch', 'Oranje-Rood - HDM'],
    2: ['SCHC - Tilburg', 'Amsterdam - Pinoké', 'Kampong - Oranje-Rood', 'Bloemendaal - Schaerweijde', 'Den Bosch - Rotterdam', 'Klein Zwitserland - HDM'],
    3: ['Schaerweijde - Amsterdam', 'Rotterdam - SCHC', 'HDM - Bloemendaal', 'Pinoké - Den Bosch', 'Oranje-Rood - Klein Zwitserland', 'Tilburg - Kampong'],
    4: ['SCHC - Pinoké', 'Amsterdam - HDM', 'Kampong - Rotterdam', 'Bloemendaal - Klein Zwitserland', 'Den Bosch - Schaerweijde', 'Tilburg - Oranje-Rood'],
    5: ['Schaerweijde - SCHC', 'Rotterdam - Tilburg', 'HDM - Den Bosch', 'Klein Zwitserland - Amsterdam', 'Pinoké - Kampong', 'Oranje-Rood - Bloemendaal'],
    6: ['Rotterdam - Oranje-Rood', 'SCHC - HDM', 'Amsterdam - Bloemendaal', 'Kampong - Schaerweijde', 'Den Bosch - Klein Zwitserland', 'Tilburg - Pinoké'],
    7: ['Schaerweijde - Tilburg', 'Bloemendaal - Den Bosch', 'HDM - Kampong', 'Klein Zwitserland - SCHC', 'Pinoké - Rotterdam', 'Oranje-Rood - Amsterdam'],
    8: ['Rotterdam - Schaerweijde', 'SCHC - Bloemendaal', 'Kampong - Klein Zwitserland', 'Den Bosch - Amsterdam', 'Pinoké - Oranje-Rood', 'Tilburg - HDM'],
    9: ['Schaerweijde - Pinoké', 'Amsterdam - SCHC', 'Bloemendaal - Kampong', 'Den Bosch - Oranje-Rood', 'HDM - Rotterdam', 'Klein Zwitserland - Tilburg'],
    10: ['Rotterdam - Klein Zwitserland', 'SCHC - Den Bosch', 'Kampong - Amsterdam', 'Pinoké - HDM', 'Oranje-Rood - Schaerweijde', 'Tilburg - Bloemendaal'],
    11: ['Schaerweijde - HDM', 'Rotterdam - Bloemendaal', 'Kampong - Den Bosch', 'Pinoké - Klein Zwitserland', 'Oranje-Rood - SCHC', 'Tilburg - Amsterdam'],
    12: ['SCHC - Kampong', 'Amsterdam - Rotterdam', 'Bloemendaal - Pinoké', 'Den Bosch - Tilburg', 'HDM - Oranje-Rood', 'Klein Zwitserland - Schaerweijde'],
    13: ['Schaerweijde - Bloemendaal', 'Rotterdam - Den Bosch', 'HDM - Klein Zwitserland', 'Pinoké - Amsterdam', 'Oranje-Rood - Kampong', 'Tilburg - SCHC'],
    14: ['SCHC - Rotterdam', 'Amsterdam - Schaerweijde', 'Kampong - Tilburg', 'Bloemendaal - HDM', 'Den Bosch - Pinoké', 'Klein Zwitserland - Oranje-Rood'],
    15: ['Schaerweijde - Den Bosch', 'Rotterdam - Kampong', 'HDM - Amsterdam', 'Klein Zwitserland - Bloemendaal', 'Pinoké - SCHC', 'Oranje-Rood - Tilburg'],
    16: ['SCHC - Schaerweijde', 'Amsterdam - Klein Zwitserland', 'Kampong - Pinoké', 'Bloemendaal - Oranje-Rood', 'Den Bosch - HDM', 'Tilburg - Rotterdam'],
    17: ['Schaerweijde - Kampong', 'Bloemendaal - Amsterdam', 'HDM - SCHC', 'Klein Zwitserland - Den Bosch', 'Pinoké - Tilburg', 'Oranje-Rood - Rotterdam'],
    18: ['Rotterdam - Pinoké', 'SCHC - Klein Zwitserland', 'Amsterdam - Oranje-Rood', 'Kampong - HDM', 'Den Bosch - Bloemendaal', 'Tilburg - Schaerweijde'],
    19: ['Schaerweijde - Rotterdam', 'Amsterdam - Den Bosch', 'Bloemendaal - SCHC', 'HDM - Tilburg', 'Klein Zwitserland - Kampong', 'Oranje-Rood - Pinoké'],
    20: ['Rotterdam - HDM', 'SCHC - Amsterdam', 'Kampong - Bloemendaal', 'Pinoké - Schaerweijde', 'Oranje-Rood - Den Bosch', 'Tilburg - Klein Zwitserland'],
    21: ['Schaerweijde - Oranje-Rood', 'Amsterdam - Kampong', 'Bloemendaal - Tilburg', 'Den Bosch - SCHC', 'HDM - Pinoké', 'Klein Zwitserland - Rotterdam']
  },
  pk: {
    0: ['Gooische - Voordaan', 'Huizen - Laren', 'Nijmegen - Hurley', 'Push - Almere',
      'Leiden - Cartouche', 'Ring Pass - Victoria'],
    1: ['Almere - Ring Pass', 'Cartouche - Huizen', 'Victoria - Leiden', 'Hurley - Gooische',
      'Laren - Nijmegen', 'Voordaan - Push'],
    2: ['Gooische - Laren', 'Huizen - Victoria', 'Hurley - Voordaan', 'Leiden - Almere',
      'Nijmegen - Cartouche', 'Ring Pass - Push'],
    3: ['Almere - Huizen', 'Cartouche - Gooische', 'Push - Leiden', 'Victoria - Nijmegen',
      'Voordaan - Ring Pass', 'Laren - Hurley'],
    4: ['Gooische - Victoria', 'Huizen - Push', 'Hurley - Cartouche', 'Leiden - Ring Pass',
      'Nijmegen - Almere', 'Laren - Voordaan'],
    5: ['Almere - Gooische', 'Cartouche - Laren', 'Push - Nijmegen', 'Ring Pass - Huizen',
      'Victoria - Hurley', 'Voordaan - Leiden'],
    6: ['Cartouche - Voordaan', 'Gooische - Push', 'Huizen - Leiden', 'Hurley - Almere',
      'Nijmegen - Ring Pass', 'Laren - Victoria'],
    7: ['Almere - Laren', 'Leiden - Nijmegen', 'Push - Hurley', 'Ring Pass - Gooische',
      'Victoria - Cartouche', 'Voordaan - Huizen'],
    8: ['Cartouche - Almere', 'Gooische - Leiden', 'Hurley - Ring Pass', 'Nijmegen - Huizen',
      'Victoria - Voordaan', 'Laren - Push'],
    9: ['Almere - Victoria', 'Huizen - Gooische', 'Leiden - Hurley', 'Nijmegen - Voordaan',
      'Push - Cartouche', 'Ring Pass - Laren'],
    10: ['Cartouche - Ring Pass', 'Gooische - Nijmegen', 'Hurley - Huizen', 'Victoria - Push',
      'Voordaan - Almere', 'Laren - Leiden'],
    11: ['Almere - Push', 'Cartouche - Leiden', 'Hurley - Nijmegen', 'Victoria - Ring Pass',
      'Voordaan - Gooische', 'Laren - Huizen'],
    12: ['Gooische - Hurley', 'Huizen - Cartouche', 'Leiden - Victoria', 'Nijmegen - Laren',
      'Push - Voordaan', 'Ring Pass - Almere'],
    13: ['Almere - Leiden', 'Cartouche - Nijmegen', 'Push - Ring Pass', 'Victoria - Huizen',
      'Voordaan - Hurley', 'Laren - Gooische'],
    14: ['Gooische - Cartouche', 'Huizen - Almere', 'Hurley - Laren', 'Leiden - Push',
      'Nijmegen - Victoria', 'Ring Pass - Voordaan'],
    15: ['Almere - Nijmegen', 'Cartouche - Hurley', 'Push - Huizen', 'Ring Pass - Leiden',
      'Victoria - Gooische', 'Voordaan - Laren'],
    16: ['Gooische - Almere', 'Huizen - Ring Pass', 'Hurley - Victoria', 'Leiden - Voordaan',
      'Nijmegen - Push', 'Laren - Cartouche'],
    17: ['Almere - Hurley', 'Leiden - Huizen', 'Push - Gooische', 'Ring Pass - Nijmegen',
      'Victoria - Laren', 'Voordaan - Cartouche'],
    18: ['Cartouche - Victoria', 'Gooische - Ring Pass', 'Huizen - Voordaan', 'Hurley - Push',
      'Nijmegen - Leiden', 'Laren - Almere'],
    19: ['Almere - Cartouche', 'Huizen - Nijmegen', 'Leiden - Gooische', 'Push - Laren',
      'Ring Pass - Hurley', 'Voordaan - Victoria'],
    20: ['Cartouche - Push', 'Gooische - Huizen', 'Hurley - Leiden', 'Victoria - Almere',
      'Voordaan - Nijmegen', 'Laren - Ring Pass'],
    21: ['Almere - Voordaan', 'Huizen - Hurley', 'Leiden - Laren', 'Nijmegen - Gooische',
      'Push - Victoria', 'Ring Pass - Cartouche']
  }
};

function blankPred_() {
  return {
    wvdw: fill_(N_MATCH, ''), standing: fill_(12, ''),
    kampioen: '', winter: '', topscorer: '', minsteTegen: '', meestScorend: '', speler: ''
  };
}
function fill_(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }

function blankComp_(name, teams) {
  var matches = [];
  for (var i = 0; i < N_MATCH; i++) matches.push({ home: '', away: '', label: '', actual: '', deadline: '', datum: '' });
  return {
    name: name, teams: teams.slice(), matches: matches, preds: {},
    live: { standing: fill_(12, ''), updated: '' },
    result: {
      standing: fill_(12, ''),
      kampioen: '', winter: '', topscorer: '', minsteTegen: '', meestScorend: '', speler: ''
    }
  };
}

function defaults_() {
  var s = {
    rev: 0,
    season: '2026-2027',
    admin: 'Rein',
    predsLocked: false,
    bekers: [{ seizoen: '2025-2026', winnaar: 'PB' }],
    pins: {},
    emails: {},
    appUrl: '',
    herinnerAan: false,
    herinnerd: {},
    autoAan: false,
    autoBericht: '',
    players: ['Rein', 'Tijn', 'PB', 'David'],
    beurten: ['Rein', 'Tijn', 'PB', 'David'],
    ptsVersie: PTS_VERSIE,
    pts: {
      kampioen: 30, kampioenPk: 5, winter: 10, topscorer: 20, speler: 10,
      minsteTegen: 10, meestScorend: 10,
      exact: 10, scoreWin: 7, win: 5, score: 2, positie: 10
    },
    comps: { hk: blankComp_('Hoofdklasse', HK_TEAMS), pk: blankComp_('Promotieklasse', PK_TEAMS) }
  };
  ['hk', 'pk'].forEach(function (ck) {
    s.players.forEach(function (p) { s.comps[ck].preds[p] = blankPred_(); });
  });
  seed_(s, 'hk', 'Rein',
    ['Amsterdam', 'Oranje-Rood', 'Den Bosch', 'Rotterdam', 'Bloemendaal', 'Pinoké', 'Kampong',
      'Klein Zwitserland', 'SCHC', 'HDM', 'Schaerweijde', 'Tilburg'],
    'Amsterdam', 'Amsterdam', 'Miles Bukkens', 'Oranje-Rood', 'Rotterdam');
  seed_(s, 'hk', 'PB',
    ['Amsterdam', 'Rotterdam', 'Den Bosch', 'Oranje-Rood', 'Kampong', 'Bloemendaal', 'Pinoké',
      'Klein Zwitserland', 'SCHC', 'HDM', 'Schaerweijde', 'Tilburg'],
    'Den Bosch', 'Amsterdam', 'Timo Boers', 'Oranje-Rood', 'Rotterdam');
  seed_(s, 'pk', 'Rein',
    ['Laren', 'Hurley', 'Leiden', 'Voordaan', 'Nijmegen', 'Cartouche', 'Huizen', 'Victoria',
      'Gooische', 'Almere', 'Ring Pass', 'Push'],
    'Laren', 'Leiden', 'Bosman', 'Laren', 'Leiden');
  seed_(s, 'pk', 'PB',
    ['Laren', 'Hurley', 'Leiden', 'Voordaan', 'Huizen', 'Nijmegen', 'Cartouche', 'Victoria',
      'Almere', 'Ring Pass', 'Gooische', 'Push'],
    'Laren', 'Laren', '', 'Laren', 'Laren');
  return s;
}

function seed_(s, ck, player, standing, kampioen, winter, top, tegen, scorend) {
  var pr = s.comps[ck].preds[player];
  pr.standing = standing; pr.kampioen = kampioen; pr.winter = winter; pr.topscorer = top;
  pr.minsteTegen = tegen; pr.meestScorend = scorend;
}

function migrate_(d) {
  var base = defaults_();
  d.rev = d.rev || 0;
  d.players = d.players || base.players;
  d.admin = d.admin || base.admin;
  d.pins = d.pins || {};
  d.emails = d.emails || {};
  d.herinnerd = d.herinnerd || {};
  d.herinnerAan = !!d.herinnerAan;
  d.autoAan = !!d.autoAan;
  d.autoBericht = d.autoBericht || '';
  d.autoFout = d.autoFout || '';
  d.appUrl = d.appUrl || '';
  d.predsLocked = !!d.predsLocked;
  // beurtvolgorde: alleen bestaande spelers, en iedereen die ontbreekt komt achteraan
  var volgorde = (d.beurten || []).filter(function (n) { return d.players.indexOf(n) >= 0; });
  d.players.forEach(function (p) { if (volgorde.indexOf(p) < 0) volgorde.push(p); });
  d.beurten = volgorde.length ? volgorde : d.players.slice();
  if (!Array.isArray(d.bekers)) d.bekers = base.bekers;
  d.pts = d.pts || {};
  // Nieuwe puntentelling: die nemen we over, ook als er al iets stond.
  if ((d.ptsVersie || 0) < PTS_VERSIE) { d.pts = base.pts; d.ptsVersie = PTS_VERSIE; }
  for (var k in base.pts) if (d.pts[k] === undefined) d.pts[k] = base.pts[k];
  d.comps = d.comps || {};
  ['hk', 'pk'].forEach(function (ck) {
    if (!d.comps[ck]) d.comps[ck] = base.comps[ck];
    var c = d.comps[ck];
    c.ck = ck;
    c.matches = c.matches || [];
    while (c.matches.length < N_MATCH) c.matches.push({ home: '', away: '', label: '', actual: '' });
    c.matches.forEach(function (m) {
      if (m.home === undefined) m.home = '';
      if (m.away === undefined) m.away = '';
      if (m.label === undefined) m.label = '';
      if (m.deadline === undefined) m.deadline = '';
      if (m.datum === undefined) m.datum = '';
    });
    if (!c.live || !c.live.standing) c.live = { standing: fill_(12, ''), updated: '' };
    c.result = c.result || base.comps[ck].result;
    c.teams = c.teams && c.teams.length ? c.teams : base.comps[ck].teams;
    if (c.result.kampioen === undefined) c.result.kampioen = '';
    // Speeldatum uit de kalender. Een handmatig sluitmoment blijft altijd staan.
    c.matches.forEach(function (m, i) {
      if (!m.datum && KALENDER[ck] && KALENDER[ck][i]) m.datum = KALENDER[ck][i];
      // Het officiele programma van deze ronde staat voorop, zelf toegevoegde
      // wedstrijden komen erachter en blijven dus gewoon staan.
      if (!Array.isArray(m.programma)) m.programma = [];
      var vast = (PROGRAMMA[ck] && PROGRAMMA[ck][i]) ? PROGRAMMA[ck][i] : [];
      if (vast.length) {
        var eigen = m.programma.filter(function (w) { return vast.indexOf(w) < 0; });
        m.programma = vast.concat(eigen).slice(0, 12);
      }
    });
    c.preds = c.preds || {};
    d.players.forEach(function (p) { if (!c.preds[p]) c.preds[p] = blankPred_(); });
    // De kampioen wordt via de play-offs beslist, dus dat is een eigen voorspelling.
    // Wie hem nog niet apart heeft ingevuld, krijgt zijn nummer 1 als startwaarde.
    Object.keys(c.preds).forEach(function (p) {
      var pr = c.preds[p];
      if (pr.kampioen === undefined) pr.kampioen = pr.standing[0] || '';
      if (pr.speler === undefined) pr.speler = '';
    });
    if (c.result.speler === undefined) c.result.speler = '';
  });
  return d;
}

/* ============ speeldagenkalender ============ */

/**
 * De officiële speeldagen per competitie, seizoen 2026-2027.
 * Hieruit komen de sluitmomenten. Wijkt een wedstrijd af, dan zet de beheerder
 * het sluitmoment handmatig; dat overschrijft de kalender.
 */
var KALENDER = {
  hk: [
    '2026-09-27 15:00', '2026-10-04 15:00', '2026-10-11 15:00', '2026-10-18 15:00',
    '2026-10-22 20:30', '2026-10-25 15:00', '2026-11-01 15:00', '2026-11-08 15:00',
    '2026-11-15 15:00', '2026-11-19 20:30', '2026-11-22 15:00', '2026-11-28 16:30',
    '2027-03-14 15:00', '2027-03-21 15:00', '2027-04-04 15:00', '2027-04-08 20:30',
    '2027-04-11 15:00', '2027-04-18 15:00', '2027-04-22 20:30', '2027-04-25 15:00',
    '2027-05-02 15:00', '2027-05-09 15:00'
  ],
  pk: [
    '2026-09-06 14:45', '2026-09-13 14:45', '2026-09-20 14:45', '2026-09-27 14:45',
    '2026-10-04 14:45', '2026-10-11 14:45', '2026-10-25 14:45', '2026-11-01 14:45',
    '2026-11-08 14:45', '2026-11-15 14:45', '2026-11-22 14:45', '2027-03-07 14:45',
    '2027-03-14 14:45', '2027-03-21 14:45', '2027-04-04 14:45', '2027-04-11 14:45',
    '2027-04-18 14:45', '2027-04-25 14:45', '2027-05-02 14:45', '2027-05-09 14:45',
    '2027-05-16 14:45', '2027-05-23 14:45'
  ]
};

function parseDatum_(s) {
  if (!s) return null;
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}

/** De laatste vrijdag vóór deze datum, om 18:00. */
function vrijdagVoor_(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), SLUIT_UUR, SLUIT_MIN, 0, 0);
  // Doordeweekse ronde: de vrijdag ervoor ligt bijna een week eerder, dus nemen we de dag ervoor.
  if (d.getDay() !== 0 && d.getDay() !== 6) { x.setDate(x.getDate() - 1); return x; }
  do { x.setDate(x.getDate() - 1); } while (x.getDay() !== 5);
  return x;
}

/** Speelt deze ronde in het weekend? Zo niet, dan klopt vrijdag 18:00 waarschijnlijk niet. */
function wijktAf_(s, ck, ronde) {
  var d = parseDatum_(datumVan_(s, ck, ronde));
  if (!d) return false;
  return d.getDay() !== 0 && d.getDay() !== 6;
}

function datumVan_(s, ck, ronde) {
  var m = s.comps[ck] && s.comps[ck].matches[ronde];
  if (m && m.datum) return m.datum;
  return (KALENDER[ck] && KALENDER[ck][ronde]) || '';
}

/* ============ sluitmoment ============ */

var SLUIT_UUR = 18, SLUIT_MIN = 0;

/**
 * Het sluitmoment van een ronde, per competitie.
 * Een handmatig gezet moment wint van de kalender, behalve als het ná de wedstrijd ligt.
 * Zo'n moment klopt niet en wordt genegeerd.
 */
function deadlineVoor_(s, ck, ronde) {
  var m = s.comps[ck] && s.comps[ck].matches[ronde];
  if (!m) return '';
  var d = parseDatum_(datumVan_(s, ck, ronde));
  if (m.deadline) {
    var hand = new Date(m.deadline);
    if (!d || (!isNaN(hand.getTime()) && hand.getTime() < d.getTime())) return m.deadline;
  }
  if (!d) return '';
  return vrijdagVoor_(d).toISOString();
}

/** Is de ronde dicht? Na het sluitmoment, of zodra de uitslag er staat. */
function rondeDicht_(s, ck, ronde) {
  var m = s.comps[ck] && s.comps[ck].matches[ronde];
  if (!m) return true;
  if (String(m.actual || '').trim()) return true;
  var dl = deadlineVoor_(s, ck, ronde);
  if (!dl) return false;
  return new Date().getTime() >= new Date(dl).getTime();
}

/** Blijft bestaan zodat oude aanroepen niets stukmaken; de kalender regelt het nu. */
function zorgDeadlines_(s) { return false; }

/* ============ wie is er aan de beurt ============ */

/** Wie mag speelronde i (0-based) uitkiezen. Dezelfde persoon kiest beide klassen. */
function beurtVoor_(s, i) {
  var b = s.beurten && s.beurten.length ? s.beurten : s.players;
  if (!b.length) return '';
  return b[i % b.length];
}

/** De eerstvolgende ronde die nog niet in beide klassen is gespeeld. */
function huidigeRonde_(s) {
  for (var i = 0; i < N_MATCH; i++) {
    var klaar = ['hk', 'pk'].every(function (ck) {
      var m = s.comps[ck] && s.comps[ck].matches[i];
      return m && String(m.actual || '').trim();
    });
    if (!klaar) return i;
  }
  return N_MATCH - 1;
}

/**
 * De eindstand-voorspellingen van een competitie gaan vanzelf op slot zodra
 * die competitie begonnen is. Daarna kan niemand er meer aan, ook de beheerder
 * niet, en ziet iedereen elkaars voorspelling.
 */
function predsDicht_(s, ck) {
  if (s.predsLocked) return true;
  var d = parseDatum_(datumVan_(s, ck, 0));
  return !!(d && new Date().getTime() >= d.getTime());
}

/* ============ wat de browser mag zien ============ */

/**
 * Stuurt nooit pincodes mee, en verbergt de voorspellingen van anderen
 * zolang die nog niet vaststaan. Ook voor de beheerder, anders is het niet eerlijk.
 */
function publicState_(s, who) {
  var out = JSON.parse(JSON.stringify(s));
  var pinFlags = {};
  Object.keys(s.pins || {}).forEach(function (k) { pinFlags[k] = true; });
  out.pins = pinFlags;
  out.versie = VERSIE;
  // E-mailadressen zijn niemands zaak behalve die van de beheerder.
  if (who !== s.admin) { out.emails = {}; out.appUrl = ''; out.herinnerd = {}; out.autoFout = ''; }

  ['hk', 'pk'].forEach(function (ck) {
    var c = out.comps[ck];
    var eindstandBekend = !!String(c.result.standing[0] || '').trim();
    c.dicht = predsDicht_(s, ck);
    c.mist = mistUitslagen_(s, ck);
    var toonPreds = c.dicht || eindstandBekend;
    Object.keys(c.preds).forEach(function (p) {
      if (p === who) return;
      var pr = c.preds[p];
      // De ingevulde uitslagen zijn meteen voor iedereen zichtbaar, ook voor
      // het sluitmoment. Aanpassen kan nog steeds alleen tot de ronde sluit.
      if (!toonPreds) {
        pr.standing = fill_(12, '');
        pr.kampioen = ''; pr.winter = ''; pr.topscorer = ''; pr.minsteTegen = ''; pr.meestScorend = '';
      }
    });
  });
  return out;
}

/* ============ inloggen ============ */

/** Pincodes staan versleuteld opgeslagen, niemand kan ze uit de sheet lezen. */
function hashPin_(who, pin) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, 'hockeynerds|' + who + '|' + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function isHash_(v) { return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v); }

/** Klopt de pincode? Oude, leesbaar opgeslagen codes worden stilletjes omgezet. */
function pinKlopt_(s, who, pin) {
  var opgeslagen = s.pins[who];
  if (!opgeslagen) return { ok: false, nieuw: true };
  if (isHash_(opgeslagen)) return { ok: opgeslagen === hashPin_(who, pin) };
  if (String(opgeslagen) === String(pin)) {
    s.pins[who] = hashPin_(who, pin);
    return { ok: true, omgezet: true };
  }
  return { ok: false };
}

function login(who, pin) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var s = readState_();
    pin = String(pin || '').trim();
    if (s.players.indexOf(who) < 0) return { error: 'Onbekende speler.' };
    if (!pin) return { error: 'Vul een pincode in.' };
    if (pin.length > 40) return { error: 'Die pincode is wel erg lang.' };
    var check = pinKlopt_(s, who, pin);
    if (check.nieuw) { s.pins[who] = hashPin_(who, pin); writeState_(s); }
    else if (check.omgezet) { writeState_(s); }
    else if (!check.ok) return { error: 'Pincode klopt niet.' };
    if (zorgDeadlines_(s)) writeState_(s);
    return { ok: true, who: who, admin: who === s.admin, state: publicState_(s, who) };
  } finally {
    lock.releaseLock();
  }
}

function getState(who, pin) {
  var s = readState_();
  if (!who || !pinKlopt_(s, who, String(pin)).ok) return { error: 'Niet ingelogd.' };
  return { state: publicState_(s, who), who: who, admin: who === s.admin };
}

function getPlayers() {
  var s = readState_();
  var claimed = {};
  s.players.forEach(function (p) { claimed[p] = !!s.pins[p]; });
  return { players: s.players, claimed: claimed, season: s.season, admin: s.admin };
}

/* ============ opslaan ============ */

/**
 * patches: [{path:[...], value:...}]
 * Alleen toegestane paden worden toegepast, de rest wordt genegeerd en teruggemeld.
 */
function applyPatches(who, pin, patchesJson) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var s = readState_();
    if (!who || !pinKlopt_(s, who, String(pin)).ok) return { error: 'Niet ingelogd.' };
    var admin = who === s.admin;
    var patches = JSON.parse(patchesJson);
    if (!Array.isArray(patches) || patches.length > 200) return { error: 'Te veel wijzigingen in één keer.' };
    var refused = [];
    zorgDeadlines_(s);
    patches.forEach(function (p) {
      var vorm = controleerPatch_(p);
      if (vorm) { refused.push(vorm); return; }
      var why = denyReason_(s, who, admin, p.path);
      if (why) { refused.push(why); return; }
      setPath_(s, p.path, p.value);
    });
    s.rev = (s.rev || 0) + 1;
    s.updatedAt = new Date().toISOString();
    writeState_(s);
    return { state: publicState_(s, who), refused: refused };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Kijkt of de wijziging er überhaupt uitziet als iets dat wij verwachten.
 * Geeft null als het in orde is, anders de klacht.
 */
function verdachtVeld_(v) {
  return v === '__proto__' || v === 'constructor' || v === 'prototype';
}
function controleerPatch_(p) {
  if (!p || !Array.isArray(p.path) || !p.path.length || p.path.length > 6) return 'Onbegrijpelijke wijziging.';
  if (p.path[0] !== 'comps') return 'Alleen de beheerder kan dit aanpassen.';
  for (var i = 0; i < p.path.length; i++) {
    var deel = p.path[i];
    if (typeof deel === 'number') {
      if (!(deel >= 0 && deel < 100)) return 'Ongeldige positie.';
      continue;
    }
    if (typeof deel !== 'string' || !deel.length || deel.length > 40) return 'Onbekend veld.';
    if (verdachtVeld_(deel)) return 'Onbekend veld.';
  }
  var v = p.value;
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return 'Alleen tekst mag opgeslagen worden.';
  if (v.length > 60) return 'Dat is te lang, houd het kort.';
  var laatste = p.path[p.path.length - 1];
  var opEen = p.path[p.path.length - 2];
  if ((laatste === 'actual' || opEen === 'wvdw') && v.trim() && !parseScore_(v)) {
    return 'Een uitslag ziet eruit als 3-1.';
  }
  return null;
}

/** Geeft null terug als het mag, anders de reden. */
function denyReason_(s, who, admin, path) {
  if (path[0] !== 'comps') return 'Alleen de beheerder kan dit aanpassen.';
  var ck = path[1], kind = path[2];
  if (!s.comps[ck]) return 'Onbekende competitie.';

  // Het sluitmoment geldt voor iedereen, ook voor de beheerder.
  if (kind === 'preds' && path[4] === 'wvdw') {
    var r1 = Number(path[5]);
    if (rondeDicht_(s, ck, r1)) {
      return 'Speelronde ' + (r1 + 1) + ' is gesloten, je kunt niets meer wijzigen.';
    }
  }
  if (kind === 'matches' && (path[4] === 'home' || path[4] === 'away')) {
    var r2 = Number(path[3]);
    if (rondeDicht_(s, ck, r2)) return 'Speelronde ' + (r2 + 1) + ' is gesloten.';
  }
  // Ook de beheerder komt niet meer aan een eindstand als de competitie loopt.
  if (kind === 'preds' && path[4] !== 'wvdw' && predsDicht_(s, ck)) {
    return 'De eindstand-voorspellingen van ' + s.comps[ck].name + ' staan vast.';
  }

  if (admin) return null;

  // wie aan de beurt is, mag zelf de wedstrijd van die week uitkiezen
  if (kind === 'matches' && (path[4] === 'home' || path[4] === 'away')) {
    var ronde = Number(path[3]);
    if (beurtVoor_(s, ronde) !== who) {
      return 'Speelronde ' + (ronde + 1) + ' is aan ' + beurtVoor_(s, ronde) + '.';
    }
    return null;
  }

  if (kind !== 'preds') return 'Alleen de beheerder vult uitslagen in.';
  if (path[3] !== who) return 'Je kunt alleen je eigen voorspellingen invullen.';
  if (path[4] === 'wvdw') return null;
  return null;
}

function setPath_(obj, path, value) {
  var o = obj;
  for (var i = 0; i < path.length - 1; i++) {
    var k = path[i];
    if (o[k] === undefined || o[k] === null) o[k] = (typeof path[i + 1] === 'number') ? [] : {};
    o = o[k];
  }
  o[path[path.length - 1]] = value;
  return obj;
}

/* ============ beheer ============ */

function adminAction(who, pin, action, arg) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var s = readState_();
    if (!who || !pinKlopt_(s, who, String(pin)).ok || who !== s.admin) return { error: 'Alleen de beheerder.' };

    // ongedaan maken staat los: die schrijft zijn eigen toestand terug
    if (action === 'herstelVorige') {
      var vorige = herstelVorige_();
      if (!vorige) return { error: 'Er is niets om naar terug te gaan.' };
      return { state: publicState_(vorige, who), hersteld: true };
    }
    // Vervroegd op slot kan altijd. Openzetten alleen zolang beide competities
    // nog niet begonnen zijn, anders zou je het slot kunnen omzeilen.
    if (action === 'togglePredsLock') {
      if (s.predsLocked && ['hk', 'pk'].some(function (ck) {
        var d = parseDatum_(datumVan_(s, ck, 0));
        return d && new Date().getTime() >= d.getTime();
      })) {
        return { error: 'De competitie is al begonnen, openzetten kan niet meer.' };
      }
      s.predsLocked = !s.predsLocked;
    }
    if (action === 'resetPin') delete s.pins[arg];
    if (action === 'addPlayer') {
      var n = String(arg || '').trim();
      if (n && s.players.indexOf(n) < 0) {
        s.players.push(n);
        s.beurten.push(n);
        ['hk', 'pk'].forEach(function (ck) { s.comps[ck].preds[n] = blankPred_(); });
      }
    }
    if (action === 'removePlayer') {
      var i = s.players.indexOf(arg);
      if (i >= 0) {
        s.players.splice(i, 1);
        delete s.pins[arg];
        var bi = s.beurten.indexOf(arg);
        if (bi >= 0) s.beurten.splice(bi, 1);
        ['hk', 'pk'].forEach(function (ck) { delete s.comps[ck].preds[arg]; });
      }
    }
    if (action === 'setTeams') {
      s.comps[arg.comp].teams = arg.teams;
    }
    if (action === 'setBeurten') {
      var nieuw = (arg || []).filter(function (n) { return s.players.indexOf(n) >= 0; });
      s.players.forEach(function (p) { if (nieuw.indexOf(p) < 0) nieuw.push(p); });
      if (nieuw.length) s.beurten = nieuw;
    }
    // --- competitiestand ---
    if (action === 'pasteLive') {
      var c1 = s.comps[arg.comp];
      c1.live.standing = normaliseerTeams_(arg.text, c1.teams);
      c1.live.updated = new Date().toISOString();
    }
    // --- wat de agenda voorstelde, na akkoord van de beheerder ---
    if (action === 'neemOver') {
      (arg.blokken || []).forEach(function (blok) {
        var oc = s.comps[blok.comp];
        if (!oc) return;
        (blok.uitslagen || []).forEach(function (u) {
          var r = Number(u.ronde);
          if (r >= 0 && r < N_MATCH && /^\d{1,2}-\d{1,2}$/.test(String(u.uitslag || ''))) {
            if (!String(oc.matches[r].actual || '').trim()) oc.matches[r].actual = String(u.uitslag);
          }
        });
        if ((blok.ranglijst || []).length) {
          var lijst = normaliseerTeams_(blok.ranglijst.join('\n'), oc.teams);
          if (lijst.filter(Boolean).length === 12) {
            oc.live.standing = lijst;
            oc.live.updated = new Date().toISOString();
          }
        }
        // Doelpunten per team, alleen als het er twaalf zijn met bekende teams en echte getallen.
        var cf = (blok.cijfers || []).filter(function (c) {
          return c && oc.teams.indexOf(c.team) >= 0 && [c.gespeeld, c.voor, c.tegen].every(function (n) { return typeof n === 'number' && n >= 0 && n < 1000; });
        }).map(function (c) { return { team: c.team, gespeeld: c.gespeeld, voor: c.voor, tegen: c.tegen, punten: typeof c.punten === 'number' ? c.punten : null }; });
        if (cf.length === 12) oc.live.cijfers = cf;
      });
    }
    // --- herinnering ---
    if (action === 'setEmail') {
      var sp = String(arg.speler || '').trim(), ad = String(arg.adres || '').trim();
      if (s.players.indexOf(sp) >= 0) {
        if (!ad) delete s.emails[sp];
        else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ad)) s.emails[sp] = ad;
        else return { error: 'Dat lijkt geen e-mailadres.' };
      }
    }
    if (action === 'setAppUrl') s.appUrl = String(arg || '').trim();
    if (action === 'herinnering' || action === 'autoBijwerken') {
      if (action === 'herinnering') s.herinnerAan = !!arg; else s.autoAan = !!arg;
      try {
        regelTrigger_(s);
      } catch (e) {
        return { error: 'De taak instellen lukte niet. ' + ((e && e.message) ? e.message : e) };
      }
    }
    if (action === 'testHerinnering') {
      var melding = stuurHerinnering_(s, true);
      s.rev = (s.rev || 0) + 1;
      writeState_(s);
      return { state: publicState_(s, who), melding: melding };
    }
    if (action === 'clearLive') {
      s.comps[arg].live = { standing: fill_(12, ''), updated: '' };
    }
    if (action === 'liveNaarWinter') {
      var c2 = s.comps[arg];
      if (c2.live.standing[0]) s.comps[arg].result.winter = c2.live.standing[0];
    }
    if (action === 'liveNaarEindstand') {
      var c3 = s.comps[arg];
      c3.result.standing = c3.live.standing.slice();
    }
    // --- programma van een speelronde ---
    if (action === 'setProgramma') {
      var pc = s.comps[arg.comp], pr0 = Number(arg.ronde);
      if (pc && pr0 >= 0 && pr0 < N_MATCH) {
        pc.matches[pr0].programma = leesProgramma_(arg.text, pc.teams);
      }
    }
    if (action === 'wisProgramma') {
      var wc = s.comps[arg.comp], wr = Number(arg.ronde);
      if (wc && wr >= 0 && wr < N_MATCH) wc.matches[wr].programma = [];
    }
    // --- sluitmoment ---
    if (action === 'setDeadline') {
      var ronde = Number(arg.ronde);
      var welke = (arg.comp === 'hk' || arg.comp === 'pk') ? [arg.comp] : ['hk', 'pk'];
      if (ronde >= 0 && ronde < N_MATCH && arg.wanneer) {
        var wanneer = new Date(arg.wanneer);
        if (!isNaN(wanneer.getTime())) {
          welke.forEach(function (ck) { s.comps[ck].matches[ronde].deadline = wanneer.toISOString(); });
        }
      }
    }
    if (action === 'wisDeadline') {
      var r0 = Number(arg.ronde);
      var welke0 = (arg.comp === 'hk' || arg.comp === 'pk') ? [arg.comp] : ['hk', 'pk'];
      if (r0 >= 0 && r0 < N_MATCH) {
        welke0.forEach(function (ck) { s.comps[ck].matches[r0].deadline = ''; });
      }
    }
    // --- bekers en seizoenswissel ---
    if (action === 'setBeker') {
      var seizoen = String(arg.seizoen || '').trim(), winnaar = String(arg.winnaar || '').trim();
      if (seizoen && winnaar) {
        s.bekers = (s.bekers || []).filter(function (b) { return b.seizoen !== seizoen; });
        s.bekers.push({ seizoen: seizoen, winnaar: winnaar });
      }
    }
    if (action === 'verwijderBeker') {
      s.bekers = (s.bekers || []).filter(function (b) { return b.seizoen !== arg; });
    }
    if (action === 'nieuwSeizoen') {
      var nieuw = String(arg.seizoen || '').trim();
      var kampioen = String(arg.winnaar || '').trim();
      if (!nieuw) return { error: 'Geef het nieuwe seizoen een naam.' };
      var bekers = (s.bekers || []).slice();
      if (kampioen) {
        bekers = bekers.filter(function (b) { return b.seizoen !== s.season; });
        bekers.push({ seizoen: s.season, winnaar: kampioen });
      }
      var pins = s.pins, spelers = s.players, volgorde = s.beurten, punten = s.pts, beheerder = s.admin;
      s = defaults_();
      s.season = nieuw; s.players = spelers; s.beurten = volgorde;
      s.pts = punten; s.admin = beheerder; s.pins = pins; s.bekers = bekers;
      ['hk', 'pk'].forEach(function (ck) {
        s.comps[ck].preds = {};
        spelers.forEach(function (p) { s.comps[ck].preds[p] = blankPred_(); });
      });
    }
    s.rev = (s.rev || 0) + 1;
    writeState_(s);
    return { state: publicState_(s, who) };
  } finally {
    lock.releaseLock();
  }
}

/* ============ agenda ophalen ============ */

/** ICS knipt lange regels af en vervolgt met een spatie. Die plakken we weer aan elkaar. */
function ontvouw_(tekst) {
  var ruw = String(tekst || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  var uit = [];
  ruw.forEach(function (r) {
    if (uit.length && (r.charAt(0) === ' ' || r.charAt(0) === '\t')) uit[uit.length - 1] += r.slice(1);
    else uit.push(r);
  });
  return uit;
}

function icsDatum_(v) {
  var m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

/** In de agenda heet Bloemendaal "Bloemendaal H1". */
function schoonClub_(n) {
  return String(n || '').replace(/\s+[HDhd]\d\s*$/, '').trim();
}

/** "Bloemendaal H1 - Rotterdam H1 (3-2)" wordt thuis, uit en 3-2. */
function leesSummary_(s) {
  var tekst = String(s || ''), uitslag = '';
  var m = tekst.match(/\((\d+)\s*-\s*(\d+)\)\s*$/);
  if (m) { uitslag = m[1] + '-' + m[2]; tekst = tekst.slice(0, m.index); }
  var delen = tekst.split(' - ');
  if (delen.length !== 2) return null;
  var thuis = schoonClub_(delen[0]), uit = schoonClub_(delen[1]);
  if (!thuis || !uit) return null;
  return { thuis: thuis, uit: uit, uitslag: uitslag };
}

/** Alle wedstrijden uit de feed die binnen het opgegeven venster vallen. */
function leesIcs_(tekst, van, tot) {
  var uit = [], nu = null;
  ontvouw_(tekst).forEach(function (r) {
    if (r === 'BEGIN:VEVENT') { nu = {}; return; }
    if (r === 'END:VEVENT') {
      if (nu && nu.thuis && nu.datum && nu.datum >= van && nu.datum <= tot) uit.push(nu);
      nu = null;
      return;
    }
    if (!nu) return;
    if (r.indexOf('DTSTART') === 0) nu.datum = icsDatum_(r.slice(r.indexOf(':') + 1));
    else if (r.indexOf('SUMMARY:') === 0) {
      var p = leesSummary_(r.slice(8));
      if (p) { nu.thuis = p.thuis; nu.uit = p.uit; nu.uitslag = p.uitslag; }
    }
  });
  return uit;
}

/** De feed bevat alle seizoenen sinds 2016, dus knippen we er dit seizoen uit. */
function seizoenVenster_(ck) {
  var tijden = (KALENDER[ck] || []).map(parseDatum_).filter(Boolean)
    .map(function (d) { return d.getTime(); });
  if (!tijden.length) return null;
  var van = new Date(Math.min.apply(null, tijden));
  var tot = new Date(Math.max.apply(null, tijden));
  van.setDate(van.getDate() - 7);
  tot.setDate(tot.getDate() + 7);
  return { van: van, tot: tot };
}

function haalAgenda_(ck) {
  var adres = BRON[ck] && BRON[ck].feed;
  if (!adres) return [];
  var venster = seizoenVenster_(ck);
  if (!venster) return [];
  var res = UrlFetchApp.fetch(adres, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return [];
  return leesIcs_(res.getContentText(), venster.van, venster.tot);
}

function sleutel_(a, b) {
  return String(a || '').toLowerCase().trim() + '|' + String(b || '').toLowerCase().trim();
}

/* ---- hockeystanden.nl: officiele ranglijst en de wedstrijden rond vandaag ---- */

function ontHtml_(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    // Teletekst schrijft "Pinok&eacute;". Voor het herkennen tellen accenten niet mee.
    .replace(/&([a-zA-Z])(acute|grave|uml|circ|tilde|cedil);/g, '$1');
}

/** Kale vorm om namen te vergelijken: kleine letters, zonder accenten of leestekens. */
function kaal_(s) {
  return String(s || '').toLowerCase()
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/ç/g, 'c').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Afkortingen en andere schrijfwijzen die sites gebruiken, in kale vorm. */
var BIJNAMEN = {
  'kl zwit land': 'Klein Zwitserland', 'kl zwitserland': 'Klein Zwitserland', 'klein zwits': 'Klein Zwitserland',
  'o rood': 'Oranje-Rood', 'oranje rood': 'Oranje-Rood', 's hertogenbosch': 'Den Bosch', 'hc s hertogenbosch': 'Den Bosch',
  'schaerw': 'Schaerweijde'
};

/** Welk team uit onze lijst bedoelt een site met deze naam? Geeft '' als hij het niet weet. */
function teamVan_(naam, teams) {
  var k = kaal_(schoonClub_(naam));
  if (!k) return '';
  if (BIJNAMEN[k] && teams.indexOf(BIJNAMEN[k]) >= 0) return BIJNAMEN[k];
  var beste = '', lengte = 0;
  for (var i = 0; i < teams.length; i++) {
    var t = kaal_(teams[i]);
    if (t === k) return teams[i];
    // "HC Tilburg" bevat "tilburg". De langste treffer wint, zodat "Rotterdam" niet bij "Rotterdam Zuid" hoort.
    if ((' ' + k + ' ').indexOf(' ' + t + ' ') >= 0 && t.length > lengte) { beste = teams[i]; lengte = t.length; }
  }
  return beste;
}

/** Zet een ranglijst van een site om naar onze teams. Compleet = twaalf verschillende, allemaal herkend. */
function standVan_(namen, teams) {
  var lijst = [], onbekend = [], gezien = {};
  (namen || []).slice(0, 12).forEach(function (n) {
    var t = teamVan_(n, teams);
    if (!t || gezien[t]) { onbekend.push(String(n)); lijst.push(''); return; }
    gezien[t] = true; lijst.push(t);
  });
  var compleet = lijst.length === 12 && lijst.every(Boolean);
  return { lijst: compleet ? lijst : [], onbekend: onbekend, gevonden: (namen || []).length, compleet: compleet };
}

/** Wedstrijden van een site met onze teamnamen. Wat we niet herkennen laten we staan zoals het was. */
function naarTeams_(lijst, teams) {
  return (lijst || []).map(function (w) {
    var a = teamVan_(w.thuis, teams), b = teamVan_(w.uit, teams);
    return (a && b) ? { thuis: a, uit: b, uitslag: w.uitslag || '' } : w;
  });
}

/**
 * De twaalf clubs op volgorde. Drie manieren, de stevigste eerst:
 * 1. de gestructureerde data in de pagina (schema.org ItemList), die verandert niet als de opmaak verandert;
 * 2. de standentabel (rijen "st__row");
 * 3. de oude opmaak van voor oktober 2026 ("standings__row").
 */
function leesStandPagina_(html) {
  html = String(html || '');
  var scripts = html.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/g) || [];
  for (var s = 0; s < scripts.length; s++) {
    var d;
    try { d = JSON.parse(scripts[s].replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')); } catch (e) { continue; }
    if (!d || d['@type'] !== 'ItemList' || !d.itemListElement || d.itemListElement.length < 12) continue;
    var lijst = d.itemListElement.slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); })
      .map(function (e) { return schoonClub_(ontHtml_((e.item && e.item.name) || e.name || '')); });
    if (lijst.filter(Boolean).length >= 12) return lijst.slice(0, 12);
  }
  var uit = [], gezien = {};
  function neem(delen, patroon) {
    for (var i = 1; i < delen.length && uit.length < 12; i++) {
      var m = delen[i].match(patroon);
      if (!m) continue;
      var naam = schoonClub_(ontHtml_(m[1]));
      if (naam && !gezien[naam]) { gezien[naam] = true; uit.push(naam); }
    }
  }
  neem(html.split('class="st__row'), /class="tn__full[^"]*"[^>]*>([^<]*)</);
  if (uit.length >= 12) return uit;
  uit = []; gezien = {};
  neem(html.split('standings__row'), /class="team-name[^"]*"[^>]*>([^<]*)</);
  return uit;
}

/**
 * Elke wedstrijd op de pagina. Een uitslag nemen we alleen over als de wedstrijd
 * echt afgelopen is (data-ms="final"). Tijdens de wedstrijd staat er al een
 * tussenstand, en die mag nooit als uitslag in de poule komen.
 */
function leesRijenPagina_(html) {
  html = String(html || '');
  var uit = [], items = html.split('class="ml__item"');
  if (items.length > 1) {
    for (var i = 1; i < items.length; i++) {
      var d = items[i], kop = d.slice(0, 400);
      var status = (kop.match(/data-ms="([^"]*)"/) || [])[1] || '';
      var namen = [], re = /class="tn__full[^"]*"[^>]*>([^<]*)</g, m;
      while (namen.length < 2 && (m = re.exec(d))) namen.push(schoonClub_(ontHtml_(m[1])));
      if (namen.length < 2 || !namen[0] || !namen[1]) continue;
      var uitslag = '', p = d.indexOf('ml__score-line');
      if (p >= 0 && (status === 'final' || status === '')) {
        var stuk = d.slice(p, p + 1000), rn = /class="ml__num[^"]*"[^>]*>\s*(\d+)\s*</g, n, c = [];
        while (c.length < 2 && (n = rn.exec(stuk))) c.push(n[1]);
        if (c.length === 2) uitslag = c[0] + '-' + c[1];
      }
      uit.push({ thuis: namen[0], uit: namen[1], uitslag: uitslag });
    }
    return uit;
  }
  // oude opmaak
  var delen = html.split('class="ml__row');
  for (var j = 1; j < delen.length; j++) {
    var b = delen[j].slice(0, 2500);
    var nm = [], ro = /class="ml__name[^"]*"[^>]*>([^<]*)</g, x;
    while (nm.length < 2 && (x = ro.exec(b))) nm.push(schoonClub_(ontHtml_(x[1])));
    if (nm.length < 2 || !nm[0] || !nm[1]) continue;
    var cf = [], rc = /class="ml__num[^"]*"[^>]*>\s*(\d+)\s*</g, y;
    while (cf.length < 2 && (y = rc.exec(b))) cf.push(y[1]);
    uit.push({ thuis: nm[0], uit: nm[1], uitslag: cf.length === 2 ? (cf[0] + '-' + cf[1]) : '' });
  }
  return uit;
}

/**
 * Per team de cijfers uit de standentabel: gespeeld, doelpunten voor en tegen, punten.
 * Kolommen: gespeeld, gewonnen, gelijk, verloren, voor, tegen, saldo. We nemen een rij
 * alleen over als voor min tegen precies het saldo is; anders is de tabel veranderd.
 */
function leesCijfersPagina_(html) {
  var uit = [];
  String(html || '').split('class="st__row').slice(1).forEach(function (rij) {
    rij = rij.split('</tr>')[0];
    var naam = rij.match(/class="tn__full[^"]*"[^>]*>([^<]*)</);
    // Een negatief saldo staat er met een echt minteken (−, U+2212), niet met een streepje.
    var g = [], re = /<td class="c-num[^"]*"[^>]*>\s*([+\-\u2212\u2013]?)\s*(\d+)\s*</g, m;
    while ((m = re.exec(rij))) g.push((m[1] && m[1] !== '+' ? -1 : 1) * Number(m[2]));
    var punten = rij.match(/<td class="c-pts[^"]*"[^>]*>\s*(\d+)\s*</);
    if (!naam || g.length < 7 || g[4] - g[5] !== g[6]) return;
    uit.push({ naam: schoonClub_(ontHtml_(naam[1])), gespeeld: g[0], voor: g[4], tegen: g[5], punten: punten ? Number(punten[1]) : null });
  });
  return uit;
}

/** Cijfers met onze teamnamen. Alleen bruikbaar als alle twaalf teams herkend zijn. */
function cijfersVan_(lijst, teams) {
  var uit = [], gezien = {};
  (lijst || []).forEach(function (c) {
    var t = teamVan_(c.naam, teams);
    if (!t || gezien[t]) return;
    gezien[t] = true;
    uit.push({ team: t, gespeeld: c.gespeeld, voor: c.voor, tegen: c.tegen, punten: c.punten });
  });
  return uit.length === 12 ? uit : [];
}

function haalPagina_(ck) {
  var adres = BRON[ck] && BRON[ck].pagina;
  if (!adres) return { stand: [], wedstrijden: [], fouten: [], cijfers: [] };
  var stand = [], wedstrijden = [], fouten = [], cijfers = [];
  // De tweede pagina is het tabblad Uitslagen. Bestaat dat niet, dan levert hij
  // gewoon dezelfde inhoud en gooien we de dubbelen er later weer uit.
  [adres, adres + '?tab=uitslagen'].forEach(function (u, nr) {
    var res;
    try { res = UrlFetchApp.fetch(u, { muteHttpExceptions: true, followRedirects: true }); }
    catch (e) { if (!nr) fouten.push('hockeystanden.nl niet bereikbaar (' + ((e && e.message) || e) + ')'); return; }
    if (res.getResponseCode() !== 200) { if (!nr) fouten.push('hockeystanden.nl antwoordde met ' + res.getResponseCode()); return; }
    var html = res.getContentText();
    if (!stand.length) stand = leesStandPagina_(html);
    if (!cijfers.length) cijfers = leesCijfersPagina_(html);
    wedstrijden = wedstrijden.concat(leesRijenPagina_(html));
  });
  return { stand: stand, wedstrijden: wedstrijden, fouten: fouten, cijfers: cijfers };
}

/* ---- NOS Teletekst: reserve voor de Hoofdklasse heren ---- */

/** Teletekstpagina per competitie. 630 is hockey, de eerste subpagina met "hoofdklasse heren". */
var TELETEKST = { hk: '630' };

function haalTeletekst_(ck) {
  var pagina = TELETEKST[ck];
  if (!pagina) return null;
  var volgende = pagina;
  for (var keer = 0; keer < 4 && volgende; keer++) {
    var res = UrlFetchApp.fetch('https://teletekst-data.nos.nl/json/' + volgende, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var d = JSON.parse(res.getContentText());
    var tekst = ontHtml_(String(d.content || '').replace(/&#x[0-9a-fA-F]+;/g, ' ').replace(/<[^>]+>/g, ''));
    if (/hoofdklasse heren/i.test(tekst)) return leesTeletekst_(tekst);
    volgende = d.nextSubPage || '';
  }
  return null;
}

/**
 * Leest een Teletekstpagina: wedstrijdregels "Thuis - Uit 3-2" en de stand in
 * twee kolommen ("Amsterdam  3-9 HDM  3-4"), links plek 1 tot 6, rechts 7 tot 12.
 */
function leesTeletekst_(tekst) {
  var wedstrijden = [], links = [], rechts = [], inStand = false;
  String(tekst || '').split('\n').forEach(function (r) {
    if (/^\s*stand\s*:/i.test(r)) { inStand = true; return; }
    if (inStand) {
      var s = r.match(/^\s*(.+?)\s+\d+\s*-\s*\d+\s+(.+?)\s+\d+\s*-\s*\d+\s*$/);
      if (s) { links.push(s[1].trim()); rechts.push(s[2].trim()); }
      return;
    }
    var w = r.match(/^\s*(\S.*?)\s+-\s+(\S.*?)\s+(\d+)\s*-\s*(\d+)\s*$/);
    if (w) wedstrijden.push({ thuis: w[1].trim(), uit: w[2].trim(), uitslag: w[3] + '-' + w[4] });
  });
  return { stand: links.concat(rechts), wedstrijden: wedstrijden };
}

/**
 * Alles wat er over één competitie bekend is, uit alle bronnen samen, in onze teamnamen.
 * meldingen: wat er misging, zodat de beheerder het ziet in plaats van dat het stil blijft.
 */
function haalBronnen_(ck, c) {
  var meldingen = [], pagina = { stand: [], wedstrijden: [], fouten: [] }, tt = null, feed = [];
  try { pagina = haalPagina_(ck); } catch (e) { meldingen.push('hockeystanden.nl: ' + ((e && e.message) || e)); }
  meldingen = meldingen.concat(pagina.fouten || []);
  try { tt = haalTeletekst_(ck); } catch (e) { tt = null; }
  try { feed = haalAgenda_(ck); } catch (e) { /* de feed is een extraatje */ }

  var stand = standVan_(pagina.stand, c.teams), bron = 'hockeystanden.nl';
  if (!stand.compleet && tt) {
    var st2 = standVan_(tt.stand, c.teams);
    if (st2.compleet) { stand = st2; bron = 'Teletekst'; }
  }
  if (!stand.compleet) {
    meldingen.push('ranglijst ' + c.name + ' niet herkend' +
      (stand.gevonden ? ' (' + stand.gevonden + ' teams gevonden' + (stand.onbekend.length ? ', onbekend: ' + stand.onbekend.join(', ') : '') + ')'
                      : ' (geen ranglijst op de pagina gevonden)'));
  }
  var op = voegSamen_(naarTeams_(feed, c.teams), naarTeams_(pagina.wedstrijden, c.teams),
    naarTeams_(tt ? tt.wedstrijden : [], c.teams));
  return { stand: stand.lijst, standBron: bron, op: op, meldingen: meldingen, cijfers: cijfersVan_(pagina.cijfers, c.teams) };
}

/** Voegt bronnen samen. Een wedstrijd mét uitslag wint van dezelfde zonder. */
function voegSamen_() {
  var op = {};
  for (var i = 0; i < arguments.length; i++) {
    (arguments[i] || []).forEach(function (w) {
      if (!w || !w.thuis || !w.uit) return;
      var k = sleutel_(w.thuis, w.uit);
      if (!op[k] || (!op[k].uitslag && w.uitslag)) op[k] = w;
    });
  }
  return op;
}

/**
 * Kijkt bij de bronnen wat er bekend is en stelt voor wat ingevuld kan worden.
 * Slaat zelf niets op, de beheerder ziet het eerst en tikt akkoord.
 */
function haalVoorstellen(who, pin) {
  var s = readState_();
  if (!who || !pinKlopt_(s, who, String(pin)).ok || who !== s.admin) return { error: 'Alleen de beheerder.' };

  var blokken = [], fouten = [];
  ['hk', 'pk'].forEach(function (ck) {
    var c = s.comps[ck], bron;
    try { bron = haalBronnen_(ck, c); }
    catch (e) { fouten.push(c.name + ': ' + ((e && e.message) ? e.message : e)); return; }
    fouten = fouten.concat(bron.meldingen);

    var op = bron.op;
    var uitslagen = [];
    c.matches.forEach(function (m, i) {
      if (String(m.actual || '').trim()) return;
      if (!m.home || !m.away) return;
      var w = op[sleutel_(m.home, m.away)];
      if (w && w.uitslag) uitslagen.push({ ronde: i, wedstrijd: m.home + ' - ' + m.away, uitslag: w.uitslag });
    });

    var alles = Object.keys(op).map(function (k) { return op[k]; });
    blokken.push({
      comp: ck,
      naam: c.name,
      gevonden: alles.length,
      gespeeld: alles.filter(function (w) { return w.uitslag; }).length,
      uitslagen: uitslagen,
      // Alleen een ranglijst die volledig herkend wordt is bruikbaar.
      ranglijst: bron.stand,
      cijfers: bron.cijfers
    });
  });

  if (!blokken.length) return { error: 'Ophalen lukte niet. ' + fouten.join(' ') };
  return { blokken: blokken, waarschuwing: fouten.length ? 'Let op: ' + fouten.join('; ') + '.' : '' };
}

/* ============ herinnering voor het sluitmoment ============ */

function nlDatum_(d) {
  var dag = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'][d.getDay()];
  var maand = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
    'juli', 'augustus', 'september', 'oktober', 'november', 'december'][d.getMonth()];
  var uu = ('0' + d.getHours()).slice(-2), mm = ('0' + d.getMinutes()).slice(-2);
  return dag + ' ' + d.getDate() + ' ' + maand + ' om ' + uu + ':' + mm;
}

function voegToe_(o, k, v) { (o[k] = o[k] || []).push(v); }

/**
 * Zoekt sluitmomenten binnen 36 uur en mailt iedereen die nog niets heeft ingevuld.
 * Bij een test gaat alles naar de beheerder, zodat je ziet hoe het eruitziet.
 */
function stuurHerinnering_(s, test) {
  var nu = new Date(), grens = new Date(nu.getTime() + 36 * 3600 * 1000);
  var link = s.appUrl;
  if (!link) { try { link = ScriptApp.getService().getUrl(); } catch (e) { link = ''; } }
  var taken = {}, behandeld = [];

  ['hk', 'pk'].forEach(function (ck) {
    var c = s.comps[ck];
    for (var i = 0; i < N_MATCH; i++) {
      var dl = deadlineVoor_(s, ck, i);
      if (!dl) continue;
      var d = new Date(dl);
      if (isNaN(d.getTime()) || d <= nu || d > grens) continue;
      var k = ck + '-' + i;
      if (!test && s.herinnerd[k]) continue;
      behandeld.push(k);
      var m = c.matches[i];
      var naam = (m.home && m.away) ? (m.home + ' - ' + m.away) : '';
      var wanneer = 'sluit ' + nlDatum_(d);
      if (!naam) {
        var kiezer = beurtVoor_(s, i);
        if (kiezer) voegToe_(taken, kiezer, c.name + ', ronde ' + (i + 1) + ': jij bent aan de beurt om de wedstrijd te kiezen, ' + wanneer + '.');
      } else {
        s.players.forEach(function (p) {
          var pr = c.preds[p];
          if (pr && !String(pr.wvdw[i] || '').trim()) {
            voegToe_(taken, p, c.name + ', ronde ' + (i + 1) + ': ' + naam + ', ' + wanneer + '.');
          }
        });
      }
    }
  });

  var namen = Object.keys(taken);
  if (!namen.length) return 'Er staat niets open binnen 36 uur, dus er is niets verstuurd.';

  var verstuurd = 0, overgeslagen = [];
  namen.forEach(function (p) {
    var adres = test ? s.emails[s.admin] : s.emails[p];
    if (!adres) { overgeslagen.push(p); return; }
    var body = 'Hoi ' + (test ? s.admin : p) + ',\n\n' +
      (test ? 'Dit is een test. In het echt zou ' + p + ' onderstaande krijgen.\n\n' : '') +
      'Er staat nog iets open in Hockey NERDS:\n\n' +
      taken[p].map(function (r) { return '- ' + r; }).join('\n') +
      (link ? '\n\n' + link : '') + '\n';
    try {
      MailApp.sendEmail(adres, 'Hockey NERDS: nog even invullen', body);
      verstuurd++;
    } catch (e) {
      overgeslagen.push(p + ' (' + ((e && e.message) ? e.message : e) + ')');
    }
  });
  if (!test) behandeld.forEach(function (k) { s.herinnerd[k] = nu.toISOString(); });

  var melding = verstuurd + (verstuurd === 1 ? ' mail verstuurd' : ' mails verstuurd');
  if (overgeslagen.length) melding += ', nog geen adres voor: ' + overgeslagen.join(', ');
  return melding + '.';
}

/**
 * Draai deze functie één keer vanuit de scripteditor. Hij raakt alle drie de
 * onderdelen aan waar Google toestemming voor wil: een taak inplannen, een
 * website benaderen en mail versturen. Verder doet hij niets.
 */
function geefToestemming() {
  var uit = [];
  try { uit.push('taken: ' + ScriptApp.getProjectTriggers().length); }
  catch (e) { uit.push('taken mislukt'); }
  try { uit.push('website: ' + UrlFetchApp.fetch(BRON.pk.pagina, { muteHttpExceptions: true }).getResponseCode()); }
  catch (e) { uit.push('website mislukt'); }
  try { uit.push('mail over vandaag: ' + MailApp.getRemainingDailyQuota()); }
  catch (e) { uit.push('mail mislukt'); }
  Logger.log(uit.join(' | '));
  return uit.join(' | ');
}

/* ============ de app houdt zichzelf bij ============ */

/**
 * Rondes die allang gespeeld zijn maar nog geen uitslag hebben. Zolang deze
 * lijst niet leeg is klopt de stand niet, dus dat mag je niet stil laten.
 */
function mistUitslagen_(s, ck) {
  var nu = new Date().getTime(), uit = [];
  ((s.comps[ck] || {}).matches || []).forEach(function (m, i) {
    if (String(m.actual || '').trim() || !m.home || !m.away) return;
    var d = parseDatum_(datumVan_(s, ck, i));
    if (!d) return;
    if (nu >= d.getTime() + Math.round(WACHT_UUR * 60) * 60000) uit.push(i);
  });
  return uit;
}

/**
 * Haalt de uitslag op zodra een wedstrijd 2,5 uur geleden begon, en ververst
 * elke ochtend de ranglijsten. Lukt het niet, dan probeert het volgende uur
 * het opnieuw, tot drie dagen na de wedstrijd. Daarna doe je het met de hand.
 */
function autoBijwerken_(s) {
  var nu = new Date(), nodig = {}, rijp = {};
  ['hk', 'pk'].forEach(function (ck) {
    s.comps[ck].matches.forEach(function (m, i) {
      if (String(m.actual || '').trim() || !m.home || !m.away) return;
      var d = parseDatum_(datumVan_(s, ck, i));
      if (!d) return;
      var klaar = d.getTime() + Math.round(WACHT_UUR * 60) * 60000;
      // Geen einddatum: hij blijft het proberen tot de uitslag er echt staat.
      if (nu.getTime() >= klaar) {
        nodig[ck] = true;
        rijp[ck + '-' + i] = true;
      }
    });
  });
  if (nu.getHours() === 9) { nodig.hk = true; nodig.pk = true; }
  var comps = Object.keys(nodig);
  if (!comps.length) return false;

  var gedaan = [], meldingen = [], oudeFout = s.autoFout || '';
  comps.forEach(function (ck) {
    var c = s.comps[ck], bron;
    try { bron = haalBronnen_(ck, c); }
    catch (e) { meldingen.push(c.name + ': ' + ((e && e.message) || e)); return; }
    var op = bron.op;

    c.matches.forEach(function (m, i) {
      if (!rijp[ck + '-' + i]) return;
      var w = op[sleutel_(m.home, m.away)];
      if (w && /^\d{1,2}-\d{1,2}$/.test(String(w.uitslag || ''))) {
        m.actual = String(w.uitslag);
        gedaan.push(c.name + ' ronde ' + (i + 1) + ': ' + m.home + ' - ' + m.away + ' ' + w.uitslag);
      }
    });

    // Een onvolledige ranglijst is alleen een probleem als we hem echt nodig hadden (de ochtendronde).
    if (nu.getHours() === 9) meldingen = meldingen.concat(bron.meldingen);
    var lijst = bron.stand;
    if (lijst.length === 12 && lijst.join('|') !== (c.live.standing || []).join('|')) {
      c.live.standing = lijst;
      c.live.updated = nu.toISOString();
      gedaan.push('ranglijst ' + c.name + ' bijgewerkt (' + bron.standBron + ')');
    }
    // Doelpunten veranderen ook als de volgorde gelijk blijft. Die gebruiken de bonusvragen.
    if (bron.cijfers.length === 12 && JSON.stringify(bron.cijfers) !== JSON.stringify(c.live.cijfers || [])) {
      c.live.cijfers = bron.cijfers;
      gedaan.push('doelpunten ' + c.name + ' bijgewerkt');
    }
  });

  // Wat er misging bewaren we, zodat de beheerder het in de app ziet.
  if (meldingen.length) s.autoFout = nlDatum_(nu) + ': ' + meldingen.join('; ');
  else if (nu.getHours() === 9) s.autoFout = '';
  var foutVeranderd = (s.autoFout || '') !== oudeFout;

  if (!gedaan.length) return foutVeranderd;
  s.autoBericht = nlDatum_(nu) + ' — ' + gedaan.join('; ');
  return true;
}

/** Draait elk uur zolang er iets aanstaat. */
function elkUur() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var s = readState_(), veranderd = false;
    if (s.autoAan && autoBijwerken_(s)) veranderd = true;
    var u = new Date().getHours();
    // Niemand wil om vier uur 's nachts een mailtje.
    if (s.herinnerAan && u >= 8 && u <= 21) { stuurHerinnering_(s, false); veranderd = true; }
    if (veranderd) { s.rev = (s.rev || 0) + 1; writeState_(s); }
  } finally {
    lock.releaseLock();
  }
}

/** Oudere taken wezen hierheen. */
function herinneringTaak() { elkUur(); }

function regelTrigger_(s) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'elkUur' || f === 'herinneringTaak') ScriptApp.deleteTrigger(t);
  });
  if (s.autoAan || s.herinnerAan) {
    ScriptApp.newTrigger('elkUur').timeBased().everyHours(1).create();
  }
}

/* ============ geplakte ranglijst omzetten ============ */

/**
 * Neemt tekst die je van een site kopieert (met plaatsnummers, punten, doelsaldo, wat dan ook)
 * en haalt daar de teams in volgorde uit. Herkent alleen teams die in de lijst staan.
 */
function normaliseerTeams_(text, teams) {
  var regels = String(text || '').split(/[\r\n\t;|]+/);
  var gevonden = [], gebruikt = {};
  regels.forEach(function (regel) {
    var r = ' ' + kaal_(regel) + ' ';
    if (!r.trim()) return;
    var beste = null, besteLengte = 0;
    teams.forEach(function (t) {
      if (gebruikt[t]) return;
      var naam = ' ' + kaal_(t) + ' ';
      if (r.indexOf(naam) >= 0 && naam.length > besteLengte) { beste = t; besteLengte = naam.length; }
    });
    if (beste) { gevonden.push(beste); gebruikt[beste] = true; }
  });
  while (gevonden.length < 12) gevonden.push('');
  return gevonden.slice(0, 12);
}

/**
 * Leest een geplakt programma uit. Elke regel met twee herkende clubs wordt een wedstrijd.
 * Datums, tijden en scheidsrechters mogen er gewoon in blijven staan.
 */
function leesProgramma_(text, teams) {
  var regels = String(text || '').split(/[\r\n]+/);
  var uit = [], gezien = {};
  regels.forEach(function (regel) {
    var paar = tweeClubs_(regel, teams);
    if (!paar) return;
    var sleutel = paar[0] + '|' + paar[1];
    if (gezien[sleutel]) return;
    gezien[sleutel] = true;
    uit.push(paar[0] + ' - ' + paar[1]);
  });
  return uit.slice(0, 12);
}

/** Zoekt de twee clubs in een regel, in de volgorde waarin ze er staan. Thuis eerst. */
function tweeClubs_(regel, teams) {
  var r = ' ' + String(regel).toLowerCase().replace(/[^a-z0-9à-ÿ ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  if (!r.trim()) return null;
  var treffers = [];
  teams.forEach(function (t) {
    var naam = ' ' + t.toLowerCase().replace(/[^a-z0-9à-ÿ ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    var pos = r.indexOf(naam);
    if (pos >= 0) treffers.push({ team: t, pos: pos, lang: naam.length });
  });
  if (treffers.length < 2) return null;
  // Overlappende namen: de langste wint op dezelfde plek.
  treffers.sort(function (a, b) { return a.pos - b.pos || b.lang - a.lang; });
  // De namen zijn omringd door spaties, die mogen elkaar raken. Vandaar de -1.
  var schoon = [];
  treffers.forEach(function (t) {
    var overlapt = schoon.some(function (s) {
      return t.pos < s.pos + s.lang - 1 && s.pos < t.pos + t.lang - 1;
    });
    if (!overlapt) schoon.push(t);
  });
  if (schoon.length < 2) return null;
  return [schoon[0].team, schoon[1].team];
}

/** Hoeveel teams heeft een speler nu op de juiste plek, volgens de actuele stand. */
function liveTreffers_(comp, player) {
  var pr = comp.preds[player] || blankPred_(), n = 0;
  for (var i = 0; i < 12; i++) if (eq_(pr.standing[i], comp.live.standing[i])) n++;
  return n;
}

/* ============ menu in de sheet ============ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Hockey NERDS')
    .addItem('Stand naar tabblad schrijven', 'exportStanding')
    .addItem('Back-up van alle data (JSON in tabblad)', 'exportBackup')
    .addToUi();
}

/** Schrijft een leesbare stand naar het tabblad STAND. */
function exportStanding() {
  var s = readState_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('STAND') || ss.insertSheet('STAND');
  sh.clear();
  var rows = [['Speler', 'WVDW HK', 'WVDW PK', 'Ranglijst HK', 'Ranglijst PK', 'Bonus HK', 'Bonus PK', 'Totaal']];
  var scored = s.players.map(function (p) {
    var hk = scorePlayer_(s.comps.hk, p, s.pts), pk = scorePlayer_(s.comps.pk, p, s.pts);
    return { p: p, hk: hk, pk: pk, total: hk.total + pk.total };
  }).sort(function (a, b) { return b.total - a.total; });
  scored.forEach(function (x) {
    rows.push([x.p, x.hk.wvdw, x.pk.wvdw, x.hk.positie, x.pk.positie, x.hk.bonus, x.pk.bonus, x.total]);
  });
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  sh.autoResizeColumns(1, rows[0].length);
  SpreadsheetApp.getUi().alert('Stand bijgewerkt in tabblad STAND.');
}

function exportBackup() {
  var s = readState_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = 'BACKUP ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH.mm');
  var sh = ss.insertSheet(name);
  var raw = JSON.stringify(s);
  var parts = [];
  for (var i = 0; i < raw.length; i += 40000) parts.push([raw.substr(i, 40000)]);
  sh.getRange(1, 1, parts.length, 1).setValues(parts);
  SpreadsheetApp.getUi().alert('Back-up gemaakt in tabblad "' + name + '".');
}

/* ============ puntentelling (ook server-side, voor de export) ============ */

function parseScore_(v) {
  if (!v) return null;
  var m = String(v).trim().match(/^(\d+)\s*[-–:]\s*(\d+)$/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
}
function sign_(a, b) { return a > b ? 1 : a < b ? -1 : 0; }

function matchPoints_(pred, actual, pts) {
  var p = parseScore_(pred), a = parseScore_(actual);
  if (!p || !a) return 0;
  if (p[0] === a[0] && p[1] === a[1]) return pts.exact;
  var outcome = sign_(p[0], p[1]) === sign_(a[0], a[1]);
  var oneScore = p[0] === a[0] || p[1] === a[1];
  if (outcome && oneScore) return pts.scoreWin;
  if (outcome) return pts.win;
  if (oneScore) return pts.score;
  return 0;
}
function eq_(a, b) {
  return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Hoofdletters, accenten en leestekens eraf, zodat je namen kunt vergelijken. */
function plat_(s) {
  return String(s || '').toLowerCase()
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u')
    .replace(/[ç]/g, 'c').replace(/[ñ]/g, 'n').replace(/[ß]/g, 's')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Hoeveel tekens moet je veranderen om van a naar b te komen. */
function afstand_(a, b) {
  var m = a.length, n = b.length, vorig = [], nu = [], i, j;
  if (!m || !n) return m + n;
  for (j = 0; j <= n; j++) vorig[j] = j;
  for (i = 1; i <= m; i++) {
    nu[0] = i;
    for (j = 1; j <= n; j++) {
      nu[j] = Math.min(vorig[j] + 1, nu[j - 1] + 1,
        vorig[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    }
    for (j = 0; j <= n; j++) vorig[j] = nu[j];
  }
  return vorig[n];
}

/**
 * Vergelijkt spelersnamen zoals een mens dat doet. 'Boers', 'Timo Boers' en
 * 'T. Boers' zijn dezelfde man, en een typefout in de achternaam mag ook.
 * Anders kost een spelfout je tien of twintig punten, en dat is geen hockey.
 */
function naamEq_(a, b) {
  var x = plat_(a), y = plat_(b);
  if (!x || !y) return false;
  if (x === y) return true;
  var xd = x.split(' '), yd = y.split(' ');
  var xa = xd[xd.length - 1], ya = yd[yd.length - 1];
  if (xa.length < 4 || ya.length < 4) return false;
  var d = afstand_(xa, ya), lang = Math.max(xa.length, ya.length);
  if (d === 0) return true;
  if (d === 1 && lang >= 4) return true;
  return d === 2 && lang >= 7;
}

function scorePlayer_(comp, player, pts) {
  var pr = comp.preds[player] || blankPred_(), rs = comp.result;
  var wvdw = 0;
  comp.matches.forEach(function (m, i) { wvdw += matchPoints_(pr.wvdw[i], m.actual, pts); });
  var positie = 0;
  for (var i = 0; i < 12; i++) if (eq_(pr.standing[i], rs.standing[i])) positie += pts.positie;
  // In de Hoofdklasse beslissen de play-offs wie kampioen wordt, dus dat is een
  // dure aparte vraag. In de Promotieklasse is de koploper de kampioen, en die
  // heb je via plek 1 al betaald gekregen, vandaar een kleine toeslag.
  var kampioenPt = (comp.ck === 'pk') ? pts.kampioenPk : pts.kampioen;
  var bonus =
    (eq_(pr.kampioen, rs.kampioen) ? kampioenPt : 0) +
    (eq_(pr.winter, rs.winter) ? pts.winter : 0) +
    (naamEq_(pr.topscorer, rs.topscorer) ? pts.topscorer : 0) +
    (eq_(pr.minsteTegen, rs.minsteTegen) ? pts.minsteTegen : 0) +
    (eq_(pr.meestScorend, rs.meestScorend) ? pts.meestScorend : 0) +
    ((comp.ck === 'hk' && naamEq_(pr.speler, rs.speler)) ? pts.speler : 0);
  return { wvdw: wvdw, positie: positie, bonus: bonus, total: wvdw + positie + bonus };
}
