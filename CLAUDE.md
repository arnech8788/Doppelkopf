# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Doppelkopf Punktezettel ist eine PWA (Progressive Web App) zum Erfassen von Punktestaenden beim Doppelkopf-Spieleabend. Sie laeuft komplett im Browser, ohne Build-Prozess und ohne externe Abhaengigkeiten.

## No Build Process

Es gibt keinen Build-Schritt, keinen Package Manager und kein Framework. Aenderungen an `index.html`, `styles.css` oder `sw.js` werden direkt im Browser wirksam - einfach die Seite neu laden. Die App kann direkt mit einem lokalen Webserver oder ueber GitHub Pages geoeffnet werden.

## Deployment

- **Production**: `main`-Branch wird direkt als GitHub Pages ausgespielt (Wurzelverzeichnis).
- **Dev/Vorschau**: Push auf `dev`-Branch loest den GitHub Actions Workflow aus, der den Inhalt in den `/dev/`-Ordner auf `main` kopiert.
- Beim Erhoehen der Versionsnummer muss der `CACHE_NAME` in `sw.js` aktualisiert werden (z.B. `'doko-v4.18'` -> `'doko-v4.19'`). Das erzwingt beim naechsten Seitenaufruf ein Cache-Busting und zeigt den Update-Toast.

## Architecture

Die gesamte App lebt in drei Dateien:

- **`index.html`** - Enthaelt HTML-Struktur, den kompletten JavaScript-Code (inline `<script>`) und bindet `styles.css` ein.
- **`styles.css`** - Externes Stylesheet mit CSS Custom Properties fuer das Theming (Light/Dark Mode).
- **`sw.js`** - Service Worker fuer Offline-Faehigkeit und Cache-Verwaltung.

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
