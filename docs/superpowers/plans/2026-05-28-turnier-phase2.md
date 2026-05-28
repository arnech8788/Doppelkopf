# Turnier-Modus Phase 2 – Spieler-App + Sichtbarkeit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spieler können einem Turnier als Einzelspieler beitreten (Modus 4), eigene Spiele einsehen, und der Spielleiter steuert die Sichtbarkeit anderer Tische.

**Architecture:** Erweiterung des bestehenden Turnier-Joins um einen Spieler-Modus (`isPlayer: true`). Neue "Meine Spiele"-Ansicht mit Firebase-Listener. Schreiber-Rolle pro Tisch schränkt ein, wer Runden eintragen darf. Sichtbarkeits-Toggle steuert, ob Spieler andere Tische sehen.

**Tech Stack:** Vanilla JS (inline in `index.html`), Firebase Realtime Database (Compat SDK via CDN), CSS in `styles.css`

**Wichtig:** Dieses Projekt ist eine PWA ohne Build-Prozess und ohne Test-Framework. Alle Dateien werden direkt bearbeitet. "Testen" bedeutet: App im Browser öffnen und manuell prüfen. Alle UI-Texte in korrektem Deutsch mit Umlauten (ä, ö, ü, ß).

---

## Datei-Übersicht

| Datei | Änderungen |
|-------|-----------|
| `index.html` | Alle JS-Logik und HTML-Strukturen (inline `<script>`) |
| `styles.css` | Neue Styles für Spieler-Ansicht |
| `sw.js` | CACHE_NAME hochsetzen |

## Firebase-Erweiterungen

```
turniere/DK{code}/
  config/
    playersVisible: false     // NEU: Sichtbarkeit anderer Tische
  tische/{tischId}/
    schreiberId: "<spieler-id>"  // NEU: Wer darf Runden eintragen
```

---

### Task 1: Sichtbarkeits-Config im Wizard

**Files:**
- Modify: `index.html` (Wizard Step 4, turnierWizard config)

Fügt die Option `playersVisible` zum Turnier-Wizard hinzu. Der Spielleiter kann einstellen, ob Spieler andere Tische sehen dürfen.

- [ ] **Step 1: Config-Default erweitern**

In der `turnierWizard`-Initialisierung (ca. Zeile 847) `playersVisible:false` zum config-Objekt hinzufügen:

```javascript
let turnierWizard={
  step:1,
  config:{
    playerMode:3,
    tableMode:'fixed',
    rotationType:null,
    rotationTrigger:null,
    rotationAfterRounds:4,
    scoringEnabled:true,
    playersVisible:false    // NEU
  },
  selectedPlayers:[]
};
```

- [ ] **Step 2: Toggle in Wizard Step 4 einbauen**

In `renderWizardStep4()` (ca. Zeile 973) nach dem bestehenden "Gesamtwertung"-Toggle einen zweiten Toggle einfügen:

```javascript
// Nach dem Gesamtwertung-Toggle einfügen:
html+='<div class="toggle-row" style="padding:8px 0"><span class="toggle-label">Spieler sehen andere Tische</span>'
  +'<button class="toggle'+(c.playersVisible?' on':'')+'" onclick="turnierWizard.config.playersVisible=!turnierWizard.config.playersVisible;this.classList.toggle(\'on\');renderWizardStep()"></button></div>';
```

Außerdem in der Zusammenfassung (gleiche Funktion, im `.card`-Block) eine Zeile hinzufügen:

```javascript
// Nach der Gesamtwertung-Zeile:
html+='<div style="padding:6px 0"><span style="color:var(--tx3)">Sichtbarkeit:</span> '+(c.playersVisible?'Alle Tische':'Nur eigener Tisch')+'</div>';
```

- [ ] **Step 3: Testen**

App öffnen → Turnier erstellen → Wizard durchklicken → Step 4 zeigt den neuen Toggle "Spieler sehen andere Tische" (Standard: aus). Umschalten aktualisiert die Zusammenfassung.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(turnier): add playersVisible config toggle to wizard"
```

---

### Task 2: Schreiber-Rolle – Firebase-Feld beim Tisch-Erstellen

**Files:**
- Modify: `index.html` (joinTurnier, syncToFirebase)

Beim Erstellen eines neuen Tisches wird die `schreiberId` des aktuellen Geräts gespeichert. Nur der Schreiber synct Runden.

- [ ] **Step 1: schreiberId beim Tisch-Erstellen setzen**

In `joinTurnier()` (ca. Zeile 1332), beim `tischRef.set()`-Aufruf für den neuen Tisch, `schreiberId` hinzufügen. Dafür die deviceId des aktuellen Users nutzen, um den passenden Spieler aus dem spielerCache zu finden:

```javascript
// Vor dem tischRef.set()-Aufruf:
const deviceId=getDeviceId();
const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
const schreiberId=ownSpieler?ownSpieler.id:(spielerIds[0]||'');

