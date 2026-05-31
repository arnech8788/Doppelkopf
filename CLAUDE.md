# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Doppelkopf Punktezettel ist eine PWA (Progressive Web App) zum Erfassen von Punktestaenden beim Doppelkopf-Spieleabend. Sie laeuft komplett im Browser. Seit v5.0 wird der Code mit **Vite** gebuendelt und in **ES-Module** unter `src/` aufgeteilt.

## Build & Entwicklung

- **Dependencies installieren**: `npm install`
- **Dev-Server (Hot Reload)**: `npm run dev`
- **Production-Build**: `npm run build` -> erzeugt `dist/`
- **Build-Vorschau**: `npm run preview`

Der Service Worker wird von `vite-plugin-pwa` (Workbox, `generateSW`) automatisch erzeugt;
es gibt **kein manuelles `sw.js` und kein manuelles `CACHE_NAME`** mehr. Cache-Busting laeuft
ueber Datei-Hashes; das `registerSW({ onNeedRefresh })` in `src/main.js` triggert den Update-Toast.

Externe Libraries (Firebase, Chart.js, html2canvas, qrcode-generator) sind npm-Pakete und werden
in den Modulen per `import` eingebunden (frueher CDN-`<script>`-Tags).

## Deployment

- **Production**: Push auf `main` -> GitHub Action (`.github/workflows/pages.yml`) baut mit Vite
  und deployt `dist/` nach GitHub Pages (base `/`).
- **Dev/Vorschau**: Push auf `dev` -> Action (`dev-deploy.yml`) baut mit `--base=/dev/` und legt
  das `dist/`-Ergebnis in den `/dev/`-Ordner auf `main`.
- Versionsnummer wird in `index.html` (Footer `#versionLabel`) und im Changelog-Array in
  `src/main.js` (`openInfoModal`) gepflegt. Kein `CACHE_NAME` mehr noetig.

## Architecture

Statische Huelle + CSS, App-Logik in ES-Modulen unter `src/`:

- **`index.html`** - Nur HTML-Struktur, bindet `styles.css` und `<script type="module" src="/src/main.js">` ein.
- **`styles.css`** - Externes Stylesheet mit CSS Custom Properties fuer das Theming (Light/Dark Mode).
- **`src/main.js`** - Entry Point: globaler `state`, Setter fuer geteilten State, `save()`/`load()`,
  Navigation (`showScreen`), Theme, Easter-Eggs, Info-/Debug-Modal, PWA-Registrierung. Importiert
  alle Module und registriert am Ende **alle** Funktionen per `Object.assign(window, …)` fuer die
  `onclick`-Handler.
- **`src/ui.js`** - Toast, Confirm, Prompt, Icons (`ICO`), Konfetti.
- **`src/setup.js`** - Spielerverwaltung, Solo-Typen, Bock-Einstellungen, Quickstart, `startNewGame`.
- **`src/eingabe.js`** - Punkteerfassung, Numpad, Punkterechner, Achievements, `finalizeRound`.
- **`src/tabelle.js`** - Rangliste, Spielverlauf, Edit-Modal, Sharing (html2canvas).
- **`src/stats.js`** - Statistiken, Charts (chart.js), Highlights, Achievement-Anzeige.
- **`src/archiv.js`** - Spielarchiv, Ewige Tabelle.
- **`src/turnier.js`** - Kompletter Turnier-Modus (Firebase Compat, Dashboard, Rotation, QR, Sync),
  Spieler-DB/Profil (`spieler/<id>`), Admin-Erkennung (`isAdmin`).
- **`src/admin.js`** - Admin-Bereich: Firebase-Datenbank-Browser (CRUD) + Admin-Verwaltung; nur fuer Admins.
- **`src/cloud.js`** - Persoenliches Cloud-Backup der eigenen Spiele (opt-in, `spieler/<id>/backup`).

### Modul-Konventionen (wichtig)

- **onclick-Handler**: ES-Module sind nicht global. `main.js` registriert daher alle Modul-Exporte
  per `Object.assign(window, …)`. Jede Funktion, die in HTML- oder `innerHTML`-`onclick` referenziert
  wird, muss `export`iert sein.
- **Geteilter mutabler State** (`currentPts`, `pendingRound`, `lastUndo`, `viewingArchive`,
  `prerenderedTabelle`, `prerenderedStats`, `timerInterval`) lebt in `main.js` als `export let`.
  Lesen per Import (live binding), **Schreiben ausschliesslich ueber die Setter**
  (`setCurrentPts(…)` etc.) – direkte Zuweisung wuerde im ESM-Strict-Mode crashen.
- Module importieren Helfer/Konstanten/Setter aus `./main.js` und UI-Helfer aus `./ui.js`.

### State Management

Ein einzelnes globales `state`-Objekt haelt alle Anwendungsdaten:

```js
state = {
  myPlayer: '',        // Name des eigenen Spielers
  players: [],         // Spielerliste (bestimmt Geberreihenfolge)
  rounds: [],          // Array aller eingetragenen Runden
  knownNames: [],      // Autovervollstaendigung fuer Spielernamen
  bockEnabled: bool,   // Bock-Runden-Feature aktiv
  bockCount: 4,        // Anzahl Bock-Runden pro Trigger
  bockSolo: bool,      // Bock auch bei Solo zaehlen
  bockQueue: 0,        // Anzahl ausstehender Bock-Runden
  soloTypesEnabled: bool,
  soloTypes: [...],    // Konfigurierbare Solo-Typen mit name/short/enabled
  gameStartTime: null,
  kursleiterCupSeen: bool,  // Easter-Egg-Flag
  dokoRundeSeen: bool       // Easter-Egg-Flag
}
```

State wird unter `'doko-v4'` in `localStorage` persistiert. Theme (`light`/`dark`) separat unter `'doko-theme'`.

### Screen Navigation

4 Screens, per Bottom-Navigation umgeschaltet:
- `setup` - Spielerverwaltung, Einstellungen (Bock, Solo-Typen)
- `eingabe` - Rundenerfassung mit Bock-Indikator
- `tabelle` - Spielverlauf-Tabelle mit Staenden
- `stats` - Statistiken mit Charts

### Modals

Alle Modals sind im HTML vordefiniert und werden per JS befuellt:
- `editModal` - Runde bearbeiten (Vollbild)
- `renameModal` - Spieler umbenennen
- `soloModal` - Solo-Typ-Auswahl
- `infoModal` - Info/Hilfe
- `calcHelpModal` - Punkterechner-Erklaerung
- `calcModal` - Punkterechner

### Rendering-Pattern

Alle `render*`-Funktionen schreiben direkt `innerHTML`. Die Eingabe-Ansicht verwendet einen einfachen Cache: Sie wird nur neu gerendert, wenn sich `state.rounds.length` geaendert hat (`eingabeContent.dataset.roundCount`).

### CSS Custom Properties

Das Design-System nutzt CSS Custom Properties fuer Light/Dark-Theming:
- `--bg`, `--bg2`, `--bg3` - Hintergrundfarben
- `--tx`, `--tx2`, `--tx3` - Textfarben
- `--bdr` - Rahmenfarbe
- `--r`, `--r-sm` - Border-Radius
- `--chart-grid`, `--chart-tick`, `--chart-lbl` - Chart-spezifische Farben
