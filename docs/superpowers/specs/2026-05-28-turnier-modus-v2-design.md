# Turnier-Modus v2 – Design Spec

Ersetzt die urspruengliche Spec (`2026-05-27-turnier-modus-design.md`). Deutlich erweiterter Scope mit globaler Spieler-Datenbank, 4 Spieler-Modi, Rotation und Gesamtwertung.

## Ueberblick

Turnier-Modus fuer die Doppelkopf PWA. Ein Spielleiter erstellt ein Turnier (6-stelliger Code DK-XXXX), konfiguriert Spieler-Modus und Tisch-Modus. Tische/Spieler treten bei und Spielstaende werden automatisch nach jeder Runde an Firebase gesynct. Der Spielleiter sieht ein Live-Dashboard mit allen Tischen. Implementierung in 3 Phasen.

## Turnier-Konfiguration

Beim Erstellen waehlt der Spielleiter in einem schrittweisen Dialog:

### Spieler-Modus (Pflicht)

| Modus | Name | Beschreibung |
|-------|------|-------------|
| 1 | Feste Liste | Spielleiter waehlt alle Spieler aus der globalen DB, Tische waehlen daraus |
| 2 | Liste + Ergaenzung | Wie 1, aber Tische koennen zusaetzlich eigene Spieler hinzufuegen |
| 3 | Freie Eingabe | Jeder Tisch traegt seine Spieler selbst ein (fuer normalen Spielabend) |
| 4 | Spieler-App | Jeder Spieler tritt selbst bei, sieht eigene Ergebnisse live, plus manuelle Ergaenzung |

### Tisch-Modus (Pflicht)

| Modus | Name | Beschreibung |
|-------|------|-------------|
| fixed | Feste Tische | Spieler bleiben den ganzen Abend am gleichen Tisch |
| rotation | Rotation | Spieler wechseln zwischen Tischen |

### Rotations-Steuerung (nur bei Rotation)

| Modus | Beschreibung |
|-------|-------------|
| host | Spielleiter gibt neue Tischaufteilung vor |
| self | Spieler wechseln selbst (z.B. Cocktail Hopping) |

### Rotations-Trigger (nur bei Rotation)

| Trigger | Beschreibung |
|---------|-------------|
| manual | Spielleiter loest Wechsel manuell im Dashboard aus |
| afterRounds | Automatisch nach X Runden – Spielleiter bestaetigt den Wechsel |

### Weitere Optionen

- **Gesamtwertung**: an/aus (Standard: an)
- **Spieler sehen andere Tische**: ja/nein (Standard: nein) – erst ab Phase 2

## Globale Spieler-Datenbank (Firebase)

Persistente, turnieruebergreifende Spielerliste auf Root-Ebene in Firebase:

```
spieler/
  <spieler-id>/
    name: "Arne Chudobba"       // voller Name, muss eindeutig sein
    short: "Arne"               // Anzeigename, automatisch eindeutig gemacht
    deviceIds: ["x8f2a3b1"]     // Array – mehrere Geraete moeglich (Handywechsel)
    createdAt: 1716843600000
```

### Regeln

- `spieler-id` ist ein einmalig generierter 8-stelliger Hex-String
- `name` ist der volle Name (Vorname + ggf. Nachname/Initial), muss eindeutig sein
- `short` wird automatisch generiert: Vorname, bei Kollision Vorname + Initial des Nachnamens
- `deviceIds` ist ein Array – beim Handywechsel wird die neue ID angehaengt
- Bei Namenskollision (z.B. zwei "Lena") fragt die App nach vollem Namen

### Wie fuellt sich die Datenbank?

- **Erster App-Start**: "Wie heisst du?" → Suche in Firebase ob Name existiert → wenn ja, deviceId anhaengen (Handywechsel), wenn nein, neuer Eintrag
- **Spielleiter**: fuegt Spieler manuell hinzu beim Turnier-Erstellen (Modus 1/2)
- **Spieler-App (Modus 4)**: Spieler tritt bei → wird automatisch in globale DB uebernommen
- **Am Tisch (Modus 2)**: Schreiber ergaenzt Spieler → wird in globale DB angelegt

### Geraete-ID

- Wird einmalig generiert und lokal unter `localStorage: doko-v4-deviceId` gespeichert
- Beim Handywechsel: Spieler gibt seinen Namen ein → bestehender Eintrag wird erkannt → neue deviceId wird zum Array hinzugefuegt
- Ein Spieler kann mehrere deviceIds haben, eine deviceId gehoert aber nur einem Spieler

