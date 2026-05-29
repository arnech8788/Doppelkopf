# Code-Auslagerung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die monolithische index.html (4.100 Zeilen Inline-JS) in 8 ES-Module aufspalten, mit Vite als Bundler und vite-plugin-pwa fuer automatisches Service-Worker-Management.

**Architecture:** Vite im Vanilla-JS-Modus bundelt 8 ES-Module. Alle Funktionen werden auf `window` registriert damit onclick-Handler weiterhin funktionieren. vite-plugin-pwa generiert den Service Worker automatisch. GitHub Pages Deployment via GitHub Action mit Build-Schritt.

**Tech Stack:** Vite, vite-plugin-pwa (Workbox), ES Modules, npm

---

## Wichtige Hinweise fuer den ausfuehrenden Agenten

- **Kein Feature-Change**: Die App muss nach jeder Task exakt gleich funktionieren wie vorher.
- **Testen**: Nach jeder Task `npm run build` ausfuehren und pruefen ob der Build durchlaeuft. Dann `npm run preview` starten und im Browser testen.
- **Zeilenbereiche**: Die genannten Zeilennummern beziehen sich auf die aktuelle `index.html` (v4.49, 4094 Zeilen). Verwende sie als Orientierung, nicht als exakte Werte.
- **window-Registrierung**: Jede Funktion die in HTML-onclick-Handlern oder in innerHTML-Strings referenziert wird, MUSS auf `window` registriert werden. Suche nach `onclick="functionName(` in index.html UND in JS-Strings (innerHTML).
- **Reihenfolge**: Tasks muessen in der angegebenen Reihenfolge ausgefuehrt werden. Spaetere Tasks haengen von frueheren ab.

---

### Task 1: Vite-Projekt initialisieren

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `src/main.js` (leer, nur Platzhalter)
- Modify: `index.html`
- Modify: `.gitignore`
- Delete: `sw.js`

- [ ] **Step 1: npm init und Dependencies installieren**

```bash
cd /c/Daten/Entwicklung/HTML/ACH/Doppelkopf
npm init -y
npm install --save-dev vite vite-plugin-pwa
npm install firebase html2canvas chart.js qrcode-generator
```

- [ ] **Step 2: package.json Scripts anpassen**

Bearbeite `package.json` und setze die Scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

- [ ] **Step 3: vite.config.js erstellen**

```js
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,json}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 }
            }
          }
        ]
      },
      manifest: false
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
```

- [ ] **Step 4: Leere Entry-Datei erstellen**

Erstelle `src/main.js` mit dem Inhalt:

```js
// Entry point - wird in den folgenden Tasks befuellt
console.log('Doppelkopf App loaded');
```

- [ ] **Step 5: index.html anpassen – CDN-Scripts durch ES Module Entry ersetzen**

In `index.html`:

1. Entferne die 5 CDN-Script-Tags (Zeilen 120-124):
   ```html
   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
   <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js"></script>
   <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
   <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
   <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
   ```

2. Entferne das komplette Inline-`<script>...</script>` (Zeile 125 bis Zeile 4088, also `<script>` bis `</script>`).

3. Fuege stattdessen ein:
   ```html
   <script type="module" src="/src/main.js"></script>
   ```

4. Behalte das GoatCounter-Script (Zeile 4089-4091) – das ist extern und bleibt.

- [ ] **Step 6: .gitignore aktualisieren**

Fuege hinzu:

```
node_modules/
dist/
```

- [ ] **Step 7: sw.js loeschen**

Loesche `sw.js` – der Service Worker wird jetzt von vite-plugin-pwa generiert.

- [ ] **Step 8: Statische Assets in public/ verschieben**

```bash
mkdir -p public
mv manifest.json public/
mv icon-192.png public/
mv icon-512.png public/ 2>/dev/null
```

(Falls icon-512.png nicht existiert, ist das OK.)

- [ ] **Step 9: Build testen**

```bash
npm run build
```

Erwartung: Build laeuft durch, `dist/` wird erstellt. Die App wird noch nicht funktionieren (main.js ist leer), aber der Build-Prozess muss fehlerfrei sein.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vite.config.js src/main.js .gitignore index.html
git add -u sw.js
git commit -m "chore: Vite-Projekt initialisieren, Inline-JS entfernen, sw.js loeschen"
```

---

### Task 2: src/ui.js – UI-Helfer extrahieren

**Files:**
- Create: `src/ui.js`

Extrahiere aus dem ehemaligen Inline-Script (das jetzt in keiner Datei mehr steht – nutze git diff oder den letzten Stand):

- [ ] **Step 1: src/ui.js erstellen**

Inhalt – alle UI-Hilfsfunktionen:

```js
// Toast
let toastTimer = null;