// Im tischRef.set()-Objekt ergänzen:
await tischRef.set({
  name:tischName,
  nummer:tischNummer,
  spielerIds:spielerIds,
  schreiberId:schreiberId,    // NEU
  rounds:rounds.length?rounds:[],
  lastSync:firebase.database.ServerValue.TIMESTAMP
});
```

- [ ] **Step 2: schreiberId im lokalen State speichern**

In `state.turnier` beim Beitreten als Tisch-Ersteller zusätzlich speichern:

```javascript
state.turnier={
  code:code,
  tischId:tischId,
  tischName:tischName,
  tischNummer:tischNummer,
  isHost:false,
  isPlayer:false,
  schreiberId:schreiberId    // NEU
};
```

Auch beim Beitreten eines bestehenden Tisches (Zeile 1288, der `joinSelectedTischId`-Pfad):

```javascript
state.turnier={
  code:code,
  tischId:joinSelectedTischId,
  tischName:tisch.name||('Tisch '+tisch.nummer),
  tischNummer:tisch.nummer,
  isHost:false,
  isPlayer:false,
  schreiberId:tisch.schreiberId||null    // NEU
};
```

- [ ] **Step 3: syncToFirebase nur für Schreiber erlauben**

In `syncToFirebase()` (ca. Zeile 1353) die Prüfung erweitern:

```javascript
function syncToFirebase(){
  if(!state.turnier||state.turnier.isHost||!state.turnier.tischId)return;
  // Nur Schreiber darf syncen
  const deviceId=getDeviceId();
  const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
  if(state.turnier.schreiberId&&ownSpieler&&ownSpieler.id!==state.turnier.schreiberId)return;
  if(!initFirebase())return;
  // ... rest bleibt gleich
}
```

- [ ] **Step 4: Testen**

Turnier erstellen → Tisch beitreten → In Firebase prüfen: `tische/{id}/schreiberId` enthält die Spieler-ID des Beitretenden.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(turnier): track schreiberId per table, restrict sync to writer"
```

---

### Task 3: Schreiber-Anzeige und Abgabe

**Files:**
- Modify: `index.html` (renderTurnierIndicator, neues Turnier-Panel in Eingabe)

Der Turnier-Indikator zeigt an, ob man Schreiber ist. Ein Button erlaubt, die Rolle an einen Mitspieler abzugeben.

- [ ] **Step 1: Indikator erweitern**

`renderTurnierIndicator()` (ca. Zeile 812) erweitern um Schreiber-Status und Abgabe-Link:

```javascript
function renderTurnierIndicator(){
  const el=document.getElementById('turnierIndicator');
  if(!el)return;
  if(!state.turnier||state.turnier.isHost){el.innerHTML='';el.style.display='none';return}
  el.style.display='block';
  const deviceId=getDeviceId();
  const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
  const isSchreiber=!state.turnier.schreiberId||!ownSpieler||(ownSpieler.id===state.turnier.schreiberId);
  let html='<div class="turnier-banner">DK-'+state.turnier.code+' · '+state.turnier.tischName;
  if(isSchreiber){
    html+=' · <span style="color:var(--grn)">Schreiber</span>';
    html+=' <a href="#" onclick="transferSchreiber();return false" style="font-size:11px;color:var(--tx3);margin-left:4px">abgeben</a>';
  }else{
    html+=' · <span style="color:var(--tx3)">Zuschauer</span>';
  }
  html+='</div>';
  el.innerHTML=html;
}
```

- [ ] **Step 2: transferSchreiber-Funktion implementieren**

Neue Funktion nach `renderTurnierIndicator()`:

