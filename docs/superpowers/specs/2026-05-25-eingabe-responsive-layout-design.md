# Eingabe-Screen: Responsive Layout

**Datum:** 25.05.2026
**Version:** v4.22

## Problem

Auf kleinen Handys (iPhone SE, ~667px Höhe) muss der Nutzer beim Eingabe-Screen scrollen, um "Spiel speichern" zu erreichen. Auf großen Handys (Pro Max, ~932px) bleibt viel Platz ungenutzt — der Numpad wirkt klein und verloren.

## Ziel

- Auf **allen** Handygrößen: kein Scrollen nötig bei 4 Spielern
- Auf **großen** Screens: Numpad füllt den verfügbaren Platz (größere Tippflächen)
- Auf **sehr kleinen** Screens (≤ 680px): Kompakt-Modus via `@media`

## Lösung: Flexbox-Kette + media query

### 1. CSS — Flex-Kette (Screen → Content → Card → Numpad)

```css
#screen-eingabe {
  display: flex;
  flex-direction: column;
}
#eingabeContent {
  flex: 1;
  display: flex;
  flex-direction: column;
}
#eingabeContent .card {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.numpad {
  flex: 1;
  grid-template-rows: repeat(5, 1fr);
  min-height: 180px;
}
```

Der `#bockIndicator` (optional, über der Card) nimmt seinen natürlichen Platz — die Card füllt den Rest.

### 2. CSS — Pts-Display global kleiner

```css
.pts-display {
  height: 48px;  /* war: 64px */
}
```

### 3. HTML — Buttons nebeneinander (in `renderEingabe`)

Wenn `lastUndo` vorhanden:
```html
<div style="display:flex;gap:8px;margin-top:4px">
  <button class="btn btn-primary" style="flex:1.5;padding:10px 16px;font-size:14px">✓ Spiel speichern</button>
  <button class="btn btn-secondary" style="flex:1;padding:10px 12px;font-size:12px;opacity:.7">↩ Rückgängig</button>
</div>
```

Wenn kein `lastUndo`: Speichern-Button zentriert wie bisher (unverändert).

### 4. CSS — Kompakt-Modus für kleine Screens

```css
@media (max-height: 680px) {
  .section-label { margin: 8px 0 4px; }
  .player-chip   { padding: 8px 14px; }
  .chip-grid     { gap: 6px; margin-bottom: 10px; }
  .numpad        { gap: 4px; }
}
```

## Betroffene Dateien

| Datei | Änderung |
|---|---|
| `styles.css` | Flex-Kette, pts-display Höhe, @media Kompakt-Modus |
| `index.html` | `renderEingabe`: Buttons nebeneinander, Version + Changelog, CACHE_NAME |

## Nicht geändert

- Numpad-Button-Größe (`padding: 14px`, `font-size: 20px`) bleibt — sie skalieren mit der Grid-Höhe
- Chip-Größe auf großen Screens bleibt unverändert
- Screens mit mehr als 4 Spielern: dürfen scrollen (explizit akzeptiert)