export function showToast(text, type) {
  const el = document.getElementById('appToast');
  const tx = document.getElementById('appToastText');
  tx.textContent = text;
  el.className = 'app-toast ' + (type || 'info');
  el.classList.add('show');
  el.onclick = hideToast;
  clearTimeout(toastTimer);
}

export function hideToast() {
  document.getElementById('appToast').classList.remove('show');
}

// Confirm-Dialog
export function showConfirm(text, actionLabel, danger) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmText').textContent = text;
    const actionBtn = document.getElementById('confirmAction');
    actionBtn.textContent = actionLabel || 'OK';
    actionBtn.className = 'confirm-action' + (danger ? ' danger' : '');
    overlay.classList.add('show');
    const cancel = document.getElementById('confirmCancel');
    function cleanup() { overlay.classList.remove('show'); actionBtn.onclick = null; cancel.onclick = null; overlay.onclick = null }
    actionBtn.onclick = function() { cleanup(); resolve(true) };
    cancel.onclick = function() { cleanup(); resolve(false) };
    overlay.onclick = function(e) { if (e.target === overlay) { cleanup(); resolve(false) } };
  });
}

// Prompt-Dialog
export function showPrompt(text, placeholder, actionLabel) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmText').innerHTML = text + '<input type="text" id="confirmInput" placeholder="' + (placeholder || '') + '" style="width:100%;box-sizing:border-box;font-size:15px;padding:10px;margin-top:12px;border:1px solid var(--bdr);border-radius:var(--r-sm);background:var(--bg);color:var(--tx)">';
    const actionBtn = document.getElementById('confirmAction');
    actionBtn.textContent = actionLabel || 'OK';
    actionBtn.className = 'confirm-action';
    overlay.classList.add('show');
    setTimeout(() => { const inp = document.getElementById('confirmInput'); if (inp) inp.focus() }, 100);
    const cancel = document.getElementById('confirmCancel');
    function cleanup() { overlay.classList.remove('show'); actionBtn.onclick = null; cancel.onclick = null; overlay.onclick = null }
    actionBtn.onclick = function() { const val = document.getElementById('confirmInput').value.trim(); cleanup(); resolve(val || null) };
    cancel.onclick = function() { cleanup(); resolve(null) };
    overlay.onclick = function(e) { if (e.target === overlay) { cleanup(); resolve(null) } };
  });
}

// SVG Icons
export const ICO = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
  backspace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
};

// Konfetti
export function launchConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);
  const colors = ['#5b4cdb', '#2ec4b6', '#e05252', '#f0a830', '#3498db'];
  for (let i = 0; i < 40; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + '%';
    c.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    c.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    c.style.width = (4 + Math.random() * 8) + 'px';
    c.style.height = (4 + Math.random() * 8) + 'px';
    c.style.animationDuration = (1 + Math.random() * 1.5) + 's';
    c.style.animationDelay = (Math.random() * 0.3) + 's';
    container.appendChild(c);
  }
  setTimeout(() => container.remove(), 2500);
}

export function launchMiniConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);
  const colors = ['#5b4cdb', '#2ec4b6', '#f0a830'];
  for (let i = 0; i < 15; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + '%';
    c.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    c.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    c.style.width = (4 + Math.random() * 8) + 'px';
    c.style.height = (4 + Math.random() * 8) + 'px';
    c.style.animationDuration = (1 + Math.random() * 1.5) + 's';
    c.style.animationDelay = (Math.random() * 0.3) + 's';
    c.style.fontSize = (10 + Math.random() * 10) + 'px';
    c.style.color = colors[Math.floor(Math.random() * colors.length)];
    container.appendChild(c);
  }
  setTimeout(() => container.remove(), 2500);
}
```

**WICHTIG:** Dies ist ein Template. Der Agent MUSS den exakten Code aus dem letzten git-Commit (vor dem Inline-Script-Entfernen) verwenden. Falls der Code in Task 1 schon entfernt wurde, nutze `git show HEAD~1:index.html` um den Originalcode zu lesen.

- [ ] **Step 2: Commit**

```bash
git add src/ui.js
git commit -m "refactor: ui.js – Toast, Confirm, Prompt, Icons, Konfetti extrahiert"
```

---

### Task 3: src/main.js – State, Navigation, Konstanten, Theme

**Files:**
- Create/Replace: `src/main.js`

Extrahiere den Kern der App:

- [ ] **Step 1: src/main.js schreiben**

Inhalt (Kurzfassung – der Agent muss den EXAKTEN Code aus dem Original uebernehmen):

```js
import { showToast, hideToast, showConfirm, showPrompt, ICO, launchConfetti, launchMiniConfetti } from './ui.js';

