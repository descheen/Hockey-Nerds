/**
 * Hockey NERDS — ingang voor de PWA (GitHub Pages).
 * Plak dit als apart bestand naast Code.gs (bijvoorbeeld "doPost.gs").
 * Code.gs en doGet blijven precies zoals ze zijn.
 *
 * De PWA stuurt een POST met een text/plain body:
 *   {"fn":"login","args":["Rein","1234"]}
 * en krijgt JSON terug:
 *   {"ok":true,"r":<wat de functie teruggeeft>}   of   {"ok":false,"fout":"..."}
 *
 * text/plain houdt het verzoek "simpel", zodat de browser geen CORS-preflight
 * doet (die kan Apps Script niet beantwoorden).
 *
 * Alleen de functies hieronder zijn bereikbaar, met precies zoveel argumenten
 * als ze verwachten. Inloggen blijft per aanroep: naam + pincode gaan mee en
 * de functies in Code.gs controleren die zelf, net als bij google.script.run.
 */
var PWA_FUNCTIES = {
  login:           function (a) { return login(a[0], a[1]); },
  getState:        function (a) { return getState(a[0], a[1]); },
  getPlayers:      function (a) { return getPlayers(); },
  applyPatches:    function (a) { return applyPatches(a[0], a[1], a[2]); },
  adminAction:     function (a) { return adminAction(a[0], a[1], a[2], a[3]); },
  haalVoorstellen: function (a) { return haalVoorstellen(a[0], a[1]); },
  geefToestemming: function (a) { return geefToestemming(); }
};

function doPost(e) {
  var uit;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = body && body.fn;
    if (typeof fn !== 'string' || !Object.prototype.hasOwnProperty.call(PWA_FUNCTIES, fn)) {
      uit = { ok: false, fout: 'Onbekende functie.' };
    } else {
      var args = Array.isArray(body.args) ? body.args : [];
      uit = { ok: true, r: PWA_FUNCTIES[fn](args) };
    }
  } catch (err) {
    // Net als bij google.script.run: een fout in de functie komt bij de
    // failure handler terecht, niet bij de success handler.
    uit = { ok: false, fout: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(uit))
    .setMimeType(ContentService.MimeType.JSON);
}
