# Code-Auslagerung mit Vite + ES Modules

## Ziel

Die monolithische `index.html` (4.100 Zeilen, davon ~3.900 Zeilen Inline-JS) wird in 8 fokussierte ES-Module aufgespalten. Vite dient als Bundler, `vite-plugin-pwa` generiert den Service Worker automatisch. Deployment bleibt GitHub Pages via GitHub Action.

Kein Feature-Change, keine UI-Aenderung – rein struktureller Umbau.

## Projekt-Struktur

```
Doppelkopf/
+-- index.html              <- nur Markup, kein Inline-Script
+-- styles.css              <- unveraendert
+-- src/
|   +-- main.js             <- Entry Point, State, Navigation, save()/load()
|   +-- ui.js               <- showToast(), showPrompt(), showConfirm(), Modals
|   +-- setup.js            <- Spielerverwaltung, Solo-Typen, Bock-Settings, Quickstart
|   +-- eingabe.js          <- Punkteerfassung, Numpad, finalizeRound()
|   +-- tabelle.js          <- Rangliste, Tabelle, Edit-Modal, Sharing
|   +-- stats.js            <- Statistiken, Charts, Highlights, Achievements
|   +-- archiv.js           <- Spielarchiv, Ewige Tabelle
|   +-- turnier.js          <- Firebase, Dashboard, Rotation, QR, Sync
+-- vite.config.js
+-- package.json
+-- .github/workflows/
|   +-- deploy.yml          <- Build + Deploy auf GitHub Pages
+-- manifest.json           <- bleibt
+-- icon-192.png            <- bleibt
+-- public/                 <- statische Assets (Icons etc.)
```

## Vite-Konfiguration

- Kein Framework, Vanilla-JS-Modus
- Entry Point: `src/main.js` wird per `<script type="module" src="/src/main.js">` in `index.html` eingebunden
- `vite-plugin-pwa`: generiert SW automatisch aus Build-Outputs
- Dev-Server: `npm run dev` fuer lokale Entwicklung mit Hot Reload
- Build: `npm run build` -> `dist/`-Ordner

## Modul-Aufteilung

### main.js (Entry Point)

- Globales `state`-Objekt (Definition + Default-Werte)
- `save()`, `load()` (localStorage)
- `showScreen()`, Screen-Navigation
- App-Initialisierung (DOMContentLoaded)
- Theme-Toggle
- Easter-Eggs (Versionslabel-Tap)
- Importiert und re-exportiert alle Module
- Registriert alle Funktionen auf `window` fuer onclick-Handler

### ui.js

- `showToast()`, `hideToast()`
- `showPrompt()` (styled prompt)
- `showConfirm()` (styled confirm)
- `launchConfetti()`
- Keine Abhaengigkeiten ausser DOM

### setup.js

- `addPlayer()`, `removePlayer()`, `renamePlayer()`, `movePlayer()`
- `renderPlayerList()`
- Solo-Typen-Verwaltung (`toggleSoloType()`, `addCustomSolo()`, `removeSoloType()`, `renderSoloTypes()`)
- Bock-Einstellungen
- `startNewGame()`
- Quickstart-Logik
- Importiert: state/save aus main.js, showToast/showPrompt aus ui.js

### eingabe.js

- `renderEingabe()`
- Numpad-Logik (`numpadPress()`, `numpadClear()`, `numpadToggleSign()`)
- Spieler-Chip-Interaktion (`cyclePlayer()`)
- `submitRound()`, `finalizeRound()`
- Undo-Logik
- Bock-Trigger-Toggle
- Importiert: state/save aus main.js, showToast aus ui.js, renderTabelle aus tabelle.js

### tabelle.js

- `renderTabelle()`
- Rangliste (standsCard)
- Spielverlauf-Tabelle mit Expand-Rows
- Edit-Modal (`openEditModal()`, `saveEditRound()`, `deleteRound()`, `moveRound()`)
- Share-Logik (`shareTabelle()`, `captureToBlob()`, `shareBlob()`, Prerendering)
- Importiert: state/save aus main.js, showToast/showConfirm aus ui.js