// Konstanten
export const COLORS = ['#5b4cdb', '#0a8f6a', '#c0392b', '#d68910', '#2980b9', '#7c6fef', '#16a085', '#e74c3c', '#f39c12', '#3498db'];
export const DEFAULT_SOLOS = [/* ... exakt aus Original ... */];
export const ACHIEVEMENTS = {/* ... exakt aus Original ... */};

// Debug-Logging
export const _debugLogs = [];
// ... console.error/warn overrides ...

// State
export let state = {/* ... exakt aus Original ... */};
export let currentPts = '';
export let editingRound = null;
export let chartInstances = [];
export let pendingRound = null;
export let lastUndo = null;
export let viewingArchive = null;
export let prerenderedTabelle = null;
export let prerenderedStats = null;
export let prerenderTimer = null;
export let timerInterval = null;

// Setter-Funktionen (da ES Module-Exports immutable sind)
export function setCurrentPts(v) { currentPts = v; }
export function setEditingRound(v) { editingRound = v; }
export function setChartInstances(v) { chartInstances = v; }
export function setPendingRound(v) { pendingRound = v; }
export function setLastUndo(v) { lastUndo = v; }
export function setViewingArchive(v) { viewingArchive = v; }
export function setPrerenderedTabelle(v) { prerenderedTabelle = v; }
export function setPrerenderedStats(v) { prerenderedStats = v; }
export function setPrerenderTimer(v) { prerenderTimer = v; }
export function setTimerInterval(v) { timerInterval = v; }

// save/load
export function save() { /* ... exakt aus Original ... */ }
export function load() { /* ... exakt aus Original ... */ }

// Screen Navigation
export function showScreen(id) { /* ... exakt aus Original ... */ }

// Theme
export function toggleTheme() { /* ... exakt aus Original ... */ }
export function updateThemeIcon() { /* ... exakt aus Original ... */ }
export function getChartColors() { /* ... exakt aus Original ... */ }

// Easter Eggs
export const KURSLEITER_NAMES = [/* ... */];
// ... alle Easter-Egg-Funktionen ...

// Hilfsfunktionen
export function getAllPlayers() { return [...state.players] }
export function getHistoricalPlayers() { /* ... */ }
export function getShortNames(playerList) { /* ... */ }
export function invalidateEingabeCache() { /* ... */ }
export function isBockRound() { return state.bockEnabled && state.bockQueue > 0 }

// Device Info
export async function getDeviceInfo() { /* ... */ }

// Registriere ALLE importierten und lokalen Funktionen auf window
// (wird am Ende der Datei gemacht, nachdem alle Module importiert sind)
```

**Kritisch:** Am Ende von `main.js` werden spaeter (nach Task 8) alle Funktionen aus allen Modulen auf `window` registriert. Fuer jetzt nur die lokalen.

- [ ] **Step 2: window-Registrierungen hinzufuegen**

Am Ende von `main.js`:

```js
// Window-Registrierungen fuer onclick-Handler
window.showScreen = showScreen;
window.toggleTheme = toggleTheme;
window.showToast = showToast;
window.hideToast = hideToast;
// ... alle weiteren Funktionen die in onclick im HTML referenziert werden
```

- [ ] **Step 3: Build testen**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "refactor: main.js – State, Navigation, Konstanten, Theme extrahiert"
```

---

### Task 4: src/setup.js – Spielerverwaltung

**Files:**
- Create: `src/setup.js`
- Modify: `src/main.js` (Imports + window-Registrierungen)

- [ ] **Step 1: src/setup.js erstellen**

Extrahiere aus dem Original (ca. Zeile 540-810):