### Lokaler Cache

- Spielerliste wird lokal gecached fuer schnelles Laden und Offline-Faehigkeit
- Cache wird bei Turnier-Operationen aktualisiert

### Verhaeltnis zum normalen Spielabend

- Die bestehende lokale Spielerverwaltung (`state.players`, `state.knownNames`) bleibt unveraendert
- Die Firebase-Spieler-DB ist eine zusaetzliche, turnierspezifische Ressource
- Langfristig koennte die Firebase-DB auch den normalen Modus speisen (nicht im Scope)

## Firebase-Datenstruktur

```
// Global – turnieruebergreifend
spieler/
  <spieler-id>/
    name: "Arne Chudobba"
    short: "Arne"
    deviceIds: ["x8f2a3b1"]
    createdAt: 1716843600000

// Pro Turnier
turniere/
  DK4729/
    created: 1716843600000
    lastActivity: 1716850800000
    status: "active"|"ended"
    config:
      playerMode: 1|2|3|4
      tableMode: "fixed"|"rotation"
      rotationType: "host"|"self"|null
      rotationTrigger: "manual"|"afterRounds"|null
      rotationAfterRounds: 4|null
      scoringEnabled: true
      playersVisible: false

    // Spieler die an diesem Turnier teilnehmen (Referenzen zur globalen DB)
    teilnehmer/
      <spieler-id>: true

    tische/
      <push-id>/
        name: "Tisch 3"
        nummer: 3
        spielerIds: ["a1b2c3","d4e5f6","g7h8i9","j0k1l2"]
        rounds: [{playing, winners, scores, points, solo, soloType, timestamp, bock}]
        lastSync: 1716850800000

    // Phase 3: Rotations-Runden
    rotationen/
      1/
        status: "active"|"ended"
        tischSnapshot: { <tisch-id>: ["a1b2c3","d4e5f6",...] }
      2/
        ...
```

### Wichtige Entscheidungen

- `spieler/` ist global (Root-Level), nicht pro Turnier – Spieler wachsen ueber Turniere hinweg
- `teilnehmer/` im Turnier referenziert nur IDs aus der globalen Liste
- `spielerIds` in `tische/` statt Spielernamen – Spieler bleibt ueber Tischwechsel eindeutig
- `rounds` behalten die bisherige Struktur, aber `playing` und `winners` verwenden Spieler-IDs
- Gesamtwertung wird live im Dashboard berechnet, nicht in Firebase gespeichert
- `rotationen/` speichert Snapshots der Tischbesetzung pro Runde

### Firebase Security Rules

```json
{
  "rules": {
    "spieler": {
      ".read": true,
      ".write": true
    },
    "turniere": {
      "$turnierCode": {
        ".read": true,
        ".write": true
      }
    },
    "$other": {
      ".read": false,
      ".write": false
    }
  }
}
```

Bewusst einfach – der Turnier-Code ist der einzige Zugangsschutz. Keine Authentifizierung.

### Firebase-Projekt Setup (einmalig, manuell)

1. Firebase Console: Neues Projekt erstellen (z.B. "doko-turnier")
2. Realtime Database aktivieren (Region: europe-west1)
3. Security Rules wie oben setzen
4. Web-App registrieren → Config kopieren
5. Config als Konstante in `index.html` einfuegen

Firebase Compat SDK v9+ per CDN laden (kein Build-Prozess):

```html
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js"></script>
```

## Turnier-Code teilen

### QR-Code
- Client-seitig generiert mit kleiner Canvas-basierter QR-Lib (~3KB via CDN)
- Kodiert den Turnier-Link

### Teilbarer Link
- Format: `https://<github-pages-url>/?turnier=DK4729`
- App prueft beim Start `URLSearchParams` und oeffnet automatisch den Beitritts-Dialog

### Share-Button
- Nutzt `navigator.share()` (Web Share API) mit Code + Link
- Fallback: Link in Zwischenablage kopieren

## Tisch-Beitritt

### Option A – QR-Code scannen
- Jeder Tisch hat einen QR-Code der `?turnier=DK4729&tisch=3` kodiert
- Spieler scannt → tritt automatisch dem richtigen Tisch bei