```javascript
async function transferSchreiber(){
  if(!state.turnier||!state.turnier.tischId)return;
  if(!initFirebase())return;
  const snap=await firebase.database().ref('turniere/DK'+state.turnier.code+'/tische/'+state.turnier.tischId).get();
  const tisch=snap.val();
  if(!tisch)return;
  const spielerIds=tisch.spielerIds||[];
  const deviceId=getDeviceId();
  const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
  const others=spielerIds.filter(id=>!ownSpieler||id!==ownSpieler.id);
  if(!others.length){showToast('Keine anderen Spieler am Tisch.','error');return}
  const names=others.map(id=>{const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id});
  const choice=prompt('Schreiber abgeben an:\n'+others.map((id,i)=>(i+1)+'. '+names[i]).join('\n')+'\n\nNummer eingeben:');
  if(!choice)return;
  const idx=parseInt(choice)-1;
  if(idx<0||idx>=others.length){showToast('Ungültige Auswahl.','error');return}
  const newSchreiber=others[idx];
  await firebase.database().ref('turniere/DK'+state.turnier.code+'/tische/'+state.turnier.tischId+'/schreiberId').set(newSchreiber);
  state.turnier.schreiberId=newSchreiber;
  save();
  renderTurnierIndicator();
  const s=spielerCache.find(s=>s.id===newSchreiber);
  showToast('Schreiber ist jetzt '+(s?s.short||s.name:'Spieler')+'.','info');
}
```

- [ ] **Step 3: Eingabe-Buttons für Nicht-Schreiber sperren**

In `renderEingabe()` (die Funktion die den Eingabe-Screen rendert), vor den Bestätigungs-Buttons prüfen, ob der User der Schreiber ist. Wenn nicht, einen Hinweis anzeigen statt der Buttons. Suche nach der Stelle wo die Punkte-Eingabe und der "Eintragen"-Button gerendert werden und wrape sie:

Am Anfang von `renderEingabe()` eine Helper-Variable setzen:

```javascript
const turnierReadOnly=state.turnier&&!state.turnier.isHost&&state.turnier.schreiberId&&(()=>{
  const deviceId=getDeviceId();
  const own=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
  return own&&own.id!==state.turnier.schreiberId;
})();
```

Dann am Ende, wo der "Eintragen"-Button steht, wenn `turnierReadOnly` true ist, stattdessen anzeigen:

```javascript
if(turnierReadOnly){
  html+='<div style="text-align:center;color:var(--tx3);font-size:13px;padding:16px">Du bist Zuschauer an diesem Tisch. Nur der Schreiber kann Runden eintragen.</div>';
}else{
  // ... bestehender Eintragen-Button ...
}
```

- [ ] **Step 4: Testen**