- `renderSoloTypes()`, `toggleSoloType()`, `removeSoloType()`, `addCustomSolo()`
- `renderQuickStart()`, `quickStart()`
- `renderPlayerTags()`, `movePlayer()`, `editPlayerName()`, `closeRenameModal()`, `savePlayerName()`
- `addPlayer()`, `removePlayer()`, `checkAutoStart()`
- `addInp` Event-Listener, `pickSuggestion()`
- `startNewGame()`
- `editingPlayerIdx` Variable

Jede Funktion importiert was sie braucht aus `main.js` und `ui.js`.

```js
import { state, save, getAllPlayers, getHistoricalPlayers, invalidateEingabeCache } from './main.js';
import { showToast, showConfirm, ICO } from './ui.js';
import { loadArchive } from './archiv.js';
import { renderTabelle } from './tabelle.js';
import { renderTurnierSetup, renderTurnierIndicator, leaveTurnier } from './turnier.js';
import { renderArchiveList } from './archiv.js';

// ... alle Funktionen exakt aus dem Original ...

export { renderSoloTypes, toggleSoloType, removeSoloType, addCustomSolo };
export { renderQuickStart, quickStart };
export { renderPlayerTags, movePlayer, editPlayerName, closeRenameModal, savePlayerName };
export { addPlayer, removePlayer, checkAutoStart, pickSuggestion };
export { startNewGame };
```

**WICHTIG:** Der `addInp` Event-Listener (Zeile 668-679) muss in einer Init-Funktion oder direkt im Modul-Toplevel stehen. Da ES Modules erst nach DOMContentLoaded ausfuehren wenn `type="module"` und das Script im `<body>` steht, sollte das funktionieren. Falls nicht, in eine `initSetup()` Funktion wrappen die von `main.js` aufgerufen wird.

- [ ] **Step 2: main.js aktualisieren**

Fuege Imports und window-Registrierungen hinzu:

```js
import { renderSoloTypes, toggleSoloType, removeSoloType, addCustomSolo, renderQuickStart, quickStart, renderPlayerTags, movePlayer, editPlayerName, closeRenameModal, savePlayerName, addPlayer, removePlayer, pickSuggestion, startNewGame } from './setup.js';

// ... in den window-Registrierungen:
window.toggleSoloType = toggleSoloType;
window.removeSoloType = removeSoloType;
window.addCustomSolo = addCustomSolo;
window.quickStart = quickStart;
window.movePlayer = movePlayer;
window.editPlayerName = editPlayerName;
window.closeRenameModal = closeRenameModal;
window.savePlayerName = savePlayerName;
window.addPlayer = addPlayer;
window.removePlayer = removePlayer;
window.pickSuggestion = pickSuggestion;
window.startNewGame = startNewGame;
```

- [ ] **Step 3: Build testen**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/setup.js src/main.js
git commit -m "refactor: setup.js – Spielerverwaltung, Solo-Typen, Quickstart extrahiert"
```

---

### Task 5: src/eingabe.js – Punkteerfassung

**Files:**
- Create: `src/eingabe.js`
- Modify: `src/main.js`

- [ ] **Step 1: src/eingabe.js erstellen**

Extrahiere (ca. Zeile 2659-2906):

- `renderEingabe()`
- `getWinStreaks()`, `getLooseStreaks()`, `getFlames()`, `getSkulls()`, `getStreakIcon()`
- `formatDuration()`, `updateTimerDisplay()`, `startTimerUpdate()`
- `cycleState()`, `numpadPress()`, `numpadDelete()`, `numpadClear()`, `numpadToggleSign()`
- `updatePtsDisplay()`, `undoLastRound()`, `saveNewRound()`
- `openSoloModal()`, `selectSoloType()`, `confirmSoloType()`, `skipSoloType()`
- `checkRoundAchievements()`, `loadSeasonAchievements()`, `saveSeasonAchievements()`, `checkSeasonAchievements()`
- `finalizeRound()`
- Punkterechner: `openCalcModal()`, `calcCounter()`, `calcAutoCheck()`, `setCalcType()`, `calcPoints()`, `applyCalcPoints()`, `closeCalcModal()`, `openCalcHelpModal()`, `closeCalcHelpModal()`
- `calcGameType`, `calcCounterMax` Variablen

```js
import { state, save, currentPts, setCurrentPts, pendingRound, setPendingRound, lastUndo, setLastUndo, timerInterval, setTimerInterval, chartInstances, getAllPlayers, getHistoricalPlayers, isBockRound, getPlayerEmoji, getVocab, isKursleiterMode, isDokoRundeMode, COLORS, ACHIEVEMENTS } from './main.js';
import { showToast, showConfirm, ICO, launchConfetti, launchMiniConfetti } from './ui.js';
import { renderTabelle, schedulePrerenderShareImages } from './tabelle.js';
import { showScreen } from './main.js';