### stats.js

- `renderStats()`
- Chart-Erstellung (Line, Wins, Avg, Solo)
- Spieler-Statistik-Grid
- Team-Paarungen
- `buildHighlights()` (Spielabend-Highlights)
- `buildAchievementSection()`
- Achievement-Logik (`checkRoundAchievements()`, `checkSeasonAchievements()`)
- `shareStats()`
- Importiert: state aus main.js, archiv aus archiv.js

### archiv.js

- `loadArchive()`, `saveArchive()`, `deleteArchivedGame()`
- `renderArchiveList()`
- `openArchivedGame()`, `closeArchiveView()`
- Ewige Tabelle (`openAllTimeModal()`)
- `formatArchiveDate()`
- Importiert: state/save aus main.js, showConfirm aus ui.js

### turnier.js

- Firebase-Init und alle Firebase-Operationen
- Turnier-Wizard (Create)
- Turnier-Dashboard (Tische, Gesamtwertung, Historie)
- Beitritt (Join, QR, Share-Link)
- Spieler-App-Modus
- Schreiber-Rolle
- Rotation (manuell/auto, Self-Rotation, Host-Zuweisung)
- Turnier-Archiv
- Turnier-Indikator
- Co-Host/Admin-Verwaltung
- Importiert: state/save aus main.js, showToast/showPrompt/showConfirm aus ui.js, setup.js, tabelle.js

## onclick-Handler

ES Modules sind nicht global. Loesung:

- `main.js` importiert alle oeffentlichen Funktionen und registriert sie auf `window`:
  ```js
  import { addPlayer } from './setup.js';
  window.addPlayer = addPlayer;
  ```
- Statisches HTML (index.html) und dynamisches HTML (innerHTML) referenzieren weiterhin Funktionsnamen als Strings
- Langfristig (Phase 2, UI-Redesign) werden onclick-Attribute durch addEventListener ersetzt

## CDN-Dependencies -> npm

Aktuell per `<script>` geladen, werden zu npm-Packages:

| CDN | npm Package |
|-----|-------------|
| Firebase Compat SDK | `firebase` |
| html2canvas | `html2canvas` |
| Chart.js | `chart.js` |
| qrcode-generator | `qrcode-generator` |

Import in den jeweiligen Modulen statt globaler `<script>`-Tags.

## Service Worker (vite-plugin-pwa)

- Strategie: `generateSW` (Workbox)
- Precache: alle Build-Assets (JS, CSS, HTML, Icons)
- Runtime-Caching: Google Fonts ueber CacheFirst-Strategie
- Update-Flow: `registerSW({ onNeedRefresh })` triggert den bestehenden Update-Toast
- `sw.js` wird geloescht, der generierte SW ersetzt ihn
- Kein manuelles `CACHE_NAME` mehr noetig

## GitHub Action (deploy.yml)

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - uses: actions/deploy-pages@v4
```

## State-Kompatibilitaet

- localStorage-Keys bleiben identisch (`doko-v4`, `doko-v4-archive`, etc.)
- State-Format aendert sich nicht
- Bestehende Nutzerdaten bleiben erhalten

## Versionsmanagement nach Migration

- Versionsnummer: weiterhin in `index.html` (Footer) und im Changelog-Array
- CACHE_NAME entfaellt (automatisch via Datei-Hashes)
- Changelog-Array bleibt in `main.js` (oder eigene Datei)

## Was sich fuer den Entwickler aendert

| Vorher | Nachher |
|--------|---------|
| Datei bearbeiten, Browser reload | `npm run dev`, Hot Reload |
| Manuell CACHE_NAME hochsetzen | Automatisch via Datei-Hashes |
| Push auf main, sofort live | Push auf main, Action baut, dann live |
| Alles in einer Datei | 8 fokussierte Module |
| CDN-Scripts im HTML | npm-Packages mit import |