Tisch beitreten → Indikator zeigt "Schreiber" → "abgeben" klicken → Mitspieler auswählen → Indikator zeigt "Zuschauer" → Eintragen-Button ist gesperrt.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(turnier): writer role indicator with transfer and read-only mode"
```

---

### Task 4: Spieler-App Join Flow (Modus 4)

**Files:**
- Modify: `index.html` (openJoinTurnier, loadJoinTurnierInfo, joinTurnier)

Wenn ein Turnier Modus 4 hat, können Spieler als Einzelspieler beitreten (nicht als Tisch). Sie werden in `teilnehmer/` eingetragen und warten auf Tischzuweisung oder wählen selbst einen Tisch.

- [ ] **Step 1: Spieler-App-Erkennung im Join-Flow**

In `loadJoinTurnierInfo()` (ca. Zeile 1130), nach dem Check auf `data.status`, den Modus 4 erkennen und eine andere UI zeigen. Nach der Zeile `joinTurnierConfig=data.config;`:

```javascript
// Modus 4: Spieler-App – individueller Beitritt
if(data.config.playerMode===4){
  const deviceId=getDeviceId();
  const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
  if(!ownSpieler){
    html+='<div style="font-size:12px;color:var(--red)">Bitte zuerst deinen Namen registrieren (App neu laden).</div>';
    el.innerHTML=html;return;
  }
  // Prüfe ob schon als Teilnehmer registriert
  const teilnehmerIds=data.teilnehmer?Object.keys(data.teilnehmer):[];
  const alreadyJoined=teilnehmerIds.includes(ownSpieler.id);

  html+='<div class="card" style="text-align:center;padding:16px">'
    +'<div style="font-size:14px;font-weight:600;margin-bottom:8px">Hallo, '+(ownSpieler.short||ownSpieler.name)+'!</div>';

  if(alreadyJoined){
    html+='<div style="font-size:13px;color:var(--grn);margin-bottom:12px">Du nimmst bereits teil.</div>';
  }else{
    html+='<div style="font-size:13px;color:var(--tx2);margin-bottom:12px">Tritt als Spieler bei.</div>';
  }

  // Tische anzeigen zum Auswählen
  const tischArr=Object.entries(tischeObj).map(([id,t])=>({id,...t}));
  tischArr.sort((a,b)=>(a.nummer||99)-(b.nummer||99));
  if(tischArr.length){
    html+='<div style="text-align:left;margin-top:12px"><div class="section-label">Tisch wählen</div>';
    tischArr.forEach(t=>{
      const spielerNames=(t.spielerIds||[]).map(id=>{const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id}).join(', ');
      const rounds=t.rounds?t.rounds.length:0;
      const isMember=(t.spielerIds||[]).includes(ownSpieler.id);
      html+='<div class="card turnier-tisch-card" style="cursor:pointer;padding:10px;margin-bottom:6px;border:2px solid '+(isMember?'var(--grn)':'var(--bdr)')+'" onclick="joinAsPlayer(\''+code+'\',\''+t.id+'\',\''+ownSpieler.id+'\')">'
        +'<div style="display:flex;justify-content:space-between;align-items:center">'
        +'<div style="font-weight:600;font-size:14px">Tisch '+t.nummer+(t.name&&t.name!=='Tisch '+t.nummer?' – '+t.name:'')+'</div>'
        +'<div style="font-size:11px;color:var(--tx3)">'+rounds+' Runden</div></div>'
        +'<div style="font-size:12px;color:var(--tx2);margin-top:2px">'+(spielerNames||'Keine Spieler')
        +(isMember?' <span style="color:var(--grn)">(du)</span>':'')+'</div>'
        +'</div>';
    });
    html+='</div>';
  }else{
    html+='<div style="font-size:13px;color:var(--tx3);margin-top:8px">Noch keine Tische vorhanden. Warte auf den Spielleiter.</div>';
  }
  html+='</div>';

  if(!alreadyJoined){
    html+='<button class="btn btn-primary" style="width:100%;margin-top:12px" onclick="registerAsPlayer(\''+code+'\',\''+ownSpieler.id+'\')">Als Spieler beitreten</button>';
  }

  el.innerHTML=html;
  return;  // Modus-4-UI fertig, normalen Flow abbrechen
}
```

- [ ] **Step 2: registerAsPlayer-Funktion**

Neue Funktion zum Registrieren als Einzelspieler:

```javascript
async function registerAsPlayer(code,spielerId){
  if(!initFirebase())return;
  try{
    await firebase.database().ref('turniere/DK'+code+'/teilnehmer/'+spielerId).set(true);
    state.turnier={code:code,tischId:null,tischName:null,tischNummer:null,isHost:false,isPlayer:true,schreiberId:null};
    save();
    closeJoinTurnier();
    renderTurnierSetup();
    showToast('Du nimmst am Turnier DK-'+code+' teil!','info');
  }catch(e){
    showToast('Fehler: '+e.message,'error');
  }
}
```

- [ ] **Step 3: joinAsPlayer-Funktion – Einzelspieler wählt Tisch**

```javascript
async function joinAsPlayer(code,tischId,spielerId){
  if(!initFirebase())return;
  try{
    const tischRef=firebase.database().ref('turniere/DK'+code+'/tische/'+tischId);
    const snap=await tischRef.get();
    const tisch=snap.val();
    if(!tisch){showToast('Tisch nicht gefunden.','error');return}
    const spielerIds=tisch.spielerIds||[];
    if(spielerIds.includes(spielerId)){
      // Schon am Tisch – einfach verknüpfen
      state.turnier={code:code,tischId:tischId,tischName:tisch.name||('Tisch '+tisch.nummer),tischNummer:tisch.nummer,isHost:false,isPlayer:true,schreiberId:tisch.schreiberId||null};
      save();
      closeJoinTurnier();
      renderTurnierSetup();
      showToast('Mit Tisch '+(tisch.nummer||'')+' verbunden!','info');
      return;
    }
    if(spielerIds.length>=4){
      showToast('Tisch ist voll (4 Spieler).','error');return;
    }
    spielerIds.push(spielerId);
    await tischRef.child('spielerIds').set(spielerIds);
    await firebase.database().ref('turniere/DK'+code+'/teilnehmer/'+spielerId).set(true);
    state.turnier={code:code,tischId:tischId,tischName:tisch.name||('Tisch '+tisch.nummer),tischNummer:tisch.nummer,isHost:false,isPlayer:true,schreiberId:tisch.schreiberId||null};
    save();
    closeJoinTurnier();
    renderTurnierSetup();
    showToast('Tisch '+(tisch.nummer||'')+' beigetreten!','info');
  }catch(e){
    showToast('Fehler: '+e.message,'error');
  }
}
```

- [ ] **Step 4: renderTurnierSetup für Spieler-Modus anpassen**

In `renderTurnierSetup()` (ca. Zeile 822) den Fall `isPlayer: true` berücksichtigen:

```javascript
// Im else-Block (Turnier aktiv), nach dem isHost-Check:
if(t.isPlayer){
  if(t.tischId){
    html+='<div style="margin-bottom:2px">Spieler an '+t.tischName+'</div>';
  }else{
    html+='<div style="margin-bottom:2px">Spieler (kein Tisch zugewiesen)</div>';
  }
}else if(!t.isHost){
  html+='<div style="margin-bottom:2px">'+t.tischName+' (Tisch '+t.tischNummer+')</div>';
}
```

Außerdem einen "Meine Spiele"-Button hinzufügen wenn `isPlayer`:

```javascript
if(t.isPlayer){
  html+='<button class="btn btn-primary" style="flex:1" onclick="openMeineSpiele()">Meine Spiele</button>';
}
html+='<button class="btn btn-'+(t.isPlayer?'secondary':'primary')+'" style="flex:1" onclick="openTurnierDashboard()">Dashboard</button>';
```

- [ ] **Step 5: Testen**

Turnier mit Modus 4 erstellen → Mit anderem Tab beitreten → Spieler-UI erscheint → "Als Spieler beitreten" → Tisch wählen → Setup zeigt "Spieler an Tisch X".

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(turnier): player-app join flow (mode 4) with table selection"
```