// ... alle Funktionen ...
```

- [ ] **Step 2: main.js aktualisieren mit Imports und window-Registrierungen**

Alle onclick-Funktionen aus eingabe.js auf window registrieren:
`cycleState`, `numpadPress`, `numpadDelete`, `numpadClear`, `numpadToggleSign`, `undoLastRound`, `saveNewRound`, `openSoloModal`, `selectSoloType`, `confirmSoloType`, `skipSoloType`, `openCalcModal`, `calcCounter`, `calcAutoCheck`, `setCalcType`, `applyCalcPoints`, `closeCalcModal`, `openCalcHelpModal`, `closeCalcHelpModal`

- [ ] **Step 3: Build testen**

- [ ] **Step 4: Commit**

```bash
git add src/eingabe.js src/main.js
git commit -m "refactor: eingabe.js – Punkteerfassung, Numpad, Achievements extrahiert"
```

---

### Task 6: src/tabelle.js – Tabelle, Edit-Modal, Sharing

**Files:**
- Create: `src/tabelle.js`
- Modify: `src/main.js`

- [ ] **Step 1: src/tabelle.js erstellen**

Extrahiere (ca. Zeile 3099-3730):

- `openEditModal()`, `closeEditModal()`
- `editNumpadPress()`, `editNumpadDelete()`, `editNumpadClear()`, `editNumpadToggleSign()`, `updateEditPtsDisplay()`
- `saveEditRound()`, `deleteRound()`, `moveRound()`
- `toggleRowMenu()`, `closeAllMenus()`
- `renderTabelle()`, `toggleExpand()`
- Share-Funktionen: `captureToBlob()`, `shareBlob()`, `captureAndShare()`, `schedulePrerenderShareImages()`, `prerenderShareImages()`, `shareStats()`, `buildShareTableElement()`, `shareTabelle()`

```js
import html2canvas from 'html2canvas';
import { state, save, currentPts, setCurrentPts, editingRound, setEditingRound, viewingArchive, prerenderedTabelle, setPrerenderedTabelle, prerenderedStats, setPrerenderedStats, prerenderTimer, setPrerenderTimer, getHistoricalPlayers, getShortNames, isBockRound, getPlayerEmoji, getStreakIcon, getWinStreaks, getLooseStreaks, COLORS, invalidateEingabeCache } from './main.js';
import { showToast, showConfirm, ICO } from './ui.js';

// ... alle Funktionen ...
```

**WICHTIG:** `html2canvas` wird jetzt als npm-Package importiert statt ueber CDN. Der Import ist `import html2canvas from 'html2canvas';`.

- [ ] **Step 2: editModal click-Handler**

Der Event-Listener `document.getElementById('editModal').addEventListener('click',...)` muss im Modul-Toplevel oder in einer Init-Funktion stehen.

- [ ] **Step 3: main.js aktualisieren**

window-Registrierungen: `openEditModal`, `closeEditModal`, `editNumpadPress`, `editNumpadDelete`, `editNumpadClear`, `editNumpadToggleSign`, `saveEditRound`, `deleteRound`, `moveRound`, `toggleRowMenu`, `closeAllMenus`, `toggleExpand`, `shareStats`, `shareTabelle`, `renderTabelle`

- [ ] **Step 4: Build testen**

- [ ] **Step 5: Commit**

```bash
git add src/tabelle.js src/main.js
git commit -m "refactor: tabelle.js – Tabelle, Edit-Modal, Sharing extrahiert"
```

---

### Task 7: src/stats.js – Statistiken und Charts

**Files:**
- Create: `src/stats.js`
- Modify: `src/main.js`

- [ ] **Step 1: src/stats.js erstellen**

Extrahiere (ca. Zeile 3305-3540):

- `renderStats()`
- `buildCharts()`
- `buildPairings()`
- `buildHighlights()`, `formatHighlightDuration()`
- `buildAchievementSection()`

```js
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

import { state, viewingArchive, chartInstances, setChartInstances, getHistoricalPlayers, COLORS, ACHIEVEMENTS, getChartColors } from './main.js';
import { loadArchive } from './archiv.js';
import { loadSeasonAchievements } from './eingabe.js';

