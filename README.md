# Hockey NERDS

Voorspellingspoule voor de Hoofdklasse en Promotieklasse. De app draait op Google Apps Script
(`Code.gs` + `Index.html`) en is daarnaast installeerbaar als PWA via GitHub Pages (`docs/`).

```
Code.gs              Apps Script: alle logica + doGet (ongewijzigd)
Index.html           Apps Script: de app (bron voor de PWA)
doPost-snippet.gs    Apps Script: JSON-ingang voor de PWA (plak je erbij)
docs/                GitHub Pages: de PWA (index.html, manifest, service worker, iconen)
pwa/                 build-script, icoon-generator en tests (niet nodig in Apps Script)
```

## Hoe het werkt

De PWA is een kopie van `Index.html`. Daarin vervangt een kleine fetch-shim `google.script.run`.
De rest van de code merkt het verschil niet: `withSuccessHandler`, `withFailureHandler` en
`withUserObject` werken zoals altijd. Elke aanroep wordt een `POST` naar de Apps Script exec-URL
met een `text/plain` body (`{"fn":"login","args":["Rein","1234"]}`). `doPost` geeft alleen deze
functies door: `login`, `getState`, `getPlayers`, `applyPatches`, `adminAction`, `haalVoorstellen`
en `geefToestemming`. Inloggen gaat net als nu per aanroep met naam en pincode, en `Code.gs`
controleert dat zelf.

De service worker bewaart de shell (pagina, manifest, iconen), zodat de app ook zonder netwerk
opent. API-verzoeken gaan altijd eerst naar het netwerk. Alleen leesacties (`getPlayers`,
`getState`, `login`) vallen offline terug op het laatst bekende antwoord, en dan meldt de app
"Offline: je ziet de laatst bekende gegevens". Opslaan komt nooit uit een cache. Bij uitloggen
wordt de offline-kopie van het toestel gewist.

---

## Installatie, stap voor stap

### 1. doPost toevoegen in Apps Script

1. Open de sheet, ga naar **Extensies > Apps Script**.
2. Klik naast **Bestanden** op **+ > Script** en noem het `doPost`.
3. Plak de inhoud van [`doPost-snippet.gs`](doPost-snippet.gs) erin en klik op **Opslaan**.
   `Code.gs` hoef je niet aan te raken.

### 2. Nieuwe versie publiceren (zelfde URL)

Gebruik **niet** "Nieuwe implementatie", want dan krijg je een nieuwe URL.

1. **Implementeren > Implementaties beheren**.
2. Kies je bestaande web-app-implementatie en klik op het **potlood (Bewerken)**.
3. Zet **Versie** op **Nieuwe versie** en geef het een omschrijving, bijvoorbeeld "doPost voor PWA".
4. Controleer:
   - **Uitvoeren als:** *Ik*
   - **Wie heeft toegang:** *Iedereen*. Let op: "Iedereen met een Google-account" werkt **niet**
     voor de PWA, omdat GitHub Pages geen Google-inlog meestuurt. Je krijgt dan een CORS- of
     verbindingsfout.
5. Klik op **Implementeren** en kopieer de **web-app-URL** (eindigt op `/exec`).

Snelle controle vanaf je computer (vervang de URL):

```bash
curl -sL -H 'Content-Type: text/plain' -d '{"fn":"getPlayers","args":[]}' \
  'https://script.google.com/macros/s/JOUW-ID/exec'
# verwacht: {"ok":true,"r":{"players":[...],...}}
```

### 3. Exec-URL in de PWA zetten

Zet de URL bovenaan in `docs/index.html`:

```js
var HN_API = 'https://script.google.com/macros/s/JOUW-ID/exec';
```

Of laat het build-script dat doen: `node pwa/build.cjs --api=https://script.google.com/macros/s/JOUW-ID/exec`.
Commit en push.

### 4. GitHub Pages aanzetten

1. Ga op GitHub naar **Settings > Pages**.
2. **Source:** *Deploy from a branch*.
3. **Branch:** `main`, map **`/docs`**, klik op **Save**.
4. Na een minuut staat de app op `https://descheen.github.io/Hockey-Nerds/`.

### 5. Herinneringsmails naar de PWA laten wijzen (optioneel)

Herinneringsmails linken naar `appUrl`, of naar de Apps Script-URL als die leeg is. Wil je dat ze
naar de PWA linken, zet de GitHub Pages-URL dan als app-adres in het beheerdersgedeelte van de app
(de actie `setAppUrl`).

### Na een wijziging in Index.html

`Index.html` blijft de bron. Na een aanpassing:

```bash
node pwa/build.cjs        # maakt docs/index.html opnieuw en houdt de exec-URL
```

Commit `docs/` en push. Het script zet ook een nieuwe cacheversie in `docs/sw.js`, zodat telefoons
de nieuwe versie ophalen. Wie de app op dat moment open heeft (ook op de achtergrond), ziet bovenaan
de balk **"Nieuwe versie klaar · Verversen"**. Verversen wacht tot alles is opgeslagen. Wijzig je `Code.gs` of `doPost`, publiceer dan opnieuw zoals in stap 2.