---

### Task 5: "Meine Spiele"-Ansicht

**Files:**
- Modify: `index.html` (neue Funktion openMeineSpiele)

Einzelspieler können ihre eigenen Ergebnisse über alle Tische hinweg sehen.

- [ ] **Step 1: openMeineSpiele implementieren**

Neue Funktion die das turnierModal nutzt:

```javascript
async function openMeineSpiele(){
  if(!state.turnier)return;
  if(!initFirebase())return;
  const deviceId=getDeviceId();
  const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
  if(!ownSpieler){showToast('Spieler nicht gefunden.','error');return}
  const myId=ownSpieler.id;

  document.getElementById('turnierModal').classList.add('show');
  const el=document.getElementById('turnierModalContent');
  el.innerHTML='<div style="text-align:center;padding:32px;color:var(--tx3)">Lade...</div>';

  try{
    const snap=await firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').get();
    const tische=snap.val()||{};
    const tischArr=Object.entries(tische).map(([id,t])=>({id,...t}));

    let totalPts=0;
    let totalRounds=0;
    let myRounds=[];

    tischArr.forEach(t=>{
      const rounds=t.rounds||[];
      const spielerIds=t.spielerIds||[];
      if(!spielerIds.includes(myId))return;
      rounds.forEach((r,i)=>{
        if(!r.playing||!r.playing.includes(myId))return;
        const pts=(r.scores&&r.scores[myId])||0;
        totalPts+=pts;
        totalRounds++;
        myRounds.push({tisch:t.name||'Tisch '+(t.nummer||'?'),nr:i+1,pts:pts,won:(r.winners||[]).includes(myId),timestamp:r.timestamp});
      });
    });

    function nameOf(id){const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id}

    let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
      +'<button onclick="closeTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;gap:4px;padding:0 10px;font-size:13px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
      +'<h3 style="margin:0">Meine Spiele</h3><div style="width:32px"></div></div>';

    // Zusammenfassung
    const col=totalPts>0?'var(--grn)':totalPts<0?'var(--red)':'var(--tx2)';
    html+='<div class="card" style="text-align:center;padding:16px;margin:12px 0">'
      +'<div style="font-size:13px;color:var(--tx3)">'+nameOf(myId)+'</div>'
      +'<div style="font-size:32px;font-weight:700;color:'+col+';margin:4px 0">'+totalPts+'</div>'
      +'<div style="font-size:12px;color:var(--tx3)">'+totalRounds+' Runden gespielt</div></div>';

    // Aktueller Tisch
    if(state.turnier.tischId){
      const myTisch=tischArr.find(t=>t.id===state.turnier.tischId);
      if(myTisch){
        const myTischPlayers=(myTisch.spielerIds||[]).map(id=>nameOf(id)).join(', ');
        html+='<div class="section-label">Aktueller Tisch</div>';
        html+='<div class="card" style="padding:12px;margin-bottom:12px"><div style="font-weight:600">'+(myTisch.name||'Tisch '+myTisch.nummer)+'</div>'
          +'<div style="font-size:12px;color:var(--tx2);margin-top:2px">'+myTischPlayers+'</div></div>';
      }
    }

    // Runden-Verlauf
    if(myRounds.length){
      html+='<div class="section-label">Runden-Verlauf</div><div class="card" style="max-height:300px;overflow-y:auto">';
      myRounds.reverse().forEach((r,i)=>{
        const ptCol=r.pts>0?'var(--grn)':r.pts<0?'var(--red)':'var(--tx2)';
        html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px'+(i<myRounds.length-1?';border-bottom:1px solid var(--bdr)':'')+'">'
          +'<span style="color:var(--tx3);font-size:11px;width:60px">'+r.tisch+'</span>'
          +'<span style="flex:1;color:var(--tx2)">#'+r.nr+(r.won?' ✓':'')+'</span>'
          +'<span style="font-weight:500;color:'+ptCol+'">'+r.pts+'</span></div>';
      });
      html+='</div>';
    }else{
      html+='<div class="card" style="text-align:center;color:var(--tx3);padding:24px">Noch keine Runden gespielt.</div>';
    }

    el.innerHTML=html;
  }catch(e){
    console.error('openMeineSpiele error:',e);
    showToast('Fehler beim Laden.','error');
  }
}
```