// ... alle Funktionen ...
```

**WICHTIG:** Chart.js wird jetzt als npm-Package importiert. `Chart` ist nicht mehr global. Der Code verwendet aktuell `new Chart(ctx, config)` – das muss weiterhin funktionieren.

- [ ] **Step 2: main.js aktualisieren**

window-Registrierungen: `renderStats`

- [ ] **Step 3: Build testen**

- [ ] **Step 4: Commit**

```bash
git add src/stats.js src/main.js
git commit -m "refactor: stats.js – Statistiken, Charts, Highlights extrahiert"
```

---

### Task 8: src/archiv.js – Spielarchiv und Ewige Tabelle

**Files:**
- Create: `src/archiv.js`
- Modify: `src/main.js`

- [ ] **Step 1: src/archiv.js erstellen**

Extrahiere (ca. Zeile 482-521, 811-842, 2516-2620):

- `loadArchive()`, `saveArchive()`, `archiveCurrentGame()`, `deleteArchivedGame()`, `getArchiveWinner()`
- `formatArchiveDate()`, `renderArchiveList()`
- `deleteArchived()`, `openArchivedGame()`, `closeArchiveView()`
- `closeAllTimeModal()`, `openAllTimeModal()` (inkl. `allTimeChartInstance`)

```js
import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

import { state, save, viewingArchive, setViewingArchive, COLORS, getChartColors, prerenderedTabelle, setPrerenderedTabelle, prerenderedStats, setPrerenderedStats } from './main.js';
import { showConfirm, ICO } from './ui.js';
import { showScreen } from './main.js';
import { schedulePrerenderShareImages } from './tabelle.js';

// ... alle Funktionen ...
```

- [ ] **Step 2: main.js aktualisieren**

window-Registrierungen: `openArchivedGame`, `closeArchiveView`, `deleteArchived`, `openAllTimeModal`, `closeAllTimeModal`

- [ ] **Step 3: Build testen**

- [ ] **Step 4: Commit**

```bash
git add src/archiv.js src/main.js
git commit -m "refactor: archiv.js – Spielarchiv, Ewige Tabelle extrahiert"
```

---

### Task 9: src/turnier.js – Kompletter Turnier-Modus

**Files:**
- Create: `src/turnier.js`
- Modify: `src/main.js`

- [ ] **Step 1: src/turnier.js erstellen**

Dies ist das groesste Modul. Extrahiere (ca. Zeile 157-343, 843-2515, 2350-2470):

Firebase-Init und Spieler-DB:
- `FIREBASE_CONFIG`, `firebaseApp`, `firebaseDb`, `turnierListener`, `spielerCache`
- `initFirebase()`, `getDeviceId()`, `generateSpielerShort()`, `generateQR()`
- `loadSpielerDB()`, `findSpielerByDevice()`, `findSpielerByName()`, `createSpieler()`, `addDeviceToSpieler()`
- `checkFirstStart()`, `showNameModal()`, `submitName()`, `claimExistingSpieler()`

Turnier-Setup und Wizard:
- `renderTurnierSetup()`, `renderTurnierIndicator()`
- `openEditTurnierConfig()`, `renderEditConfig()`, `toggleTurnierConfig()`
- Wizard: `turnierWizard`, `openCreateTurnier()`, `closeCreateTurnier()`, `renderWizardStep()`, `renderWizardStep1..4()`
- `submitCreateTurnier()`, `showTurnierShareModal()`

Beitritt:
- `openJoinTurnier()`, `closeJoinTurnier()`, `loadJoinTurnierInfo()`
- `joinTurnier()`, `joinAsCoHost()`, `joinAsPlayer()`, `createAndJoinAsPlayer()`
- `registerAsPlayer()`, `openPlayerTischWahl()`
- `selectJoinTisch()`, `renderJoinPlayerSelect()`, `autoPreselectOwnPlayer()`, `toggleJoinPlayer()`
- `openAddPlayerDialog()`

Dashboard:
- `openTurnierDashboard()`, `closeTurnierDashboard()`, `renderTurnierDashboard()`
- `dashboardTab`, `lastTischeSnapshot`, `rotationenCache`, `zuweisungData`, `zuweisungActiveTisch`

Rotation:
- `startRotation()`, `openTischZuweisung()`, `renderZuweisung()`
- `assignSpieler()`, `unassignSpieler()`, `saveTischZuweisung()`
- `openSelfRotationChoice()`, `selfJoinTisch()`

Sonstiges:
- `syncToFirebase()`, `syncTischPlayersToSetup()`, `restoreTischPlayers()`
- `transferSchreiber()`, `openMeineSpiele()`
- `showTurnierQRCodes()`, `showTurnierDetail()`
- `archiveTurnier()`, `showTurnierArchiv()`, `openArchivTurnier()`
- `endTurnier()`, `leaveTurnier()`
- `openCoHostSelect()`, `toggleCoHost()`, `saveCoHosts()`
- `hostJoinTisch()`, `hostLeaveTisch()`
- `checkTurnierUrlParam()`
- `shareTurnierCode()`, `copyTurnierLink()`
- `turnierConfigCache`, `coHostSelected`

```js
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, child, onValue, off, remove, ServerValue } from 'firebase/database';
import qrcode from 'qrcode-generator';