---

## Testchecklist

Iedereen moet in de geïnstalleerde app **opnieuw inloggen**. Een app op het beginscherm heeft zijn
eigen opslag, los van Safari of Chrome.

### iPhone (Safari)

- [ ] Open `https://descheen.github.io/Hockey-Nerds/` in **Safari**. Andere browsers op iOS kunnen alleen installeren vanaf iOS 16.4.
- [ ] **Deel-knop > Zet op beginscherm**. Het icoon is "HN" op een donkere achtergrond, met de naam "NERDS".
- [ ] Open via het icoon: geen adresbalk, schermvullend.
- [ ] De statusbalk (klok, batterij) valt niet over de titel, en de notch of Dynamic Island bedekt niets.
- [ ] Onderaan zit niets onder de home-indicator, ook een melding (toast) niet.
- [ ] Inloggen met naam + pincode werkt, en een foute pincode geeft "Pincode klopt niet."
- [ ] Tik in een invoerveld: het scherm zoomt **niet** in.
- [ ] Vul een voorspelling of uitslag in: de status springt naar "opgeslagen". Controleer in de sheet of via de oude Apps Script-URL dat de wijziging er staat.
- [ ] Sluit de app helemaal (omhoog vegen) en open opnieuw: je bent nog ingelogd.
- [ ] Liggend scherm: inhoud valt niet achter de notch.
- [ ] Vliegtuigmodus aan, app openen: de app start met de melding "Offline: je ziet de laatst bekende gegevens". Wijzig iets: je ziet "geen verbinding". Vliegtuigmodus uit: de wijziging wordt alsnog opgeslagen.
- [ ] Uitloggen, dan opnieuw inloggen.
- [ ] Update-balk: laat de app open op de achtergrond, push een wijziging (`node pwa/build.cjs`, commit, push) en wacht 1 à 2 minuten tot Pages klaar is. Open de app opnieuw: bovenaan staat "Nieuwe versie klaar". Tik op Verversen.
- [ ] Als beheerder: **Ophalen** (haalVoorstellen) en een beheerdersactie werken.

### Android (Chrome)

- [ ] Open de URL in Chrome. Je ziet de melding **App installeren**, of kies in het menu (⋮) **App installeren** of **Toevoegen aan startscherm**.
- [ ] Het icoon in de app-lade is netjes rond of afgerond bijgesneden (maskable), zonder afgeknipte letters.
- [ ] Bij het openen verschijnt een donker opstartscherm met het icoon, daarna de app zonder adresbalk.
- [ ] Statusbalk en navigatiebalk zijn donker, en niets valt eronder.
- [ ] Inloggen, iets invullen, "opgeslagen" zien.
- [ ] App sluiten en heropenen: nog ingelogd.
- [ ] Vliegtuigmodus: de app opent offline met de melding. Wijzigen geeft "geen verbinding", en na het herstel wordt het opgeslagen.
- [ ] De terug-knop sluit de app (er is geen geschiedenis), en dat is prima.
- [ ] Als beheerder: Ophalen en een beheerdersactie werken.

### Werkt het niet?

| Symptoom | Oorzaak |
|---|---|
| Blijft hangen op "laden…" met de melding "Geen verbinding met de server" | `HN_API` niet ingevuld of fout, of toegang staat niet op *Iedereen* |
| In de console: "blocked by CORS policy" | Toegang is "Iedereen met een Google-account", of de nieuwe versie is niet gepubliceerd |
| "Onbekende functie." | `doPost` staat niet in de gepubliceerde versie. Publiceer een nieuwe versie (stap 2) |
| Oude versie van de app blijft staan | Sluit de app helemaal en open opnieuw. De pagina wordt online altijd vers opgehaald |

---

## Lokaal testen (voor ontwikkelaars)

`pwa/test/mock-server.cjs` draait de **echte** `Code.gs` + `doPost-snippet.gs` in Node, met
nagebootste Apps Script-diensten (sheet in het geheugen, geen internet en geen mail). De API draait
op een andere origin en doet net als Google een 302-redirect, zodat CORS echt getest wordt.

```bash
cd pwa && npm install          # alleen playwright
npm run mock &                 # site op http://localhost:8787, API op :8788
npm test                       # end-to-end op iPhone 13, Pixel 7 en iPhone SE (Chromium)
```

De test doet het volgende: inloggen, alle tabbladen (geen horizontale scroll), opslaan via
applyPatches, de shim-API (handlers, user object, foutpad), een beheerdersactie, automatisch
inloggen na herladen, de service worker en het manifest, een serverstoring tijdens het opslaan met
herstel, offline openen uit de cache, de update-balk (die ook wacht op opslaan), het wissen van de cache bij uitloggen, en controleren dat elk
verzoek `text/plain` is (geen preflight). Schermafbeeldingen komen in `pwa/test/shots/`.