- [ ] **Step 2: Live-Listener für Meine Spiele**

Optional: Einen `onValue`-Listener einrichten, damit die Ansicht live aktualisiert wird. Dafür den bestehenden `turnierListener`-Mechanismus wiederverwenden – `openMeineSpiele` ruft am Ende den Listener auf:

```javascript
// Am Ende von openMeineSpiele, nach el.innerHTML=html:
if(turnierListener){
  firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').off('value',turnierListener);
}
turnierListener=firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').on('value',snap=>{
  // Nur aktualisieren wenn Modal noch offen und im "Meine Spiele"-Modus
  if(document.getElementById('turnierModal').classList.contains('show')
    &&document.querySelector('#turnierModalContent h3')
    &&document.querySelector('#turnierModalContent h3').textContent==='Meine Spiele'){
    openMeineSpiele();  // Re-render
  }
});
```

Hinweis: `openMeineSpiele` muss beim Setzen des Listeners verhindern, dass er sich rekursiv selbst triggert. Dafür ein Guard einbauen:

```javascript
// Am Anfang der Funktion:
let _meineSpieleUpdating=false;
// wird zur globalen Variable
```

Oder einfacher: den Listener nur einmal setzen und beim Schließen des Modals entfernen (das passiert bereits in `closeTurnierDashboard`).

- [ ] **Step 3: Testen**