import { state, save, getAllPlayers, getHistoricalPlayers, invalidateEingabeCache } from './main.js';
import { showToast, showConfirm, showPrompt, ICO } from './ui.js';
import { renderPlayerTags } from './setup.js';

// ... alle Funktionen ...
```

**WICHTIG:** Firebase wechselt von Compat SDK auf Modular SDK. Das aendert die API:
- Statt `firebase.initializeApp(config)` → `initializeApp(config)`
- Statt `firebase.database().ref('path')` → `ref(getDatabase(), 'path')`
- Statt `.once('value')` → `get(ref(db, 'path'))`
- Statt `.set(value)` → `set(ref(db, 'path'), value)`
- Statt `.on('value', cb)` → `onValue(ref(db, 'path'), cb)`
- Statt `firebase.database.ServerValue.TIMESTAMP` → `ServerValue.TIMESTAMP` (aus `firebase/database`)

**ALTERNATIV:** Falls die Migration zu aufwaendig ist, kann Firebase Compat auch als npm-Package verwendet werden:
```js
import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
```
Das ist einfacher und aendert keinen Code. **Empfohlen fuer diese Phase.**

QR-Code:
- `import qrcode from 'qrcode-generator'` – die API bleibt gleich

- [ ] **Step 2: main.js aktualisieren**

Alle Turnier-Funktionen auf window registrieren. Es sind viele – der Agent muss alle onclick-Referenzen in index.html UND in innerHTML-Strings im Turnier-Code finden.

Mindestens: `openCreateTurnier`, `closeCreateTurnier`, `openJoinTurnier`, `closeJoinTurnier`, `openTurnierDashboard`, `closeTurnierDashboard`, `shareTurnierCode`, `copyTurnierLink`, `submitName`, `claimExistingSpieler`, `toggleWizPlayer`, `openAddPlayerDialog`, `submitCreateTurnier`, `joinTurnier`, `joinAsCoHost`, `joinAsPlayer`, `createAndJoinAsPlayer`, `selectJoinTisch`, `toggleJoinPlayer`, `openPlayerTischWahl`, `startRotation`, `assignSpieler`, `unassignSpieler`, `saveTischZuweisung`, `openSelfRotationChoice`, `selfJoinTisch`, `showTurnierQRCodes`, `showTurnierDetail`, `showTurnierArchiv`, `openArchivTurnier`, `endTurnier`, `leaveTurnier`, `openCoHostSelect`, `toggleCoHost`, `saveCoHosts`, `hostJoinTisch`, `hostLeaveTisch`, `transferSchreiber`, `openMeineSpiele`, `toggleTurnierConfig`, `openEditTurnierConfig`, `archiveTurnier`, `renderTurnierDashboard`

- [ ] **Step 3: Build testen**

- [ ] **Step 4: Commit**

```bash
git add src/turnier.js src/main.js
git commit -m "refactor: turnier.js – kompletter Turnier-Modus extrahiert"
```

---

### Task 10: src/main.js finalisieren – Info-Modal, Debug, PWA-Registration

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Restliche Funktionen in main.js einbauen**

Funktionen die keinem anderen Modul zugeordnet sind:

- `openInfoModal()`, `closeInfoModal()` (inkl. Changelog-Array)
- `sendFeedbackMail()`
- `handleVersionTap()`, `_versionTaps`, `_versionTapTimer`
- `openDebugModal()`, `closeDebugModal()`, `copyStateJSON()`, `toggleStateImport()`, `importState()`
- PWA-Registration (vite-plugin-pwa uebernimmt das jetzt):

```js
import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
  onNeedRefresh() {
    const toast = document.getElementById('updateToast');
    if (toast) {
      toast.classList.add('show');
      setTimeout(() => location.reload(), 3000);
    }
  }
});
```

- [ ] **Step 2: load() Aufruf am Ende**

Am Ende von `main.js`:

```js
// App initialisieren
load();
```

- [ ] **Step 3: window-Registrierungen vervollstaendigen**

Alle noch fehlenden onclick-Funktionen: `openInfoModal`, `closeInfoModal`, `sendFeedbackMail`, `handleVersionTap`, `openDebugModal`, `closeDebugModal`, `copyStateJSON`, `toggleStateImport`, `importState`

- [ ] **Step 4: Build testen und im Browser pruefen**

```bash
npm run build
npm run preview
```

Oeffne http://localhost:4173 und pruefe:
- Alle 4 Screens funktionieren
- Spieler hinzufuegen/entfernen
- Spiel eintragen
- Tabelle und Stats werden gerendert
- Teilen funktioniert
- Theme-Toggle
- Info-Modal mit Changelog
- Archiv (wenn Daten vorhanden)

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "refactor: main.js – Info-Modal, Debug, PWA-Registration finalisiert"
```