### Option B – Tischnummer eingeben
- Im Beitritts-Dialog: Turnier-Code + Tischnummer manuell eingeben

### Option C – Neuen Tisch erstellen
- Tischname + automatische aufsteigende Nummer

### Tischnummern
- Spielleiter kann beim Erstellen die Anzahl Tische + Nummern vorgeben (z.B. 1-8)
- Oder Tische werden dynamisch erstellt mit aufsteigenden Nummern
- Im Dashboard kann der Spielleiter QR-Codes fuer alle Tische generieren und ausdrucken

## Phasen-Modell

### Phase 1 – Turnier-Basis + Spieler-DB + Sharing

**Spieler-Datenbank (Firebase global):**
- `spieler/`-Node auf Root-Ebene in Firebase
- Einmalige Namenseingabe beim ersten App-Start → Spieler wird in Firebase angelegt, deviceId verknuepft
- Bei bekanntem Namen: "Bist du [Name]?" → deviceId wird angehaengt (Handywechsel)
- Spieler hinzufuegen/suchen im Turnier-Erstell-Flow
- Lokaler Cache der Spielerliste

**Turnier erstellen (Spielleiter):**
- Schrittweiser Dialog:
  1. Spieler-Modus waehlen (1/2/3/4 als Karten mit Beschreibung)
  2. Tisch-Modus waehlen (fest/rotation) + ggf. Rotations-Config
  3. Bei Modus 1/2: Spieler aus Firebase-DB auswaehlen (Chip-Auswahl mit Suchfeld)
  4. Gesamtwertung an/aus
  5. Optional: Anzahl Tische + Nummern vorgeben
  6. Turnier wird erstellt, Code + QR + Share-Button angezeigt

**Turnier-Code teilen:**
- QR-Code, teilbarer Link, Web Share API / Clipboard Fallback
- App prueft URL-Parameter beim Start

**Tisch beitreten:**
- Turnier-Code eingeben (oder via Link/QR)
- Tischnummer waehlen (aus vorgegebenen) oder neuen Tisch erstellen
- Tisch-QR-Codes im Dashboard generierbar
- Bei Modus 1/2: 4 Spieler aus Turnier-Pool waehlen, bereits vergebene ausgegraut
- Bei Modus 3: Spieler frei eingeben
- Modus 4: faellt in Phase 1 auf Modus 2 zurueck mit Hinweis

**Auto-Sync:**
- Nach jeder Rundenaenderung wird `tische/<id>` in Firebase aktualisiert
- `spielerIds` statt Namen in rounds

**Dashboard (Spielleiter):**
- Uebersicht aller Tische mit Live-Updates (Firebase `onValue`-Listener)
- Pro Tisch: Fuehrender, Rundenzahl, letzter Sync
- Detail-Ansicht pro Tisch (Rangliste + letzte Runden)
- Bei Modus 1/2: Anzeige welcher Spieler an welchem Tisch ist
- QR-Code-Generierung pro Tisch

**Turnier-Indikator:**
- Banner im Eingabe-Screen: "DK-4729 · Tisch 3 · Live"

**Turnier beenden (Spielleiter):**
- Setzt `status: "ended"` in Firebase
- Listener werden entfernt
- Dashboard zeigt "Beendet"-Status

**Turnier verlassen (Tisch):**
- Entfernt lokalen `state.turnier`, stoppt Auto-Sync
- Tisch-Daten bleiben in Firebase erhalten

**Nicht in Phase 1:**
- Spieler-App (Modus 4 echte Implementierung)
- Sichtbarkeits-Steuerung
- Rotations-Mechanismus (waehlbar, aber Wechsel erst Phase 3)
- Gesamtwertung-Berechnung

### Phase 2 – Spieler-App + Sichtbarkeit

**Spieler-App (Modus 4):**
- Spieler oeffnet App → "Turnier beitreten" → Code eingeben → wird als Einzelspieler erkannt (nicht als Tisch)
- App zeigt: "Du nimmst als [Name] teil. Warte auf Tischzuweisung." (host-managed) oder "Waehle deinen Tisch" (freier Wechsel)
- Spieler wird in `turniere/DK4729/teilnehmer/` eingetragen
- deviceId wird mit globalem `spieler/`-Eintrag verknuepft