Als Spieler (Modus 4) beitreten → "Meine Spiele" öffnen → Zeigt Gesamtpunkte, aktuellen Tisch, Rundenhistorie. Wenn Schreiber eine Runde einträgt, aktualisiert sich die Ansicht.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(turnier): add 'Meine Spiele' view for individual players"
```

---

### Task 6: Sichtbarkeits-Logik im Dashboard

**Files:**
- Modify: `index.html` (renderTurnierDashboard, openTurnierDashboard)

Wenn `playersVisible: false`, sehen Nicht-Host-Spieler nur ihren eigenen Tisch im Dashboard. Bei `true` sehen sie alle.

- [ ] **Step 1: Config beim Dashboard-Öffnen laden**

In `openTurnierDashboard()` die Turnier-Config aus Firebase laden und an `renderTurnierDashboard` weitergeben:

```javascript
async function openTurnierDashboard(){
  if(!state.turnier)return;
  if(!initFirebase()){showToast('Firebase nicht verfügbar.','error');return}
  document.getElementById('turnierModal').classList.add('show');
  renderTurnierDashboard({});

  // Config laden für Sichtbarkeit
  let turnierConfig=null;
  try{
    const configSnap=await firebase.database().ref('turniere/DK'+state.turnier.code+'/config').get();
    turnierConfig=configSnap.val();
  }catch(e){}

  if(turnierListener){
    firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').off('value',turnierListener);
  }
  turnierListener=firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').on('value',snap=>{
    renderTurnierDashboard(snap.val()||{},turnierConfig);
  });
}
```

- [ ] **Step 2: Dashboard filtern**

In `renderTurnierDashboard(tische, config)` den zweiten Parameter nutzen:

```javascript
function renderTurnierDashboard(tische,config){
  const el=document.getElementById('turnierModalContent');
  if(!state.turnier)return;
  const code=state.turnier.code;
  let tischArr=Object.entries(tische).map(([id,t])=>({id,...t}));

  // Sichtbarkeit: Nicht-Host mit playersVisible=false sieht nur eigenen Tisch
  const isHost=state.turnier.isHost;
  const canSeeAll=isHost||(config&&config.playersVisible);
  if(!canSeeAll&&state.turnier.tischId){
    const myTischId=state.turnier.tischId;
    tischArr=tischArr.filter(t=>t.id===myTischId);
  }

  // ... rest der Funktion bleibt gleich, nutzt das gefilterte tischArr
```

Den Sichtbarkeits-Status auch in der Info-Zeile anzeigen:

```javascript
html+='<div style="font-size:13px;color:var(--tx2);margin:12px 0">';
if(!canSeeAll&&!isHost){
  html+='Dein Tisch';
}else{
  html+=tischArr.length+' Tisch'+(tischArr.length!==1?'e':'')+' · '+totalRounds+' Spiele gesamt';
}
html+='</div>';
```

- [ ] **Step 3: Testen**

Turnier erstellen mit `playersVisible: false` → Als Tisch beitreten → Dashboard öffnen → Sieht nur eigenen Tisch. Turnier mit `playersVisible: true` → Dashboard zeigt alle Tische.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(turnier): restrict dashboard visibility based on playersVisible config"
```

---

### Task 7: Manuelle Spieler-Ergänzung ohne Gerät

**Files:**
- Modify: `index.html` (addJoinPlayer)

Schreiber am Tisch kann Spieler hinzufügen, die kein eigenes Gerät haben. Diese werden in der globalen `spieler/`-DB angelegt, aber ohne `deviceIds`.

- [ ] **Step 1: createSpieler anpassen**

Die bestehende `createSpieler(name)`-Funktion (ca. Zeile 231) erstellt Spieler bereits mit `deviceIds: [getDeviceId()]`. Für manuelle Spieler ohne Gerät eine optionale Flag hinzufügen:

```javascript
async function createSpieler(name, skipDevice){
  if(!initFirebase())return null;
  const id=crypto.randomUUID?crypto.randomUUID().replace(/-/g,'').slice(0,8):Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const existingNames=spielerCache.map(s=>s.name);
  const existingShorts=spielerCache.map(s=>s.short);
  if(existingNames.includes(name)){showToast('Name "'+name+'" existiert bereits.','error');return null}
  const short=generateSpielerShort(name,existingShorts);
  const data={name:name,short:short,createdAt:firebase.database.ServerValue.TIMESTAMP};
  if(!skipDevice)data.deviceIds=[getDeviceId()];
  await firebase.database().ref('spieler/'+id).set(data);
  const spieler={id:id,...data};
  if(!skipDevice)spieler.deviceIds=[getDeviceId()];
  spielerCache.push(spieler);
  return spieler;
}
```

- [ ] **Step 2: "Ohne Gerät hinzufügen"-Button**

In `renderJoinPlayerSelect()` und bei der Wizard-Spielerauswahl einen zusätzlichen Button anbieten:

In `renderJoinPlayerSelect()` (ca. Zeile 1213), nach dem bestehenden "+ Eigenen Spieler"-Button:

```javascript
if(data.config.playerMode===2||data.config.playerMode===4){
  html+='<button class="btn btn-secondary" style="margin-top:8px;font-size:12px;padding:6px 12px" onclick="addJoinPlayer()">+ Spieler hinzufügen</button>';
  html+=' <button class="btn btn-secondary" style="margin-top:8px;font-size:12px;padding:6px 12px" onclick="addJoinPlayerNoDevice()">+ Spieler ohne Gerät</button>';
}
```

- [ ] **Step 3: addJoinPlayerNoDevice implementieren**

```javascript
async function addJoinPlayerNoDevice(){
  const name=prompt('Spieler ohne eigenes Gerät hinzufügen (Vor- und Nachname):');
  if(!name||name.trim().length<2)return;
  const s=await createSpieler(name.trim(),true);
  if(!s)return;
  const code=document.getElementById('joinCodeInput').value.trim();
  await firebase.database().ref('turniere/DK'+code+'/teilnehmer/'+s.id).set(true);
  loadJoinTurnierInfo(code,null);
}
```

- [ ] **Step 4: Auch im Wizard anbieten**

In `renderWizardStep3()` (ca. Zeile 920), beim "Spieler hinzufügen"-Button, auch einen Button für "ohne Gerät" hinzufügen:

```javascript
// Bestehenden Button-Bereich erweitern:
html+='<div style="display:flex;gap:8px;margin-top:8px">'
  +'<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:6px 12px" onclick="openWizardAddPlayer()">+ Spieler</button>'
  +'<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:6px 12px" onclick="openWizardAddPlayerNoDevice()">+ Ohne Gerät</button></div>';
```

Und die Funktion:

```javascript
async function openWizardAddPlayerNoDevice(){
  const name=prompt('Spieler ohne Gerät hinzufügen (Vor- und Nachname):');
  if(!name||name.trim().length<2)return;
  const s=await createSpieler(name.trim(),true);
  if(!s)return;
  turnierWizard.selectedPlayers.push(s);
  renderWizardPlayerList();
}
```

- [ ] **Step 5: Testen**

Wizard Step 3 → "Ohne Gerät" → Name eingeben → Spieler erscheint in der Liste. In Firebase: `spieler/{id}` hat kein `deviceIds`-Feld.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(turnier): add players without device to global player DB"
```

---

### Task 8: CSS-Styles für neue Elemente

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Styles hinzufügen**

Am Ende von `styles.css`:

```css
.meine-spiele-pts{font-size:32px;font-weight:700;margin:4px 0}
.schreiber-badge{display:inline-block;font-size:10px;padding:2px 6px;border-radius:10px;background:var(--grn);color:#fff;font-weight:600;margin-left:4px}
.zuschauer-badge{display:inline-block;font-size:10px;padding:2px 6px;border-radius:10px;background:var(--bg3);color:var(--tx3);font-weight:600;margin-left:4px}
```

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "feat(turnier): add CSS for player view and writer badges"
```

---

### Task 9: Version Bump + Changelog

**Files:**
- Modify: `index.html` (Versionslabel, Changelog)
- Modify: `sw.js` (CACHE_NAME)

- [ ] **Step 1: Aktuelle Uhrzeit ermitteln**

```bash
date +"%d.%m.%Y %H:%M"
```

- [ ] **Step 2: Versionsnummer in index.html aktualisieren**

Suche nach `v4.38` im `versionLabel`-div (ca. Zeile 71) und ersetze durch `v4.39 · {datum}`.

- [ ] **Step 3: Changelog-Eintrag hinzufügen**

Im `log`-Array (nach `const log=[`) einen neuen Eintrag als erstes Element:

```javascript
{v:'4.39',d:'{datum}',t:'Turnier Phase 2: Spieler-App (Modus 4) – Einzelspieler treten bei und wählen ihren Tisch. "Meine Spiele"-Ansicht zeigt eigene Punkte und Runden über alle Tische. Schreiber-Rolle pro Tisch mit Abgabe-Funktion. Sichtbarkeits-Steuerung: Spielleiter bestimmt ob Spieler andere Tische sehen. Spieler ohne Gerät können manuell zur Datenbank hinzugefügt werden.'},
```

- [ ] **Step 4: CACHE_NAME in sw.js aktualisieren**

```javascript
const CACHE_NAME = 'doko-v4.39';
```

- [ ] **Step 5: Commit**

```bash
git add index.html sw.js
git commit -m "feat: v4.39 – Turnier Phase 2: Spieler-App, Schreiber-Rolle, Sichtbarkeit"
```

---

## Self-Review Checklist

**Spec-Abdeckung:**
- ✅ Spieler-App (Modus 4): Task 4 (Join + Tisch-Wahl)
- ✅ Eigene Spiele einsehen: Task 5 ("Meine Spiele")
- ✅ Sichtbarkeit (playersVisible): Task 1 (Config) + Task 6 (Dashboard-Filter)
- ✅ Manuelle Ergänzung ohne Gerät: Task 7
- ✅ Schreiber-Rolle: Task 2 (Firebase-Feld) + Task 3 (UI + Transfer)
- ✅ Version/Changelog: Task 9

**Nicht in Scope (Phase 3):**
- Rotation-Mechanismus
- Gesamtwertung über alle Tische
- Rotations-Historie
- Tisch-Zuweisungs-Screen für Spielleiter

**Type-Konsistenz:**
- `schreiberId` durchgängig als String (spieler-id)
- `isPlayer` durchgängig als Boolean
- `playersVisible` durchgängig als Boolean
- `createSpieler(name, skipDevice)` – neuer optionaler Parameter