---

### Task 11: GitHub Action aktualisieren

**Files:**
- Modify: `.github/workflows/pages.yml`

- [ ] **Step 1: pages.yml aktualisieren**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build-deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: 'dist'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: GitHub Action mit Vite Build-Schritt aktualisieren"
```

---

### Task 12: Abschluss – Aufraeum und Smoke-Test

**Files:**
- Modify: `src/main.js` (Version)
- Cleanup: Nicht mehr benoetigte Dateien

- [ ] **Step 1: Version aktualisieren**

In `index.html` die Versionsnummer hochsetzen (v5.0, da grosser struktureller Umbau). Changelog-Eintrag in `main.js` (wo das Changelog-Array jetzt lebt) hinzufuegen.

- [ ] **Step 2: Kompletter Smoke-Test**

```bash
npm run build
npm run preview
```

Pruefe im Browser:
1. Setup: Spieler hinzufuegen, umbenennen, loeschen, sortieren
2. Setup: Solo-Typen, Bock-Einstellungen
3. Eingabe: Punkte eintippen, Spieler-Chips, Spiel speichern
4. Tabelle: Rangliste, Spielverlauf, Expand-Row, Edit-Modal
5. Stats: Charts laden, Highlights, Achievements
6. Teilen: Tabelle und Stats teilen
7. Archiv: Neues Spiel starten, Archiv oeffnen
8. Theme-Toggle: Light/Dark
9. Info-Modal: Oeffnet, Changelog sichtbar
10. PWA: Update-Toast bei Aenderung (optional)
11. Turnier (falls Firebase erreichbar): Erstellen, Code anzeigen

- [ ] **Step 3: Finale Commits**

```bash
git add -A
git commit -m "feat: v5.0 – Code-Auslagerung in 8 ES-Module mit Vite"
```

---

## Hinweise fuer zirkulaere Abhaengigkeiten

Einige Module importieren sich gegenseitig (z.B. `setup.js` importiert `renderArchiveList` aus `archiv.js`, und `archiv.js` importiert `state` aus `main.js`). Das funktioniert mit ES Modules solange:

1. Die Imports auf Top-Level stehen (kein dynamisches `import()`)
2. Die importierten Werte erst zur Laufzeit (in Funktionen) verwendet werden, nicht beim Module-Laden

Falls es dennoch Probleme gibt: die zyklische Abhaengigkeit aufloesen indem die betroffene Funktion in `main.js` bleibt oder ueber Callback-Pattern entkoppelt wird.

## Abhaengigkeiten zwischen Tasks

```
Task 1 (Vite init)
  └── Task 2 (ui.js)
       └── Task 3 (main.js)
            ├── Task 4 (setup.js)
            ├── Task 5 (eingabe.js)
            ├── Task 6 (tabelle.js)
            ├── Task 7 (stats.js)
            ├── Task 8 (archiv.js)
            └── Task 9 (turnier.js)
                 └── Task 10 (main.js finalisieren)
                      └── Task 11 (GitHub Action)
                           └── Task 12 (Aufraeum + Test)
```

Tasks 4-9 koennten theoretisch parallel bearbeitet werden, aber wegen der zirkulaeren Abhaengigkeiten und der schrittweisen window-Registrierungen ist sequentiell sicherer.