**Eigene Spiele einsehen:**
- Persoenliche Ansicht "Meine Spiele":
  - Aktueller Tisch + Mitspieler
  - Eigene Punkte-Entwicklung (Verlaufsliste)
  - Eigene Gesamtpunktzahl im Turnier
- Daten via Firebase-Listener auf Tische an denen der Spieler sitzt/sass
- App filtert automatisch nach eigener Spieler-ID

**Sichtbarkeit (Spielleiter-Config):**
- `playersVisible: false` (Standard): Spieler sieht nur eigene Spiele + eigenen Tisch
- `playersVisible: true`: Spieler sieht auch andere Tische (Mini-Dashboard)

**Manuelle Ergaenzung:**
- Schreiber am Tisch kann Spieler ohne Handy manuell hinzufuegen
- Werden in globaler `spieler/`-DB angelegt, aber ohne deviceId
- Spielleiter kann nachtraeglich deviceId verknuepfen

**Schreiber-Rolle:**
- Pro Tisch ein Schreiber (wer den Tisch erstellt/beitritt)
- Andere Spieler sehen Ergebnisse live, tragen nicht selbst ein
- "Schreiber abgeben"-Button → anderer Spieler am Tisch uebernimmt

### Phase 3 – Rotation + Gesamtwertung

**Rotation:**
1. Spielleiter drueckt "Neue Runde" (manuell) oder wird benachrichtigt wenn alle Tische X Runden gespielt haben (afterRounds)
2. Aktuelle Runde wird abgeschlossen → Snapshot in `rotationen/` gespeichert
3. Je nach Rotations-Steuerung:
   - **host**: Zuweisungs-Screen – alle Spieler als Chips, Tische als Spalten, antippen zum Zuweisen. Spieler sehen "Wechsel zu Tisch X"
   - **self**: Spieler werden benachrichtigt "Rotation! Waehle deinen neuen Tisch." Spieler waehlen selbst.
4. Wenn alle zugewiesen → neue Runde startet

**Automatischer Trigger (afterRounds):**
- App zaehlt Runden pro Tisch seit letzter Rotation
- Langsamster Tisch erreicht konfigurierte Anzahl → Dashboard: "Alle Tische fertig – Rotation starten?"
- Spielleiter bestaetigt → Ablauf wie oben

**Gesamtwertung:**
- Wird live im Dashboard berechnet (nicht in Firebase gespeichert)
- Berechnung: Fuer jeden Spieler alle Runden aus allen Tischen ueber alle Rotationen summieren
- Anzeige: Reiter "Tische" | "Gesamtwertung"
- Gesamtwertung zeigt: Rang, Name, Gesamtpunkte, Anzahl Runden, Durchschnitt pro Runde
- Optional: Zwischenwertung pro Rotation (aufklappbar)
- Bei Turnier-Ende: Gesamtwertung prominent mit Podium (1./2./3.)

**Rotations-Historie:**
- Im Dashboard einsehbar: "Runde 1: Tisch 1 [Arne, Lisa, Max, Tom], ..."
- Jede Runde zeigt Ergebnisse der damaligen Tischbesetzung

## App-Integration

### Setup-Screen
Neuer Bereich "Turnier" im Setup-Screen (zwischen Spielarchiv und "Neues Spiel starten"-Button). Zeigt je nach Status:
- Kein Turnier: Buttons "Erstellen" und "Beitreten"
- Turnier aktiv: Code, Rolle (Spielleiter/Tisch), Dashboard-Button, Beenden/Verlassen-Button

### Turnier-Status im lokalen State

```js
state.turnier = null; // oder:
state.turnier = {
  code: "4729",
  tischId: "<firebase-push-id>",  // null beim Spielleiter
  tischName: "Tisch 3",           // null beim Spielleiter
  tischNummer: 3,                  // null beim Spielleiter
  isHost: false,
  isPlayer: false                  // true bei Modus 4 Einzelspieler
}
```

### Service Worker
- Firebase-CDN-URLs und Firebase-DB-Requests vom Cache ausschliessen
- CACHE_NAME Update bei jeder Phase

## Nicht im Scope (alle Phasen)

- Authentifizierung/Login
- Automatische Datenloesung (Cloud Function fuer 30-Tage-TTL)
- Offline-Queuing (Firebase SDK hat eingebaute Offline-Persistenz)
- Push-Benachrichtigungen
- Chat/Nachrichten zwischen Tischen
- Migration der bestehenden lokalen Spielerverwaltung auf Firebase
