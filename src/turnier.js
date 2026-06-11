import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { state, save, getAllPlayers, invalidateEingabeCache } from './main.js';
import { showToast, showConfirm, showPrompt } from './ui.js';

const FIREBASE_CONFIG={
  apiKey:"AIzaSyDWDsuVcm21LzrMfkmUcarwS4da6z02Gf8",
  authDomain:"doppelkopf-69717.firebaseapp.com",
  databaseURL:"https://doppelkopf-69717-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:"doppelkopf-69717",
  storageBucket:"doppelkopf-69717.firebasestorage.app",
  messagingSenderId:"404096856008",
  appId:"1:404096856008:web:df98e63491e06f60855afd"
};
let firebaseApp=null;
let firebaseDb=null;
let turnierListener=null;
let spielerCache=[];
// Presence (Online-Anzeige): eigener Eintrag + Heartbeat, sowie Listener fuer die Admin-Ansicht.
let presenceRef=null;        // ref('presence/<spielerId>') des eigenen Geraets
let presenceConnRef=null;    // ref('.info/connected')
let presenceHeartbeat=null;  // Intervall fuer lastSeen-Refresh
let presenceOwnId=null;      // aktuell gemeldete Spieler-ID (Idempotenz-Guard)
let presenceListRef=null;    // ref('presence') fuer Admin-Live-Ansicht
let presenceListCb=null;

export function initFirebase(){
  if(firebaseApp)return true;
  try{
    if(typeof firebase==='undefined')return false;
    firebaseApp=firebase.initializeApp(FIREBASE_CONFIG);
    firebaseDb=firebase.database();
    return true;
  }catch(e){
    console.error('Firebase init failed:',e);
    return false;
  }
}

export function getDeviceId(){
  let id=localStorage.getItem('doko-v4-deviceId');
  if(!id){
    id=crypto.randomUUID?crypto.randomUUID().replace(/-/g,'').slice(0,16):Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b=>b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem('doko-v4-deviceId',id);
  }
  return id;
}

export function generateSpielerShort(name,existingShorts){
  const first=name.split(' ')[0];
  if(!existingShorts.includes(first))return first;
  const parts=name.split(' ');
  if(parts.length>1){
    const withInitial=first+' '+parts[parts.length-1][0]+'.';
    if(!existingShorts.includes(withInitial))return withInitial;
  }
  // Fallback: Vollname oder mit Zähler
  if(!existingShorts.includes(name))return name;
  let i=2;
  while(existingShorts.includes(first+' '+i))i++;
  return first+' '+i;
}

export function generateQR(text,size){
  const qr=qrcode(0,'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(size||4,0);
}

export async function loadSpielerDB(){
  if(!initFirebase())return[];
  try{
    const snap=await firebase.database().ref('spieler').once('value');
    const data=snap.val()||{};
    spielerCache=Object.entries(data).map(([id,s])=>({id,...s}));
    return spielerCache;
  }catch(e){
    console.error('loadSpielerDB error:',e);
    return spielerCache;
  }
}

export async function findSpielerByDevice(deviceId){
  const all=await loadSpielerDB();
  return all.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId))||null;
}

export async function findSpielerByName(name){
  const all=await loadSpielerDB();
  return all.find(s=>s.name.toLowerCase()===name.toLowerCase())||null;
}

export async function createSpieler(name,skipDevice){
  if(!initFirebase())return null;
  const id=crypto.randomUUID?crypto.randomUUID().replace(/-/g,'').slice(0,8):Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b=>b.toString(16).padStart(2,'0')).join('');
  await loadSpielerDB();
  const existingShorts=spielerCache.map(s=>s.short).filter(Boolean);
  const short=generateSpielerShort(name,existingShorts);
  const spieler={name,short,createdAt:firebase.database.ServerValue.TIMESTAMP};
  if(!skipDevice){spieler.deviceIds=[getDeviceId()]}
  await firebase.database().ref('spieler/'+id).set(spieler);
  const cached={id,...spieler};
  if(!skipDevice)cached.deviceIds=spieler.deviceIds;
  spielerCache.push(cached);
  return cached;
}

export async function addDeviceToSpieler(spielerId,deviceId){
  if(!initFirebase())return;
  const ref=firebase.database().ref('spieler/'+spielerId+'/deviceIds');
  const snap=await ref.once('value');
  const ids=snap.val()||[];
  if(!ids.includes(deviceId)){
    ids.push(deviceId);
    await ref.set(ids);
  }
}

export async function checkFirstStart(){
  if(!initFirebase())return;
  const deviceId=getDeviceId();
  const existing=await findSpielerByDevice(deviceId);
  if(existing){
    startPresence(existing);
    const short=existing.short||existing.name.split(' ')[0];
    if(!state.players.includes(short)){
      state.players.push(short);
      if(!state.knownNames.includes(short))state.knownNames.push(short);
      save();renderPlayerTags();
    }
    return;
  }
  showNameModal();
}

export function showNameModal(){
  const el=document.getElementById('nameModalContent');
  el.innerHTML='<h3 style="margin-bottom:4px">Willkommen!</h3>'
    +'<p style="font-size:13px;color:var(--tx2);margin-bottom:16px">Gib deinen Namen ein. Er wird für Turniere verwendet.</p>'
    +'<input type="text" id="nameInput" placeholder="Vor- und Nachname" style="font-size:15px;padding:10px;width:100%;box-sizing:border-box;margin-bottom:12px">'
    +'<div id="nameMatchHint" style="font-size:12px;color:var(--tx3);margin-bottom:12px;display:none"></div>'
    +'<button class="btn btn-primary" onclick="submitName()">Speichern</button>';
  document.getElementById('nameModal').classList.add('show');
  const input=document.getElementById('nameInput');
  input.focus();
  let debounce=null;
  input.addEventListener('input',function(){
    clearTimeout(debounce);
    debounce=setTimeout(async()=>{
      const val=input.value.trim();
      const hint=document.getElementById('nameMatchHint');
      if(val.length<2){hint.style.display='none';return}
      const match=await findSpielerByName(val);
      if(match){
        hint.innerHTML='<b>'+match.name+'</b> existiert bereits. <a href="#" onclick="claimExistingSpieler(\''+match.id+'\');return false" style="color:var(--acc)">Das bin ich (neues Gerät)</a>';
        hint.style.display='block';
      }else{
        hint.style.display='none';
      }
    },400);
  });
}

export async function submitName(){
  const name=document.getElementById('nameInput').value.trim();
  if(!name||name.length<2){showToast('Bitte mindestens 2 Zeichen eingeben.','error');return}
  const existing=await findSpielerByName(name);
  if(existing){
    showToast('Name existiert bereits. Klicke "Das bin ich" falls du es bist, oder wähle einen anderen Namen.','error');
    return;
  }
  const spieler=await createSpieler(name);
  document.getElementById('nameModal').classList.remove('show');
  if(spieler){
    startPresence(spieler);
    const short=spieler.short||name.split(' ')[0];
    if(!state.players.includes(short)){
      state.players.push(short);
      if(!state.knownNames.includes(short))state.knownNames.push(short);
      save();renderPlayerTags();
    }
  }
  showToast('Willkommen, '+name.split(' ')[0]+'!','info');
}

export async function claimExistingSpieler(spielerId){
  const deviceId=getDeviceId();
  await addDeviceToSpieler(spielerId,deviceId);
  document.getElementById('nameModal').classList.remove('show');
  const spieler=spielerCache.find(s=>s.id===spielerId);
  if(spieler){
    startPresence(spieler);
    const short=spieler.short||spieler.name.split(' ')[0];
    if(!state.players.includes(short)){
      state.players.push(short);
      if(!state.knownNames.includes(short))state.knownNames.push(short);
      save();renderPlayerTags();
    }
  }
  showToast('Gerät verknüpft mit '+(spieler?spieler.name:'Spieler')+'!','info');
  // Auf neuem Gerät: vorhandenes Cloud-Backup zur Wiederherstellung anbieten.
  if(typeof window!=='undefined'&&window.maybeOfferRestore)window.maybeOfferRestore();
}

// ── Eigener Spieler / Admin ──
// Der Admin-Bereich ist nur fuer Admins sichtbar.
// Bootstrap-Admins sind fest verdrahtet (koennen nicht entzogen werden);
// weitere Admins werden ueber das Flag spieler/<id>/isAdmin in der DB verwaltet.
const ADMIN_NAME='arne chudobba';
export const BOOTSTRAP_ADMINS=['efd37c07'];

// Liefert den zu diesem Geraet gehoerenden Spieler-Datensatz (oder null).
export async function getOwnSpieler(){
  if(!initFirebase())return null;
  return await findSpielerByDevice(getDeviceId());
}

// True, wenn der gegebene Spieler-Datensatz Admin-Rechte hat.
export function spielerIsAdmin(s){
  if(!s)return false;
  if(BOOTSTRAP_ADMINS.includes(s.id))return true;
  if(s.isAdmin===true)return true;
  if(s.name&&s.name.trim().toLowerCase()===ADMIN_NAME)return true;
  return false;
}

// True, wenn der eigene Spieler Admin ist.
export async function isAdmin(){
  return spielerIsAdmin(await getOwnSpieler());
}

// True, wenn der Spieler „Doppelkopf spielen" (Beta) nutzen darf: Admins immer,
// sonst per Flag spieler/<id>/betaGame.
export function spielerCanBeta(s){
  return spielerIsAdmin(s) || !!(s && s.betaGame===true);
}
export async function canBetaDoko(){
  return spielerCanBeta(await getOwnSpieler());
}

// True, wenn der Spieler den „Ligabereich" nutzen darf: Admins immer,
// sonst per Flag spieler/<id>/liga.
export function spielerCanLiga(s){
  return spielerIsAdmin(s) || !!(s && s.liga===true);
}
export async function canLiga(){
  return spielerCanLiga(await getOwnSpieler());
}

// ── Presence / Online-Anzeige ──
// Hinweis: Schreibt presence/<spielerId> und entfernt den Knoten automatisch beim
// Verbindungsverlust (onDisconnect). Nur Nutzer MIT Profil melden sich; ohne Profil/
// offline passiert nichts. Die Liste sieht ausschliesslich der Admin.
// (Firebase-Regeln muessen serverseitig Schreiben auf 'presence' erlauben – wie bei
//  'spieler'/'turniere' bereits offen; kuenftiges Regel-Tightening muss 'presence' whitelisten.)
// Hinweis: Presence wird im bereits erlaubten 'spieler'-Pfad als Kind 'online' gespeichert
// (spieler/<id>/online) – so braucht es KEINE Firebase-Regeländerung. Name/Kuerzel stehen
// schon im Spieler-Datensatz. Nur Nutzer MIT Profil melden sich; ohne Profil/offline passiert
// nichts. Die Liste sieht ausschliesslich der Admin.
function writePresence(own){
  if(!presenceRef)return;
  presenceRef.set({
    lastSeen:firebase.database.ServerValue.TIMESTAMP,
    deviceId:getDeviceId()
  }).catch(e=>console.warn('presence write:',e));
}

export function startPresence(own){
  if(!own||!initFirebase())return;
  if(presenceOwnId===own.id)return; // bereits aktiv fuer diesen Spieler
  stopPresence();                   // evtl. alten Eintrag/Heartbeat sauber loesen
  presenceOwnId=own.id;
  presenceRef=firebase.database().ref('spieler/'+own.id+'/online');
  presenceConnRef=firebase.database().ref('.info/connected');
  presenceConnRef.on('value',snap=>{
    if(snap.val()===true){
      // onDisconnect bei jeder (Wieder-)Verbindung neu scharf schalten.
      presenceRef.onDisconnect().remove();
      writePresence(own);
    }
  });
  presenceHeartbeat=setInterval(()=>{
    if(presenceRef)presenceRef.child('lastSeen').set(firebase.database.ServerValue.TIMESTAMP);
  },60000);
}

export function stopPresence(){
  if(presenceHeartbeat){clearInterval(presenceHeartbeat);presenceHeartbeat=null;}
  if(presenceConnRef){try{presenceConnRef.off('value')}catch(e){}presenceConnRef=null;}
  if(presenceRef){
    try{presenceRef.onDisconnect().cancel()}catch(e){}
    try{presenceRef.remove()}catch(e){} // entfernt nur das 'online'-Kind, nicht den Spieler
    presenceRef=null;
  }
  presenceOwnId=null;
}

// Admin-Live-Ansicht: lauscht auf 'spieler' (erlaubt) und ruft cb(spielerMap) bei jeder
// Aenderung auf; onError bei Lese-/Rechtefehler (verhindert stummes "Laedt").
export function startPresenceWatch(cb,onError){
  if(!initFirebase()){if(onError)onError(new Error('keine Verbindung'));return;}
  stopPresenceWatch();
  presenceListRef=firebase.database().ref('spieler');
  presenceListCb=presenceListRef.on('value',s=>cb(s.val()||{}),err=>{if(onError)onError(err)});
}
export function stopPresenceWatch(){
  if(presenceListRef&&presenceListCb){try{presenceListRef.off('value',presenceListCb)}catch(e){}}
  presenceListRef=null;presenceListCb=null;
}

// Fuellt die Profil-Karte in den Einstellungen (Name + Kuerzel editierbar, ID read-only).
export async function fillProfileSettings(){
  const el=document.getElementById('profileSettings');
  if(!el)return;
  const own=await getOwnSpieler();
  if(!own){
    el.innerHTML='<div style="font-size:12px;color:var(--tx3)">Noch kein Profil angelegt. Es wird beim ersten Turnier-Beitritt erstellt.</div>';
    return;
  }
  const esc=s=>(s||'').replace(/"/g,'&quot;');
  const inp='width:100%;box-sizing:border-box;font-size:14px;padding:8px 10px;border-radius:var(--r-sm);border:1px solid var(--bdr);background:var(--bg);color:var(--tx)';
  const row='display:flex;align-items:center;gap:14px;padding:7px 0;font-size:13px;color:var(--tx2)';
  const lbl='flex:0 0 84px';
  let h='';
  h+='<div style="'+row+'"><span style="'+lbl+'">Benutzer-ID</span>'
    +'<input type="text" id="profileId" value="'+esc(own.id)+'" readonly style="'+inp+';flex:1;min-width:0;opacity:.7" onclick="this.select()">'
    +'<button onclick="copyProfileId()" title="ID kopieren" style="flex:0 0 auto;background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:36px;height:36px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></div>';
  h+='<div style="'+row+'"><span style="'+lbl+'">Name</span><input type="text" id="profileName" value="'+esc(own.name)+'" style="'+inp+';flex:1;min-width:0"></div>';
  h+='<div style="'+row+'"><span style="'+lbl+'">Kürzel</span><input type="text" id="profileShort" value="'+esc(own.short||'')+'" maxlength="20" style="'+inp+';flex:1;min-width:0"></div>';
  h+='<div style="display:flex;gap:8px;margin-top:12px">';
  h+='<button class="btn btn-primary" style="flex:1" onclick="saveProfile()">Profil speichern</button>';
  h+='<button class="btn btn-secondary" style="flex:1;color:var(--red);border-color:var(--red)" onclick="deleteProfile()">Löschen</button>';
  h+='</div>';
  el.innerHTML=h;
}

// Kopiert die eigene Benutzer-ID in die Zwischenablage.
export function copyProfileId(){
  const el=document.getElementById('profileId');
  if(!el)return;
  const id=el.value;
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(id).then(()=>showToast('Benutzer-ID kopiert.','info')).catch(()=>{el.select();showToast('Bitte manuell kopieren.','info')});
  }else{el.select();document.execCommand&&document.execCommand('copy');showToast('Benutzer-ID kopiert.','info')}
}

// Speichert Name + Kuerzel des eigenen Spielers in der Datenbank.
export async function saveProfile(){
  const own=await getOwnSpieler();
  if(!own){showToast('Kein Profil gefunden.','error');return}
  const name=(document.getElementById('profileName').value||'').trim();
  const short=(document.getElementById('profileShort').value||'').trim();
  if(name.length<2){showToast('Name muss mind. 2 Zeichen haben.','error');return}
  if(!short){showToast('Kürzel darf nicht leer sein.','error');return}
  // Eindeutigkeit pruefen (gegen andere Spieler)
  const all=await loadSpielerDB();
  if(all.some(s=>s.id!==own.id&&s.short&&s.short.toLowerCase()===short.toLowerCase())){
    showToast('Kürzel "'+short+'" ist bereits vergeben.','error');return;
  }
  if(all.some(s=>s.id!==own.id&&s.name&&s.name.toLowerCase()===name.toLowerCase())){
    showToast('Name "'+name+'" ist bereits vergeben.','error');return;
  }
  try{
    await firebase.database().ref('spieler/'+own.id).update({name,short});
    const cached=spielerCache.find(s=>s.id===own.id);
    if(cached){cached.name=name;cached.short=short}
    showToast('Profil gespeichert.','info');
  }catch(e){
    console.error('saveProfile error:',e);
    showToast('Speichern fehlgeschlagen.','error');
  }
}

// Loescht den eigenen Spieler-Datensatz aus der Datenbank.
export async function deleteProfile(){
  const own=await getOwnSpieler();
  if(!own){showToast('Kein Profil gefunden.','error');return}
  const ok=await showConfirm('Dein Profil „'+own.name+'" wirklich löschen? Du wirst aus der Spieler-Datenbank entfernt.','Löschen',true);
  if(!ok)return;
  try{
    await firebase.database().ref('spieler/'+own.id).remove();
    spielerCache=spielerCache.filter(s=>s.id!==own.id);
    stopPresence(); // nicht mehr als online melden
    showToast('Profil gelöscht.','info');
    fillProfileSettings();
  }catch(e){
    console.error('deleteProfile error:',e);
    showToast('Löschen fehlgeschlagen.','error');
  }
}

export function renderTurnierIndicator(){
  const el=document.getElementById('turnierIndicator');
  if(!el)return;
  if(!state.turnier){el.innerHTML='';el.style.display='none';return}
  el.style.display='block';
  const t=state.turnier;
  let label='DK-'+t.code;
  if(t.turnierName)label=t.turnierName;
  if(t.isHost&&t.tischId)label+=' · '+t.tischName;
  else if(t.isHost)label+=' · Spielleiter';
  else if(t.tischName)label+=' · '+t.tischName;
  // Schreiber-Status
  let roleBadge='';
  if(t.tischId&&!t.isHost&&t.schreiberId){
    const deviceId=getDeviceId();
    const own=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
    if(own&&own.id===t.schreiberId)roleBadge=' · <span class="schreiber-badge">Schreiber</span>';
    else if(own)roleBadge=' · <span class="zuschauer-badge">Zuschauer</span>';
  }
  // Self-Rotation: Kein Tisch zugewiesen (auch für Host der mitspielt)
  if(!t.tischId&&turnierConfigCache&&turnierConfigCache.tableMode==='rotation'){
    roleBadge=' \u00b7 <a href="#" onclick="openSelfRotationChoice();return false" style="color:var(--acc);font-weight:600">Tisch wählen!</a>';
  }
  el.innerHTML='<div class="turnier-banner" onclick="openTurnierDashboard()" style="cursor:pointer">'+label+roleBadge+' \u00b7 <span style="color:var(--grn)">Live</span></div>';
}

export async function transferSchreiber(){
  if(!state.turnier||!state.turnier.tischId)return;
  if(!initFirebase())return;
  await loadSpielerDB();
  const snap=await firebase.database().ref('turniere/DK'+state.turnier.code+'/tische/'+state.turnier.tischId).get();
  const tisch=snap.val();
  if(!tisch)return;
  const spielerIds=tisch.spielerIds||[];
  const deviceId=getDeviceId();
  const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
  const others=spielerIds.filter(id=>!ownSpieler||id!==ownSpieler.id);
  if(!others.length){showToast('Keine anderen Spieler am Tisch.','error');return}
  const names=others.map(id=>{const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id});
  const choice=await showPrompt('Schreiber abgeben an:\n'+others.map((id,i)=>(i+1)+'. '+names[i]).join('\n'),'Nummer','Abgeben');
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
export async function openMeineSpiele(){
  if(!state.turnier)return;
  if(!initFirebase())return;
  await loadSpielerDB();
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
    let totalPts=0,totalRounds=0,myRounds=[];
    tischArr.forEach(t=>{
      const rounds=t.rounds||[];
      const spielerIds=t.spielerIds||[];
      if(!spielerIds.includes(myId))return;
      rounds.forEach((r,i)=>{
        const pts=(r.scores&&r.scores[myId])||0;
        totalPts+=pts;totalRounds++;
        myRounds.push({tisch:t.name||'Tisch '+(t.nummer||'?'),nr:i+1,pts:pts,won:(r.winners||[]).includes(myId)});
      });
    });
    function nameOf(id){const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id}
    let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
      +'<button onclick="closeTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;gap:4px;padding:0 10px;font-size:13px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
      +'<h3 style="margin:0">Meine Spiele</h3><div style="width:32px"></div></div>';
    const col=totalPts>0?'var(--grn)':totalPts<0?'var(--red)':'var(--tx2)';
    html+='<div class="card" style="text-align:center;padding:16px;margin:12px 0">'
      +'<div style="font-size:13px;color:var(--tx3)">'+nameOf(myId)+'</div>'
      +'<div style="font-size:32px;font-weight:700;color:'+col+';margin:4px 0">'+totalPts+'</div>'
      +'<div style="font-size:12px;color:var(--tx3)">'+totalRounds+' Runden gespielt</div></div>';
    if(state.turnier.tischId){
      const myTisch=tischArr.find(t=>t.id===state.turnier.tischId);
      if(myTisch){
        const myTischPlayers=(myTisch.spielerIds||[]).map(id=>nameOf(id)).join(', ');
        html+='<div class="section-label">Aktueller Tisch</div>'
          +'<div class="card" style="padding:12px;margin-bottom:12px"><div style="font-weight:600">'+(myTisch.name||'Tisch '+myTisch.nummer)+'</div>'
          +'<div style="font-size:12px;color:var(--tx2);margin-top:2px">'+myTischPlayers+'</div></div>';
      }
    }
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
  }catch(e){console.error('openMeineSpiele error:',e);showToast('Fehler beim Laden.','error')}
}

export function renderTurnierSetup(){
  const el=document.getElementById('turnierSetupContent');
  if(!el)return;
  // Config nachladen für Host-Anzeige
  if(state.turnier&&state.turnier.isHost&&!turnierConfigCache&&initFirebase()){
    firebase.database().ref('turniere/DK'+state.turnier.code+'/config').get().then(cs=>{
      turnierConfigCache=cs.val();
      renderTurnierSetup();
    }).catch(()=>{});
  }
  if(!state.turnier){
    const archiv=JSON.parse(localStorage.getItem('doko-v4-turnierArchiv')||'[]');
    let html='<div style="display:flex;gap:8px;margin-top:4px">'
      +'<button class="btn btn-primary" style="flex:1" onclick="openCreateTurnier()">Erstellen</button>'
      +'<button class="btn btn-secondary" style="flex:1" onclick="openJoinTurnier()">Beitreten</button>'
      +'</div>';
    html+='<div style="margin-top:8px"><button class="btn btn-secondary" style="width:100%;font-size:13px" onclick="openMyTurniere()">Meine Turniere verwalten</button></div>';
    if(archiv.length){
      html+='<div style="margin-top:8px"><button style="background:none;border:none;color:var(--acc);font-size:12px;cursor:pointer;padding:0" onclick="showTurnierArchiv()">'+archiv.length+' vergangene'+(archiv.length===1?'s':'')+' Turnier'+(archiv.length>1?'e':'')+'</button></div>';
    }
    el.innerHTML=html;
    return;
  }
  const t=state.turnier;
  let html='<div style="font-size:13px;color:var(--tx2);margin-bottom:8px">'
    +'<div style="font-weight:600;font-size:15px;margin-bottom:4px">'+(t.turnierName||'DK-'+t.code)+'</div>'
    +(t.turnierName?'<div style="font-size:11px;color:var(--tx3);margin-bottom:2px">DK-'+t.code+'</div>':'');
  if(t.isHost&&t.tischId){
    html+='<div>Spielleiter · Tisch '+t.tischNummer+': '+t.tischName+'</div>';
  }else if(t.isHost){
    html+='<div>Du bist Spielleiter</div>';
  }else if(t.isPlayer){
    if(t.tischId)html+='<div>Spieler an '+t.tischName+'</div>';
    else html+='<div>Spieler (noch kein Tisch)</div>';
  }else{
    html+='<div>Tisch '+t.tischNummer+': '+t.tischName+'</div>';
  }
  html+='</div><div style="display:flex;gap:8px;flex-wrap:wrap">';
  if(t.isPlayer){
    html+='<button class="btn btn-primary" style="flex:1" onclick="openMeineSpiele()">Meine Spiele</button>';
  }
  html+='<button class="btn btn-'+(t.isPlayer?'secondary':'primary')+'" style="flex:1" onclick="openTurnierDashboard()">Dashboard</button>';
  if(t.isHost&&!t.tischId){
    html+='<button class="btn btn-secondary" style="flex:1" onclick="hostJoinTisch()">Tisch beitreten</button>';
  }
  if(t.isHost&&t.tischId){
    html+='<button class="btn btn-secondary" style="flex:1" onclick="hostLeaveTisch()">Tisch verlassen</button>';
  }
  if(t.isPlayer&&!t.tischId){
    html+='<button class="btn btn-secondary" style="flex:1" onclick="openPlayerTischWahl()">Tisch beitreten</button>';
  }
  if(t.isPlayer&&t.tischId){
    html+='<button class="btn btn-secondary" style="flex:1" onclick="openPlayerTischWahl()">Tisch wechseln</button>';
  }
  if(t.isHost){
    html+='<button class="btn btn-secondary" style="flex:1" onclick="endTurnier()">Beenden</button>';
  }else{
    html+='<button class="btn btn-secondary" style="flex:1" onclick="leaveTurnier()">Verlassen</button>';
  }
  html+='<button class="btn btn-secondary" style="flex:1" onclick="openMyTurniere()">Meine Turniere</button>';
  html+='</div>';
  // Konfigurationsübersicht für Spielleiter
  if(t.isHost&&turnierConfigCache){
    const c=turnierConfigCache;
    const mNames={1:'Feste Liste',2:'Liste + Ergänzung',3:'Freie Eingabe',4:'Spieler-App'};
    const tNames={fixed:'Feste Tische',rotation:'Rotation'};
    html+='<div style="margin-top:8px;font-size:12px;color:var(--tx3);background:var(--bg3);border-radius:var(--r-sm);padding:8px 10px;cursor:pointer" onclick="openEditTurnierConfig()">'
      +'<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-weight:500;color:var(--tx2)">Einstellungen</span>'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="9 18 15 12 9 6"/></svg></div>'
      +'<div style="margin-top:4px">'+mNames[c.playerMode]+' · '+tNames[c.tableMode];
    if(c.tableMode==='rotation'){
      html+=' · '+({host:'Spielleiter-Zuweisung',self:'Freier Wechsel'}[c.rotationType]||'');
      if(c.rotationTrigger==='afterRounds')html+=' · nach '+c.rotationAfterRounds+' Runden';
      else html+=' · manuell';
    }
    html+='</div><div style="margin-top:2px">Sichtbarkeit: '+(c.playersVisible?'Alle Tische':'Nur eigener Tisch')+'</div></div>';
  }
  el.innerHTML=html;
}

export async function openEditTurnierConfig(){
  if(!state.turnier||!state.turnier.isHost)return;
  if(!initFirebase())return;
  document.getElementById('turnierModal').classList.add('show');
  const el=document.getElementById('turnierModalContent');
  const code=state.turnier.code;
  let c=turnierConfigCache;
  if(!c){
    try{const cs=await firebase.database().ref('turniere/DK'+code+'/config').get();c=cs.val();turnierConfigCache=c}catch(e){return}
  }
  if(!c)return;
  renderEditConfig(c);
}

export function renderEditConfig(c){
  const el=document.getElementById('turnierModalContent');
  const mNames={1:'Feste Liste',2:'Liste + Ergänzung',3:'Freie Eingabe',4:'Spieler-App'};
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">Einstellungen</h3>'
    +'<button onclick="closeTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  html+='<div class="card" style="font-size:13px;margin-top:12px">'
    +'<div style="padding:6px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--tx3)">Spieler-Modus:</span> '+mNames[c.playerMode]+'</div>'
    +'<div style="padding:6px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--tx3)">Tisch-Modus:</span> '+(c.tableMode==='fixed'?'Feste Tische':'Rotation');
  if(c.tableMode==='rotation'){
    html+=' ('+({host:'Spielleiter-Zuweisung',self:'Freier Wechsel'}[c.rotationType]||'')+', ';
    html+=(c.rotationTrigger==='afterRounds'?'nach '+c.rotationAfterRounds+' Runden':'manuell')+')';
  }
  html+='</div></div>';
  html+='<div class="toggle-row" style="margin-top:12px;padding:8px 0"><span class="toggle-label">Gesamtwertung</span>'
    +'<button class="toggle'+(c.scoringEnabled?' on':'')+'" onclick="toggleTurnierConfig(\'scoringEnabled\')"></button></div>';
  html+='<div class="toggle-row" style="padding:8px 0"><span class="toggle-label">Spieler sehen andere Tische</span>'
    +'<button class="toggle'+(c.playersVisible?' on':'')+'" onclick="toggleTurnierConfig(\'playersVisible\')"></button></div>';
  el.innerHTML=html;
}

export async function toggleTurnierConfig(key){
  if(!state.turnier||!state.turnier.isHost)return;
  if(!initFirebase()||!turnierConfigCache)return;
  turnierConfigCache[key]=!turnierConfigCache[key];
  await firebase.database().ref('turniere/DK'+state.turnier.code+'/config/'+key).set(turnierConfigCache[key]);
  renderEditConfig(turnierConfigCache);
  renderTurnierSetup();
}
let turnierWizard={step:1,config:{playerMode:3,tableMode:'fixed',rotationType:null,rotationTrigger:null,rotationAfterRounds:4,scoringEnabled:true,playersVisible:false,discoverable:false},selectedPlayers:[]};

export function openCreateTurnier(){
  turnierWizard={step:1,config:{playerMode:3,tableMode:'fixed',rotationType:null,rotationTrigger:null,rotationAfterRounds:4,scoringEnabled:true,playersVisible:false,discoverable:false},selectedPlayers:[],turnierName:''};
  document.getElementById('turnierCreateModal').classList.add('show');
  renderWizardStep();
}
export function closeCreateTurnier(){document.getElementById('turnierCreateModal').classList.remove('show')}
document.getElementById('turnierCreateModal').addEventListener('click',function(e){if(e.target===this)closeCreateTurnier()});

export function renderWizardStep(){
  const el=document.getElementById('turnierCreateContent');
  const w=turnierWizard;
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">Turnier erstellen</h3>'
    +'<button onclick="closeCreateTurnier()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  html+='<div style="display:flex;gap:4px;margin:12px 0">';
  for(let i=1;i<=4;i++){
    html+='<div style="flex:1;height:3px;border-radius:2px;background:'+(i<=w.step?'var(--acc)':'var(--bg3)')+'"></div>';
  }
  html+='</div>';
  if(w.step===1)html+=renderWizardStep1();
  else if(w.step===2)html+=renderWizardStep2();
  else if(w.step===3)html+=renderWizardStep3();
  else if(w.step===4)html+=renderWizardStep4();
  el.innerHTML=html;
}

// Wizard-Setter: turnierWizard ist modul-lokal (nicht global), daher muessen
// onclick-Handler ueber diese exportierten Funktionen gehen statt turnierWizard direkt zu mutieren.
export function wizardSetConfig(key,val){turnierWizard.config[key]=val;renderWizardStep()}
export function wizardGoStep(n){turnierWizard.step=n;renderWizardStep()}
export function wizardToggleConfig(key){turnierWizard.config[key]=!turnierWizard.config[key];renderWizardStep()}

export function renderWizardStep1(){
  const modes=[
    {id:1,name:'Feste Liste',desc:'Du wählst alle Spieler vorab aus. Tische werden daraus besetzt.'},
    {id:2,name:'Liste + Ergänzung',desc:'Wie feste Liste, aber Tische können eigene Spieler ergänzen.'},
    {id:3,name:'Freie Eingabe',desc:'Jeder Tisch trägt seine Spieler selbst ein.'},
    {id:4,name:'Spieler-App',desc:'Jeder Spieler tritt selbst bei und sieht eigene Ergebnisse.'}
  ];
  let html='<div class="section-label">Spieler-Modus</div>';
  modes.forEach(m=>{
    const sel=turnierWizard.config.playerMode===m.id;
    html+='<div class="wizard-option'+(sel?' selected':'')+'" onclick="wizardSetConfig(\'playerMode\','+m.id+')">'
      +'<div style="font-weight:600;font-size:14px">'+m.name+'</div>'
      +'<div style="font-size:12px;color:var(--tx3);margin-top:2px">'+m.desc+'</div></div>';
  });
  html+='<div style="margin-top:16px;display:flex;justify-content:flex-end">'
    +'<button class="btn btn-primary" onclick="wizardGoStep(2)">Weiter</button></div>';
  return html;
}

export function renderWizardStep2(){
  const c=turnierWizard.config;
  let html='<div class="section-label">Tisch-Modus</div>';
  [{id:'fixed',name:'Feste Tische',desc:'Spieler bleiben den ganzen Abend am gleichen Tisch.'},
   {id:'rotation',name:'Rotation',desc:'Spieler wechseln zwischen Tischen.'}].forEach(m=>{
    const sel=c.tableMode===m.id;
    html+='<div class="wizard-option'+(sel?' selected':'')+'" onclick="wizardSetConfig(\'tableMode\',\''+m.id+'\')">'
      +'<div style="font-weight:600;font-size:14px">'+m.name+'</div>'
      +'<div style="font-size:12px;color:var(--tx3);margin-top:2px">'+m.desc+'</div></div>';
  });
  if(c.tableMode==='rotation'){
    html+='<div class="section-label" style="margin-top:12px">Wer steuert den Wechsel?</div>';
    [{id:'host',name:'Spielleiter',desc:'Du gibst die neue Tischaufteilung vor.'},
     {id:'self',name:'Freier Wechsel',desc:'Spieler wechseln selbst (z.B. Cocktail Hopping).'}].forEach(m=>{
      const sel=c.rotationType===m.id;
      html+='<div class="wizard-option'+(sel?' selected':'')+'" onclick="wizardSetConfig(\'rotationType\',\''+m.id+'\')">'
        +'<div style="font-weight:600;font-size:14px">'+m.name+'</div>'
        +'<div style="font-size:12px;color:var(--tx3);margin-top:2px">'+m.desc+'</div></div>';
    });
    html+='<div class="section-label" style="margin-top:12px">Wann wird gewechselt?</div>';
    [{id:'manual',name:'Manuell',desc:'Du löst den Wechsel im Dashboard aus.'},
     {id:'afterRounds',name:'Nach X Runden',desc:'Automatischer Hinweis nach einer bestimmten Rundenzahl.'}].forEach(m=>{
      const sel=c.rotationTrigger===m.id;
      html+='<div class="wizard-option'+(sel?' selected':'')+'" onclick="wizardSetConfig(\'rotationTrigger\',\''+m.id+'\')">'
        +'<div style="font-weight:600;font-size:14px">'+m.name+'</div>'
        +'<div style="font-size:12px;color:var(--tx3);margin-top:2px">'+m.desc+'</div></div>';
    });
    if(c.rotationTrigger==='afterRounds'){
      html+='<div style="margin-top:8px;display:flex;align-items:center;gap:8px"><span style="font-size:13px">Runden pro Rotation:</span>'
        +'<input type="number" id="wizRotRounds" value="'+(c.rotationAfterRounds||4)+'" min="1" max="20" style="width:60px;font-size:14px;padding:6px" onchange="turnierWizard.config.rotationAfterRounds=parseInt(this.value)||4"></div>';
    }
  }
  html+='<div style="margin-top:16px;display:flex;justify-content:space-between">'
    +'<button class="btn btn-secondary" onclick="wizardGoStep(1)">Zurück</button>'
    +'<button class="btn btn-primary" onclick="wizardToStep3()">Weiter</button></div>';
  return html;
}

export function wizardToStep3(){
  const c=turnierWizard.config;
  if(c.tableMode==='rotation'&&!c.rotationType){showToast('Bitte Wechsel-Steuerung wählen.','error');return}
  if(c.tableMode==='rotation'&&!c.rotationTrigger){showToast('Bitte Wechsel-Trigger wählen.','error');return}
  if(c.tableMode==='fixed'){c.rotationType=null;c.rotationTrigger=null;c.rotationAfterRounds=null}
  turnierWizard.step=3;
  if(c.playerMode===3){turnierWizard.step=4}
  renderWizardStep();
}

export function renderWizardStep3(){
  let html='<div class="section-label">Spieler auswählen</div>'
    +'<div style="font-size:12px;color:var(--tx3);margin-bottom:8px">Wähle die Turnier-Teilnehmer aus der Spieler-Datenbank.</div>'
    +'<div style="display:flex;gap:6px;margin-bottom:12px">'
    +'<input type="text" id="wizPlayerSearch" placeholder="Spieler suchen..." style="flex:1;font-size:13px;padding:8px" oninput="renderWizardPlayerList()">'
    +'<button class="btn btn-secondary" style="width:auto;padding:8px 12px;font-size:12px" onclick="openAddPlayerDialog()">+ Spieler</button></div>'
    +'<div id="wizPlayerList"></div>'
    +'<div id="wizSelectedPlayers" style="margin-top:12px"></div>'
    +'<div style="margin-top:16px;display:flex;justify-content:space-between">'
    +'<button class="btn btn-secondary" onclick="wizardGoStep(2)">Zurück</button>'
    +'<button class="btn btn-primary" onclick="wizardGoStep(4)">Weiter</button></div>';
  setTimeout(()=>renderWizardPlayerList(),0);
  return html;
}

export function renderWizardPlayerList(){
  const search=(document.getElementById('wizPlayerSearch')||{}).value||'';
  const term=search.toLowerCase().trim();
  const filtered=term?spielerCache.filter(s=>s.name.toLowerCase().includes(term)):spielerCache;
  const listEl=document.getElementById('wizPlayerList');
  const selEl=document.getElementById('wizSelectedPlayers');
  if(!listEl)return;
  const selIds=turnierWizard.selectedPlayers.map(s=>s.id);
  let html='';
  filtered.forEach(s=>{
    const isSel=selIds.includes(s.id);
    html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid var(--bdr);cursor:pointer;background:'+(isSel?'var(--bg3)':'transparent')+'" onclick="toggleWizPlayer(\''+s.id+'\')">'
      +'<span style="font-size:14px">'+s.name+'</span>'
      +'<span style="font-size:18px;color:'+(isSel?'var(--grn)':'var(--tx3)')+'">'+( isSel?'&#10003;':'&#43;')+'</span></div>';
  });
  if(!filtered.length)html='<div style="padding:12px;text-align:center;color:var(--tx3);font-size:13px">Keine Spieler gefunden.</div>';
  listEl.innerHTML=html;
  if(selEl){
    selEl.innerHTML=selIds.length?'<div style="font-size:12px;color:var(--tx3);margin-bottom:4px">'+selIds.length+' Spieler ausgewählt:</div>'
      +'<div style="display:flex;flex-wrap:wrap;gap:6px">'+turnierWizard.selectedPlayers.map(s=>'<span class="turnier-chip">'+s.short+'<button onclick="event.stopPropagation();toggleWizPlayer(\''+s.id+'\')" style="background:none;border:none;color:var(--tx3);cursor:pointer;padding:0 0 0 4px;font-size:14px">&times;</button></span>').join('')+'</div>':'';
  }
}

export function toggleWizPlayer(id){
  const idx=turnierWizard.selectedPlayers.findIndex(s=>s.id===id);
  if(idx>=0){turnierWizard.selectedPlayers.splice(idx,1)}
  else{const s=spielerCache.find(s=>s.id===id);if(s)turnierWizard.selectedPlayers.push(s)}
  renderWizardPlayerList();
}

let _addPlayerContext=null;
export async function openAddPlayerDialog(context){
  _addPlayerContext=context||'wizard';
  const overlay=document.getElementById('confirmOverlay');
  document.getElementById('confirmText').innerHTML='Spieler hinzufügen'
    +'<input type="text" id="confirmInput" placeholder="Vor- und Nachname" style="width:100%;box-sizing:border-box;font-size:15px;padding:10px;margin-top:12px;border:1px solid var(--bdr);border-radius:var(--r-sm);background:var(--bg);color:var(--tx)">'
    +'<label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;color:var(--tx2);cursor:pointer">'
    +'<input type="checkbox" id="confirmNoDevice" style="width:18px;height:18px"> Spieler hat kein eigenes Handy</label>';
  const actionBtn=document.getElementById('confirmAction');
  actionBtn.textContent='Hinzufügen';
  actionBtn.className='confirm-action';
  overlay.classList.add('show');
  setTimeout(()=>document.getElementById('confirmInput').focus(),100);
  return new Promise(resolve=>{
    const handler=async()=>{
      const name=(document.getElementById('confirmInput').value||'').trim();
      const noDevice=document.getElementById('confirmNoDevice').checked;
      overlay.classList.remove('show');
      actionBtn.removeEventListener('click',handler);
      cancelBtn.removeEventListener('click',cancelHandler);
      if(!name||name.length<2){resolve();return}
      const s=await createSpieler(name,noDevice);
      if(!s){resolve();return}
      if(_addPlayerContext==='join'){
        const code=document.getElementById('joinCodeInput').value.trim();
        await firebase.database().ref('turniere/DK'+code+'/teilnehmer/'+s.id).set(true);
        loadJoinTurnierInfo(code,null);
      }else{
        renderWizardPlayerList();
      }
      resolve();
    };
    const cancelHandler=()=>{overlay.classList.remove('show');actionBtn.removeEventListener('click',handler);cancelBtn.removeEventListener('click',cancelHandler);resolve()};
    const cancelBtn=document.getElementById('confirmCancel');
    actionBtn.addEventListener('click',handler);
    cancelBtn.addEventListener('click',cancelHandler);
    overlay.addEventListener('click',function oc(e){if(e.target===overlay){overlay.classList.remove('show');overlay.removeEventListener('click',oc);actionBtn.removeEventListener('click',handler);cancelBtn.removeEventListener('click',cancelHandler);resolve()}},{once:false});
  });
}

export function renderWizardStep4(){
  const c=turnierWizard.config;
  const modeNames={1:'Feste Liste',2:'Liste + Ergänzung',3:'Freie Eingabe',4:'Spieler-App'};
  const tableNames={fixed:'Feste Tische',rotation:'Rotation'};
  let html='<div class="section-label">Turniername (optional)</div>'
    +'<input type="text" id="turnierNameInput" placeholder="z.B. Doko-Abend Mai 2026" value="'+(turnierWizard.turnierName||'')+'" oninput="turnierWizard.turnierName=this.value" style="width:100%;box-sizing:border-box;font-size:14px;padding:10px;margin-bottom:16px;border:1px solid var(--bdr);border-radius:var(--r-sm);background:var(--bg);color:var(--tx)">';
  html+='<div class="section-label">Zusammenfassung</div><div class="card" style="font-size:13px">';
  html+='<div style="padding:6px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--tx3)">Spieler-Modus:</span> '+modeNames[c.playerMode]+'</div>';
  html+='<div style="padding:6px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--tx3)">Tisch-Modus:</span> '+tableNames[c.tableMode];
  if(c.tableMode==='rotation'){
    html+=' ('+({host:'Spielleiter-Zuweisung',self:'Freier Wechsel'}[c.rotationType]||'')+', ';
    html+=(c.rotationTrigger==='afterRounds'?'nach '+c.rotationAfterRounds+' Runden':'manuell')+')';
  }
  html+='</div>';
  if(c.playerMode!==3){
    html+='<div style="padding:6px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--tx3)">Teilnehmer:</span> '+turnierWizard.selectedPlayers.length+' Spieler</div>';
  }
  html+='<div style="padding:6px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--tx3)">Gesamtwertung:</span> '+(c.scoringEnabled?'Ja':'Nein')+'</div>';
  html+='<div style="padding:6px 0"><span style="color:var(--tx3)">Sichtbarkeit:</span> '+(c.playersVisible?'Alle Tische':'Nur eigener Tisch')+'</div>';
  html+='</div>';
  html+='<div class="toggle-row" style="margin-top:12px;padding:8px 0"><span class="toggle-label">Gesamtwertung</span>'
    +'<button class="toggle'+(c.scoringEnabled?' on':'')+'" onclick="wizardToggleConfig(\'scoringEnabled\')"></button></div>';
  html+='<div class="toggle-row" style="padding:8px 0"><span class="toggle-label">Spieler sehen andere Tische</span>'
    +'<button class="toggle'+(c.playersVisible?' on':'')+'" onclick="wizardToggleConfig(\'playersVisible\')"></button></div>';
  html+='<div class="toggle-row" style="padding:8px 0"><span class="toggle-label">In der Nähe auffindbar</span>'
    +'<button class="toggle'+(c.discoverable?' on':'')+'" onclick="wizardToggleConfig(\'discoverable\')"></button></div>';
  html+='<div style="font-size:11px;color:var(--tx3);padding:0 0 4px">Teilt beim Erstellen deinen ungefähren Standort, damit andere das Turnier ohne Code in der Nähe finden.</div>';
  html+='<div style="margin-top:16px;display:flex;justify-content:space-between">'
    +'<button class="btn btn-secondary" onclick="wizardGoStep('+(c.playerMode===3?2:3)+')">Zurück</button>'
    +'<button class="btn btn-primary" onclick="submitCreateTurnier()">Turnier erstellen</button></div>';
  return html;
}

// ── Discovery („in der Nähe") + QR-Scan-Helfer ──
function parseTurnierCode(text){
  if(!text)return null;
  const s=String(text);
  let m=s.match(/(?:turnier=)?DK[-]?(\d{4})/i);
  if(!m)m=s.match(/(?:^|[^\d])(\d{4})(?:[^\d]|$)/);
  return m?m[1]:null;
}
function haversineKm(lat1,lng1,lat2,lng2){
  const R=6371,toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1),dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function getPosition(){
  return new Promise(resolve=>{
    if(!navigator.geolocation){resolve(null);return}
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude}),
      ()=>resolve(null),
      {enableHighAccuracy:false,timeout:8000,maximumAge:300000}
    );
  });
}
async function writeDiscovery(code,name,pos){
  if(!pos||!initFirebase())return;
  try{
    await firebase.database().ref('discovery/DK'+code).set({
      code:code,
      name:name||null,
      created:firebase.database.ServerValue.TIMESTAMP,
      lat:Math.round(pos.lat*100)/100,
      lng:Math.round(pos.lng*100)/100,
      status:'active'
    });
  }catch(e){console.warn('writeDiscovery:',e)}
}
async function removeDiscovery(code){
  if(!code||!initFirebase())return;
  try{await firebase.database().ref('discovery/DK'+code).remove();}catch(e){console.warn('removeDiscovery:',e)}
}

export async function submitCreateTurnier(){
  if(!initFirebase()){showToast('Firebase nicht verfügbar.','error');return}
  const c=turnierWizard.config;
  if(c.playerMode!==3&&turnierWizard.selectedPlayers.length<4){
    showToast('Bitte mindestens 4 Spieler auswählen.','error');return;
  }
  const code=String(Math.floor(1000+Math.random()*9000));
  const dbRef=firebase.database().ref('turniere/DK'+code);
  try{
    const snap=await dbRef.get();
    if(snap.exists()){showToast('Code-Kollision. Bitte erneut versuchen.','error');return}
    const turnierName=(turnierWizard.turnierName||'').trim();
    // Ersteller VOR dem Schreiben ermitteln, damit createdBy mitgespeichert wird.
    const deviceId=getDeviceId();
    const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
    const turnierData={
      created:firebase.database.ServerValue.TIMESTAMP,
      lastActivity:firebase.database.ServerValue.TIMESTAMP,
      status:'active',
      config:c
    };
    if(turnierName)turnierData.name=turnierName;
    if(ownSpieler)turnierData.createdBy=ownSpieler.id;
    turnierData.createdByDevice=deviceId; // Fallback-Besitz: erstellendes Geraet kann es auch ohne Profil verwalten
    await dbRef.set(turnierData);
    // Host in hosts-Liste speichern
    if(ownSpieler)await dbRef.child('hosts/'+ownSpieler.id).set(true);
    if(c.playerMode!==3){
      const teilnehmer={};
      turnierWizard.selectedPlayers.forEach(s=>{teilnehmer[s.id]=true});
      await dbRef.child('teilnehmer').set(teilnehmer);
    }
    if(c.tableMode==='rotation'){
      await dbRef.child('currentRotation').set(0);
      await dbRef.child('rotationen/0').set({status:'active',startedAt:firebase.database.ServerValue.TIMESTAMP});
    }
    // Laufendes Spiel direkt als eigenen Tisch übernehmen (Freie Eingabe)
    let hostTisch=null;
    if(c.playerMode===3 && state.rounds.length>0){
      const carry=await showConfirm('Du hast ein laufendes Spiel ('+state.rounds.length+' Runde'+(state.rounds.length>1?'n':'')+'). Direkt als deinen Tisch (Tisch 1) ins Turnier übernehmen?','Übernehmen');
      if(carry){
        const spielerIds=getAllPlayers();
        const schreiberId=ownSpieler?ownSpieler.id:(spielerIds[0]||'');
        const tischRef=dbRef.child('tische').push();
        await tischRef.set({name:'Tisch 1',nummer:1,spielerIds:spielerIds,schreiberId:schreiberId,rounds:state.rounds,lastSync:firebase.database.ServerValue.TIMESTAMP});
        hostTisch={id:tischRef.key,name:'Tisch 1',nummer:1,schreiberId:schreiberId};
      }
    }
    // Opt-in: ungefähren Standort für "in der Nähe finden" hinterlegen
    if(c.discoverable){
      const pos=await getPosition();
      if(pos)await writeDiscovery(code,turnierName,pos);
      else showToast('Standort nicht verfügbar – Turnier ist nur per Code/QR beitretbar.','info');
    }
    state.turnier=hostTisch
      ? {code:code,tischId:hostTisch.id,tischName:hostTisch.name,tischNummer:hostTisch.nummer,isHost:true,isPlayer:false,turnierName:turnierName||null,schreiberId:hostTisch.schreiberId}
      : {code:code,tischId:null,tischName:null,tischNummer:null,isHost:true,isPlayer:false,turnierName:turnierName||null};
    save();
    closeCreateTurnier();
    renderTurnierSetup();renderTurnierIndicator();
    if(!ownSpieler)showToast('Hinweis: Ohne eigenes Profil ist dieses Turnier nur auf diesem Gerät verwaltbar.','info');
    showTurnierShareModal(code);
  }catch(e){
    console.error('createTurnier error:',e);
    showToast('Fehler: '+e.message,'error');
  }
}
export function showTurnierShareModal(code){
  const url=location.origin+location.pathname+'?turnier=DK'+code;
  const qrImg=generateQR(url,6);
  const el=document.getElementById('turnierModalContent');
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">'+(state.turnier.turnierName||'Turnier DK-'+code)+'</h3>'
    +'<button onclick="closeTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  html+='<div style="text-align:center;margin:24px 0">'
    +'<div style="font-size:32px;font-weight:700;letter-spacing:4px;margin-bottom:16px">DK-'+code+'</div>'
    +'<img src="'+qrImg+'" style="width:200px;height:200px;image-rendering:pixelated;border-radius:var(--r-sm)">'
    +'<div style="font-size:12px;color:var(--tx3);margin-top:8px;word-break:break-all">'+url+'</div></div>';
  html+='<div style="display:flex;gap:8px;margin-bottom:16px">';
  if(navigator.share){
    html+='<button class="btn btn-primary" style="flex:1" onclick="shareTurnierCode(\''+code+'\')">Teilen</button>';
  }
  html+='<button class="btn btn-secondary" style="flex:1" onclick="copyTurnierLink(\''+code+'\')">Link kopieren</button></div>';
  html+='<button class="btn btn-primary" style="width:100%" onclick="openTurnierDashboard()">Zum Dashboard</button>';
  el.innerHTML=html;
  document.getElementById('turnierModal').classList.add('show');
}
export function shareTurnierCode(code){
  const url=location.origin+location.pathname+'?turnier=DK'+code;
  navigator.share({title:'Doppelkopf Turnier',text:'Tritt dem Turnier bei! Code: DK-'+code,url:url}).catch(()=>{});
}
export function copyTurnierLink(code){
  const url=location.origin+location.pathname+'?turnier=DK'+code;
  navigator.clipboard.writeText(url).then(()=>showToast('Link kopiert!','info')).catch(()=>{
    showToast('DK-'+code,'info');
  });
}
export function checkTurnierUrlParam(){
  const params=new URLSearchParams(location.search);
  const turnier=params.get('turnier');
  const tisch=params.get('tisch');
  if(!turnier)return;
  history.replaceState(null,'',location.pathname);
  const code=turnier.replace('DK','').replace('dk','');
  if(!/^\d{4}$/.test(code))return;
  if(state.turnier&&!state.turnier.isHost&&!state.turnier.isPlayer){showToast('Du bist bereits in Turnier DK-'+state.turnier.code+'.','info');return}
  setTimeout(()=>{
    openJoinTurnier(code,tisch||null);
  },500);
}
let joinTurnierConfig=null;
let joinSelectedPlayers=[];
let joinTurnierData=null;
let joinSelectedTischId=null;

export function openJoinTurnier(prefillCode,prefillTisch){
  if(state.turnier&&!state.turnier.isHost&&!state.turnier.isPlayer){showToast('Du bist bereits in Turnier DK-'+state.turnier.code+'. Bitte erst verlassen.','error');return}
  joinTurnierData=null;joinSelectedTischId=null;joinSelectedPlayers=[];joinTurnierConfig=null;
  const el=document.getElementById('turnierJoinContent');
  el.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    +'<h3 style="margin:0">Turnier beitreten</h3>'
    +'<button onclick="closeJoinTurnier()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
    +'<div style="margin-bottom:12px"><label style="font-size:12px;color:var(--tx2);display:block;margin-bottom:4px">Turnier-Code</label>'
    +'<div style="display:flex;align-items:center;gap:6px"><span style="font-weight:600;color:var(--tx2)">DK-</span>'
    +'<input type="text" id="joinCodeInput" maxlength="4" inputmode="numeric" pattern="[0-9]*" value="'+(prefillCode||'')+'" placeholder="4729" style="font-size:16px;padding:10px;letter-spacing:4px;text-align:center;flex:1"></div></div>'
    +'<div id="joinTurnierInfo" style="margin-bottom:12px"></div>'
    +'<div style="display:flex;gap:8px;margin-bottom:12px">'
    +'<button class="btn btn-secondary" style="flex:1;margin:0" onclick="openQrScanner()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;vertical-align:-2px"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg> QR scannen</button>'
    +'<button class="btn btn-secondary" style="flex:1;margin:0" onclick="renderNearbyTurniere()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;vertical-align:-2px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> In der Nähe</button>'
    +'</div>'
    +'<div id="joinNearby"></div>';
  document.getElementById('turnierJoinModal').classList.add('show');
  if(!prefillCode)document.getElementById('joinCodeInput').focus();
  const codeInput=document.getElementById('joinCodeInput');
  let codeDebounce=null;
  codeInput.addEventListener('input',function(){
    clearTimeout(codeDebounce);
    codeDebounce=setTimeout(()=>{if(this.value.length===4)loadJoinTurnierInfo(this.value,null)},300);
  });
  if(prefillCode&&prefillCode.length===4)setTimeout(()=>loadJoinTurnierInfo(prefillCode,prefillTisch),100);
}

export function closeJoinTurnier(){document.getElementById('turnierJoinModal').classList.remove('show')}
document.getElementById('turnierJoinModal').addEventListener('click',function(e){if(e.target===this)closeJoinTurnier()});

// Turniere in der Nähe (GPS) – liest den Discovery-Index und filtert nach Entfernung/Alter
export async function renderNearbyTurniere(){
  const box=document.getElementById('joinNearby');
  if(!box)return;
  if(!initFirebase()){box.innerHTML='<div style="font-size:12px;color:var(--red)">Firebase nicht verfügbar.</div>';return}
  box.innerHTML='<div style="font-size:12px;color:var(--tx3)">Standort wird ermittelt…</div>';
  const pos=await getPosition();
  if(!pos){box.innerHTML='<div style="font-size:12px;color:var(--tx3)">Standort nicht verfügbar. Nutze Code oder QR.</div>';return}
  let entries=[];
  try{
    const snap=await firebase.database().ref('discovery').get();
    if(snap.exists())entries=Object.values(snap.val()||{});
  }catch(e){box.innerHTML='<div style="font-size:12px;color:var(--red)">Konnte Turniere nicht laden.</div>';return}
  const now=Date.now(), maxAgeMs=12*60*60*1000, maxKm=25;
  const list=entries
    .filter(t=>t&&t.status==='active'&&typeof t.lat==='number'&&typeof t.lng==='number'&&t.created&&(now-t.created)<maxAgeMs)
    .map(t=>({...t,dist:haversineKm(pos.lat,pos.lng,t.lat,t.lng)}))
    .filter(t=>t.dist<=maxKm)
    .sort((a,b)=>a.dist-b.dist)
    .slice(0,15);
  if(!list.length){box.innerHTML='<div style="font-size:12px;color:var(--tx3)">Keine Turniere in der Nähe gefunden.</div>';return}
  let html='<div class="section-label">In der Nähe</div>';
  list.forEach(t=>{
    const dist=t.dist<1?Math.round(t.dist*1000)+' m':t.dist.toFixed(1)+' km';
    const mins=Math.round((now-t.created)/60000);
    const age=mins<60?'vor '+mins+' Min':'vor '+Math.round(mins/60)+' Std';
    html+='<div class="card turnier-tisch-card" style="cursor:pointer;padding:10px;margin-bottom:6px;border:1px solid var(--bdr)" onclick="loadJoinTurnierInfo(\''+t.code+'\',null)">'
      +'<div style="display:flex;justify-content:space-between;align-items:center">'
      +'<div style="font-weight:600;font-size:14px">'+(t.name?t.name:'DK-'+t.code)+'</div>'
      +'<div style="font-size:11px;color:var(--tx3)">'+dist+'</div></div>'
      +'<div style="font-size:11px;color:var(--tx3);margin-top:2px">DK-'+t.code+' · '+age+'</div></div>';
  });
  box.innerHTML=html;
  // Code-Feld bei Auswahl mitfüllen
  box.querySelectorAll('[onclick^="loadJoinTurnierInfo"]').forEach(el=>{
    el.addEventListener('click',()=>{const ci=document.getElementById('joinCodeInput');if(ci){const m=el.getAttribute('onclick').match(/'(\d{4})'/);if(m)ci.value=m[1];}});
  });
}

// ── In-App QR-Scanner ──
let qrStream=null, qrRaf=null;
export async function openQrScanner(){
  const modal=document.getElementById('qrScanModal');
  const video=document.getElementById('qrVideo');
  if(!modal||!video)return;
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){showToast('Kamera nicht verfügbar.','error');return}
  modal.classList.add('show');
  try{
    qrStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
  }catch(e){showToast('Kamerazugriff verweigert.','error');closeQrScanner();return}
  video.srcObject=qrStream;
  video.setAttribute('playsinline','');
  await video.play().catch(()=>{});
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const tick=()=>{
    if(!qrStream){return}
    if(video.readyState===video.HAVE_ENOUGH_DATA){
      canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      try{
        const img=ctx.getImageData(0,0,canvas.width,canvas.height);
        const res=jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});
        if(res&&res.data){
          const code=parseTurnierCode(res.data);
          if(code){closeQrScanner();openJoinTurnier(code,null);return;}
        }
      }catch(e){}
    }
    qrRaf=requestAnimationFrame(tick);
  };
  qrRaf=requestAnimationFrame(tick);
}
export function closeQrScanner(){
  if(qrRaf){cancelAnimationFrame(qrRaf);qrRaf=null}
  if(qrStream){qrStream.getTracks().forEach(t=>t.stop());qrStream=null}
  const video=document.getElementById('qrVideo');if(video)video.srcObject=null;
  const modal=document.getElementById('qrScanModal');if(modal)modal.classList.remove('show');
}
document.getElementById('qrScanModal')&&document.getElementById('qrScanModal').addEventListener('click',function(e){if(e.target===this)closeQrScanner()});

export async function loadJoinTurnierInfo(code,prefillTisch){
  const el=document.getElementById('joinTurnierInfo');
  if(!el)return;
  if(!initFirebase()){el.innerHTML='';return}
  try{
    const snap=await firebase.database().ref('turniere/DK'+code).get();
    if(!snap.exists()){el.innerHTML='<div style="font-size:12px;color:var(--red)">Turnier nicht gefunden.</div>';joinTurnierConfig=null;joinTurnierData=null;return}
    const data=snap.val();
    if(data.status!=='active'){el.innerHTML='<div style="font-size:12px;color:var(--red)">Turnier ist beendet.</div>';joinTurnierConfig=null;joinTurnierData=null;return}
    joinTurnierConfig=data.config;
    joinTurnierData=data;
    joinSelectedPlayers=[];
    joinSelectedTischId=null;
    await loadSpielerDB();

    // Co-Host-Erkennung: Wenn User in hosts-Liste ist, als Host beitreten
    const deviceId=getDeviceId();
    const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
    const hostsObj=data.hosts||{};
    if(ownSpieler&&hostsObj[ownSpieler.id]&&!(state.turnier&&state.turnier.isHost)){
      el.innerHTML='<div style="font-size:12px;color:var(--grn);margin-bottom:12px">Turnier gefunden! Du bist als Spielleiter eingetragen.</div>'
        +'<button class="btn btn-primary" style="width:100%" onclick="joinAsCoHost(\''+code+'\')">Als Spielleiter beitreten</button>';
      return;
    }

    const tischeObj=data.tische||{};
    const tischArr=Object.entries(tischeObj).map(([id,t])=>({id,...t}));
    tischArr.sort((a,b)=>(a.nummer||99)-(b.nummer||99));

    // Modus 4: Spieler-App – individueller Beitritt
    if(data.config.playerMode===4&&!(state.turnier&&state.turnier.isHost)){
      let html='<div style="font-size:12px;color:var(--grn);margin-bottom:12px">Turnier gefunden!'+(data.name?' <b>'+data.name+'</b>':'')+'</div>';
      if(!ownSpieler){
        html+='<div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Bitte zuerst deinen Namen eingeben um beizutreten.</div>'
          +'<input type="text" id="joinPlayerNameInput" placeholder="Vor- und Nachname" style="width:100%;box-sizing:border-box;font-size:14px;padding:10px;margin-bottom:8px;border:1px solid var(--bdr);border-radius:var(--r-sm);background:var(--bg);color:var(--tx)">'
          +'<button class="btn btn-primary" style="width:100%" onclick="createAndJoinAsPlayer(\''+code+'\')">Registrieren &amp; beitreten</button>';
        el.innerHTML=html;return;
      }
      const teilnehmerIds=data.teilnehmer?Object.keys(data.teilnehmer):[];
      const alreadyJoined=teilnehmerIds.includes(ownSpieler.id);
      html+='<div class="card" style="text-align:center;padding:16px">'
        +'<div style="font-size:14px;font-weight:600;margin-bottom:8px">Hallo, '+(ownSpieler.short||ownSpieler.name)+'!</div>';
      html+='<div style="font-size:13px;color:var(--tx2);margin-bottom:12px">'+(alreadyJoined?'Du bist registriert. Wähle einen Tisch oder tritt ohne Tisch bei.':'Tritt als Spieler bei.')+'</div>';
      if(tischArr.length){
        html+='<div style="text-align:left;margin-top:12px"><div class="section-label">Tisch wählen</div>';
        tischArr.forEach(t=>{
          const spielerNames=(t.spielerIds||[]).map(id=>{const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id}).join(', ');
          const isMember=(t.spielerIds||[]).includes(ownSpieler.id);
          html+='<div class="card turnier-tisch-card" style="cursor:pointer;padding:10px;margin-bottom:6px;border:2px solid '+(isMember?'var(--grn)':'var(--bdr)')+'" onclick="joinAsPlayer(\''+code+'\',\''+t.id+'\',\''+ownSpieler.id+'\')">'
            +'<div style="display:flex;justify-content:space-between"><div style="font-weight:600;font-size:14px">Tisch '+t.nummer+(t.name&&t.name!=='Tisch '+t.nummer?' – '+t.name:'')+'</div>'
            +'<div style="font-size:11px;color:var(--tx3)">'+(t.rounds?t.rounds.length:0)+' Runden</div></div>'
            +'<div style="font-size:12px;color:var(--tx2);margin-top:2px">'+(spielerNames||'Keine Spieler')+(isMember?' <span style="color:var(--grn)">(du)</span>':'')+'</div></div>';
        });
        html+='</div>';
      }else{
        html+='<div style="font-size:13px;color:var(--tx3);margin-top:8px">Noch keine Tische vorhanden.</div>';
      }
      html+='</div>';
      html+='<button class="btn btn-'+(tischArr.length?'secondary':'primary')+'" style="width:100%;margin-top:12px" onclick="registerAsPlayer(\''+code+'\',\''+ownSpieler.id+'\')">Ohne Tisch beitreten</button>';
      el.innerHTML=html;return;
    }

    const usedNummern=tischArr.map(t=>t.nummer).filter(Boolean);
    let nextFree=1;
    while(usedNummern.includes(nextFree))nextFree++;

    let html='<div style="font-size:12px;color:var(--grn);margin-bottom:12px">Turnier gefunden!'+(data.name?' <b>'+data.name+'</b>':'')+'</div>';

    // Vorhandene Tische anzeigen
    if(tischArr.length){
      html+='<div class="section-label">Vorhandene Tische</div>';
      html+='<div style="margin-bottom:12px">';
      tischArr.forEach(t=>{
        const spielerNames=(t.spielerIds||[]).map(id=>{const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id}).join(', ');
        const rounds=t.rounds?t.rounds.length:0;
        html+='<div class="card turnier-tisch-card" style="cursor:pointer;padding:10px;margin-bottom:6px;border:2px solid '+(joinSelectedTischId===t.id?'var(--acc)':'var(--bdr)')+'" onclick="selectJoinTisch(\''+t.id+'\')">'
          +'<div style="display:flex;justify-content:space-between;align-items:center">'
          +'<div style="font-weight:600;font-size:14px">Tisch '+t.nummer+(t.name&&t.name!=='Tisch '+t.nummer?' – '+t.name:'')+'</div>'
          +'<div style="font-size:11px;color:var(--tx3)">'+rounds+' Runden</div></div>'
          +'<div style="font-size:12px;color:var(--tx2);margin-top:2px">'+(spielerNames||'Keine Spieler')+'</div>'
          +'</div>';
      });
      html+='</div>';
      html+='<div style="text-align:center;font-size:12px;color:var(--tx3);margin-bottom:8px">– oder –</div>';
    }

    // Neuen Tisch erstellen
    html+='<div class="section-label">Neuen Tisch erstellen</div>';
    html+='<div style="display:flex;gap:8px;margin-bottom:8px">'
      +'<div style="flex:0 0 80px"><label style="font-size:12px;color:var(--tx2);display:block;margin-bottom:4px">Nummer</label>'
      +'<input type="number" id="joinTischNummer" value="'+(prefillTisch||nextFree)+'" min="1" max="99" style="font-size:14px;padding:10px;width:100%;box-sizing:border-box"></div>'
      +'<div style="flex:1"><label style="font-size:12px;color:var(--tx2);display:block;margin-bottom:4px">Name (optional)</label>'
      +'<input type="text" id="joinTischName" placeholder="z.B. Küche, Wohnzimmer..." style="font-size:14px;padding:10px;width:100%;box-sizing:border-box"></div></div>';

    // Tischnummer-Eingabe deselektiert vorhandenen Tisch
    html+='<div id="joinPlayerSelect" style="margin-bottom:12px"></div>';
    html+='<button class="btn btn-primary" style="width:100%" onclick="joinTurnier()">Beitreten</button>';
    el.innerHTML=html;

    // Event: Nummer-Eingabe deselektiert bestehenden Tisch
    const numInput=document.getElementById('joinTischNummer');
    if(numInput)numInput.addEventListener('input',function(){joinSelectedTischId=null;loadJoinTurnierInfo(code,null)});

    // Spieler-Auswahl laden (nur für neuen Tisch, nicht Modus 3)
    renderJoinPlayerSelect(data);

    // Auto-pre-select eigenen Spieler
    autoPreselectOwnPlayer();
  }catch(e){
    console.error('loadJoinTurnierInfo error:',e);
    el.innerHTML='<div style="font-size:12px;color:var(--red)">Fehler beim Laden.</div>';
  }
}

export function selectJoinTisch(tischId){
  joinSelectedTischId=tischId;
  document.querySelectorAll('#joinTurnierInfo .turnier-tisch-card').forEach(el=>{
    el.style.borderColor=el.getAttribute('onclick').includes("'"+tischId+"'")?'var(--acc)':'var(--bdr)';
  });
  const playerEl=document.getElementById('joinPlayerSelect');
  if(playerEl)playerEl.style.display='none';
}

export function renderJoinPlayerSelect(data){
  const el=document.getElementById('joinPlayerSelect');
  if(!el)return;
  if(data.config.playerMode===3){
    el.innerHTML='<div style="font-size:12px;color:var(--tx3)">Freie Spielereingabe – nutze deine lokale Spielerliste.</div>';
    return;
  }
  const teilnehmerIds=data.teilnehmer?Object.keys(data.teilnehmer):[];
  const tische=data.tische?Object.values(data.tische):[];
  const usedIds=new Set();
  tische.forEach(t=>{if(t.spielerIds)t.spielerIds.forEach(id=>usedIds.add(id))});
  const available=spielerCache.filter(s=>teilnehmerIds.includes(s.id));
  let html='<label style="font-size:12px;color:var(--tx2);display:block;margin-bottom:4px">Spieler an diesem Tisch (4 wählen)</label>';
  html+='<div id="joinPlayerList">';
  available.forEach(s=>{
    const used=usedIds.has(s.id);
    const sel=joinSelectedPlayers.includes(s.id);
    html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid var(--bdr);'+(used?'opacity:.4;':'cursor:pointer;')+'background:'+(sel?'var(--bg3)':'transparent')+'" '
      +(used?'title="Bereits an anderem Tisch"':'onclick="toggleJoinPlayer(\''+s.id+'\')"')+' data-pid="'+s.id+'">'
      +'<span style="font-size:13px">'+s.name+(used?' (vergeben)':'')+'</span>'
      +'<span class="join-check" style="font-size:18px;color:'+(sel?'var(--grn)':'var(--tx3)')+'">'+( sel?'&#10003;':'&#43;')+'</span></div>';
  });
  html+='</div>';
  if(data.config.playerMode===2){
    html+='<button class="btn btn-secondary" style="margin-top:8px;font-size:12px;padding:6px 12px" onclick="openAddPlayerDialog(\'join\')">+ Spieler</button>';
  }
  el.innerHTML=html;
}

export function autoPreselectOwnPlayer(){
  const deviceId=getDeviceId();
  const own=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
  if(own&&!joinSelectedPlayers.includes(own.id)){
    joinSelectedPlayers.push(own.id);
    const el=document.querySelector('#joinPlayerList [data-pid="'+own.id+'"]');
    if(el){
      el.style.background='var(--bg3)';
      const check=el.querySelector('.join-check');
      if(check){check.innerHTML='&#10003;';check.style.color='var(--grn)'}
    }
  }
}

export function toggleJoinPlayer(id){
  const idx=joinSelectedPlayers.indexOf(id);
  if(idx>=0){joinSelectedPlayers.splice(idx,1)}
  else{joinSelectedPlayers.push(id)}
  document.querySelectorAll('#joinPlayerList [data-pid]').forEach(el=>{
    const pid=el.dataset.pid;
    const sel=joinSelectedPlayers.includes(pid);
    const check=el.querySelector('.join-check');
    if(check){check.innerHTML=sel?'&#10003;':'&#43;';check.style.color=sel?'var(--grn)':'var(--tx3)'}
    el.style.background=sel?'var(--bg3)':'transparent';
  });
  // Deselect existing table when choosing players for new table
  joinSelectedTischId=null;
  document.querySelectorAll('#joinTurnierInfo .turnier-tisch-card').forEach(el=>{el.style.borderColor='var(--bdr)'});
}


export function joinAsCoHost(code){
  state.turnier={code:code,tischId:null,tischName:null,tischNummer:null,isHost:true,isPlayer:false,turnierName:joinTurnierData&&joinTurnierData.name||null};
  save();
  closeJoinTurnier();
  renderTurnierSetup();renderTurnierIndicator();
  showToast('Als Spielleiter beigetreten!','info');
  openTurnierDashboard();
}

export function syncTischPlayersToSetup(spielerIds){
  spielerIds.forEach(id=>{
    const s=spielerCache.find(s=>s.id===id);
    if(!s)return;
    const name=s.short||s.name;
    if(!state.players.includes(name)){
      state.players.push(name);
      if(!state.knownNames.includes(name))state.knownNames.push(name);
    }
  });
  save();renderPlayerTags();
}
export async function restoreTischPlayers(){
  if(!state.turnier||!state.turnier.tischId)return;
  if(!initFirebase())return;
  try{
    await loadSpielerDB();
    const snap=await firebase.database().ref('turniere/DK'+state.turnier.code+'/tische/'+state.turnier.tischId+'/spielerIds').get();
    if(snap.exists()){
      const ids=snap.val();
      if(Array.isArray(ids)&&ids.length===0){
        state.turnier.tischId=null;state.turnier.tischName=null;state.turnier.tischNummer=null;
        save();renderTurnierSetup();renderTurnierIndicator();
        return;
      }
      syncTischPlayersToSetup(ids);
    }
  }catch(e){console.warn('restoreTischPlayers:',e)}
}

export async function registerAsPlayer(code,spielerId){
  if(!initFirebase())return;
  try{
    await firebase.database().ref('turniere/DK'+code+'/teilnehmer/'+spielerId).set(true);
    state.turnier={code:code,tischId:null,tischName:null,tischNummer:null,isHost:false,isPlayer:true,turnierName:joinTurnierData&&joinTurnierData.name||null,schreiberId:null};
    save();
    closeJoinTurnier();
    renderTurnierSetup();renderTurnierIndicator();
    showToast('Du nimmst am Turnier DK-'+code+' teil!','info');
  }catch(e){showToast('Fehler: '+e.message,'error')}
}

export async function createAndJoinAsPlayer(code){
  const nameInput=document.getElementById('joinPlayerNameInput');
  if(!nameInput)return;
  const name=nameInput.value.trim();
  if(!name){showToast('Bitte Namen eingeben.','error');return}
  const spieler=await createSpieler(name);
  if(!spieler){showToast('Fehler beim Erstellen.','error');return}
  await registerAsPlayer(code,spieler.id);
}

export async function joinAsPlayer(code,tischId,spielerId){
  if(!initFirebase())return;
  try{
    // Vom alten Tisch entfernen falls vorhanden
    if(state.turnier&&state.turnier.tischId&&state.turnier.tischId!==tischId){
      const oldRef=firebase.database().ref('turniere/DK'+code+'/tische/'+state.turnier.tischId+'/spielerIds');
      const oldSnap=await oldRef.get();
      if(oldSnap.exists()){
        const oldIds=(oldSnap.val()||[]).filter(id=>id!==spielerId);
        await oldRef.set(oldIds);
      }
    }
    const tischRef=firebase.database().ref('turniere/DK'+code+'/tische/'+tischId);
    const snap=await tischRef.get();
    const tisch=snap.val();
    if(!tisch){showToast('Tisch nicht gefunden.','error');return}
    const spielerIds=tisch.spielerIds||[];
    if(!spielerIds.includes(spielerId)){
      if(spielerIds.length>=4){showToast('Tisch ist voll (4 Spieler).','error');return}
      spielerIds.push(spielerId);
      await tischRef.child('spielerIds').set(spielerIds);
    }
    await firebase.database().ref('turniere/DK'+code+'/teilnehmer/'+spielerId).set(true);
    const wasHost=state.turnier&&state.turnier.isHost;
    state.turnier={code:code,tischId:tischId,tischName:tisch.name||('Tisch '+tisch.nummer),tischNummer:tisch.nummer,isHost:!!wasHost,isPlayer:true,turnierName:(joinTurnierData&&joinTurnierData.name)||(state.turnier&&state.turnier.turnierName)||null,schreiberId:tisch.schreiberId||null};
    save();
    closeJoinTurnier();closeTurnierDashboard();
    renderTurnierSetup();renderTurnierIndicator();
    syncTischPlayersToSetup(spielerIds);
    showToast('Tisch '+(tisch.nummer||'')+' beigetreten!','info');
  }catch(e){showToast('Fehler: '+e.message,'error')}
}

export async function openPlayerTischWahl(){
  if(!state.turnier)return;
  if(!initFirebase())return;
  document.getElementById('turnierModal').classList.add('show');
  const el=document.getElementById('turnierModalContent');
  el.innerHTML='<div style="text-align:center;padding:32px;color:var(--tx3)">Lade Tische...</div>';
  const snap=await firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').get();
  const tische=snap.val()||{};
  await loadSpielerDB();
  const deviceId=getDeviceId();
  const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
  if(!ownSpieler){showToast('Spieler nicht gefunden. Bitte zuerst im Setup einen Namen eingeben.','error');return}
  const code=state.turnier.code;
  const tischArr=Object.entries(tische).map(([id,t])=>({id,...t}));
  tischArr.sort((a,b)=>(a.nummer||99)-(b.nummer||99));

  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">'+(state.turnier.tischId?'Tisch wechseln':'Tisch beitreten')+'</h3>'
    +'<button onclick="closeTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  if(!tischArr.length){
    html+='<div class="card" style="text-align:center;color:var(--tx3);padding:24px;margin-top:12px">Noch keine Tische vorhanden.</div>';
  }else{
    html+='<div style="font-size:13px;color:var(--tx2);margin:12px 0">Wähle einen Tisch.</div>';
    tischArr.forEach(t=>{
      const spielerNames=(t.spielerIds||[]).map(id=>{const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id}).join(', ');
      const count=(t.spielerIds||[]).length;
      const isFull=count>=4;
      const alreadyHere=(t.spielerIds||[]).includes(ownSpieler.id);
      html+='<div class="card turnier-tisch-card" style="cursor:'+(isFull&&!alreadyHere?'not-allowed':'pointer')+';padding:12px;margin-bottom:8px;border:2px solid '+(alreadyHere?'var(--grn)':'var(--bdr)')+';'+(isFull&&!alreadyHere?'opacity:.5':'')+'" '
        +(isFull&&!alreadyHere?'':'onclick="joinAsPlayer(\''+code+'\',\''+t.id+'\',\''+ownSpieler.id+'\')"')+'>'
        +'<div style="display:flex;justify-content:space-between"><div style="font-weight:600">'+(t.name||'Tisch '+t.nummer)+'</div>'
        +'<div style="font-size:12px;color:var(--tx3)">'+count+'/4</div></div>'
        +'<div style="font-size:12px;color:var(--tx2);margin-top:2px">'+(spielerNames||'Noch leer')+(alreadyHere?' (du)':'')+'</div></div>';
    });
  }
  el.innerHTML=html;
}

export async function joinTurnier(){
  const code=document.getElementById('joinCodeInput').value.trim();
  if(!/^\d{4}$/.test(code)){showToast('Bitte 4-stelligen Code eingeben.','error');return}
  if(!initFirebase()){showToast('Firebase nicht verfügbar.','error');return}

  // Einem vorhandenen Tisch beitreten
  if(joinSelectedTischId&&joinTurnierData){
    const tischObj=joinTurnierData.tische||{};
    const tisch=tischObj[joinSelectedTischId];
    if(!tisch){showToast('Tisch nicht mehr vorhanden.','error');return}
    const wasHost=state.turnier&&state.turnier.isHost;
    const tischRounds=Array.isArray(tisch.rounds)?tisch.rounds:[];
    const deviceId=getDeviceId();
    const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
    let schreiberId=tisch.schreiberId||null;
    if(tischRounds.length>0){
      // Tisch hat bereits ein Spiel -> laden, damit du das Tisch-Spiel siehst
      let load=true;
      if(state.rounds.length>0){
        load=await showConfirm('Dieser Tisch hat bereits ein Spiel ('+tischRounds.length+' Runde'+(tischRounds.length>1?'n':'')+'). Laden? Dein aktuelles lokales Spiel wird dabei ersetzt.','Tisch-Spiel laden',true);
      }
      if(load){state.rounds=JSON.parse(JSON.stringify(tischRounds));invalidateEingabeCache();}
    }else if(state.rounds.length>0){
      // Leerer Tisch + laufendes Spiel -> anbieten zu übernehmen (du wirst Schreiber)
      const carry=await showConfirm('Dieser Tisch hat noch kein Spiel. Dein laufendes Spiel ('+state.rounds.length+' Runde'+(state.rounds.length>1?'n':'')+') hierher übernehmen?','Übernehmen');
      if(carry){
        schreiberId=ownSpieler?ownSpieler.id:schreiberId;
        try{await firebase.database().ref('turniere/DK'+code+'/tische/'+joinSelectedTischId).update({rounds:state.rounds,schreiberId:schreiberId,lastSync:firebase.database.ServerValue.TIMESTAMP});}
        catch(e){console.warn('carry to tisch:',e)}
      }
    }
    state.turnier={code:code,tischId:joinSelectedTischId,tischName:tisch.name||('Tisch '+tisch.nummer),tischNummer:tisch.nummer,isHost:!!wasHost,isPlayer:false,turnierName:joinTurnierData&&joinTurnierData.name||null,schreiberId:schreiberId};
    syncTischPlayersToSetup(tisch.spielerIds||[]);
    save();
    closeJoinTurnier();
    renderTurnierSetup();renderTurnierIndicator();
    showToast('Turnier DK-'+code+' beigetreten ('+state.turnier.tischName+')!','info');
    return;
  }

  // Neuen Tisch erstellen
  const tischNummer=parseInt(document.getElementById('joinTischNummer').value)||0;
  const tischName=document.getElementById('joinTischName').value.trim()||('Tisch '+tischNummer);
  if(!tischNummer){showToast('Bitte Tischnummer eingeben.','error');return}

  try{
    const turnierRef=firebase.database().ref('turniere/DK'+code);
    const snap=await turnierRef.get();
    if(!snap.exists()){showToast('Turnier nicht gefunden.','error');return}
    const turnierData=snap.val();
    if(turnierData.status!=='active'){showToast('Turnier ist beendet.','error');return}

    // Prüfe ob Tischnummer schon vergeben ist
    const tischeObj=turnierData.tische||{};
    const nummerVergeben=Object.values(tischeObj).some(t=>t.nummer===tischNummer);
    if(nummerVergeben){showToast('Tisch '+tischNummer+' existiert bereits. Bitte andere Nummer wählen.','error');return}

    const config=turnierData.config;
    let spielerIds=[];
    if(config.playerMode===3){
      spielerIds=getAllPlayers();
    }else{
      if(!joinSelectedPlayers.length){showToast('Bitte mindestens einen Spieler wählen.','error');return}
      spielerIds=joinSelectedPlayers.slice();
    }

    // Bestehende lokale Runden übernehmen?
    let rounds=[];
    if(state.rounds.length>0){
      const useExisting=await showConfirm('Du hast '+state.rounds.length+' Runde'+(state.rounds.length>1?'n':'')+' eingetragen. Sollen diese für den Tisch übernommen werden?','Übernehmen');
      if(useExisting)rounds=state.rounds;
    }

    const deviceId=getDeviceId();
    const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
    const schreiberId=ownSpieler?ownSpieler.id:(spielerIds[0]||'');
    const tischRef=turnierRef.child('tische').push();
    const tischId=tischRef.key;
    await tischRef.set({
      name:tischName,
      nummer:tischNummer,
      spielerIds:spielerIds,
      schreiberId:schreiberId,
      rounds:rounds.length?rounds:[],
      lastSync:firebase.database.ServerValue.TIMESTAMP
    });
    await turnierRef.update({lastActivity:firebase.database.ServerValue.TIMESTAMP});
    const wasHost=state.turnier&&state.turnier.isHost;
    state.turnier={code:code,tischId:tischId,tischName:tischName,tischNummer:tischNummer,isHost:!!wasHost,isPlayer:false,turnierName:turnierData.name||null,schreiberId:schreiberId};
    syncTischPlayersToSetup(spielerIds);
    closeJoinTurnier();
    renderTurnierSetup();renderTurnierIndicator();
    showToast('Turnier DK-'+code+' beigetreten (Tisch '+tischNummer+')!','info');
  }catch(e){
    console.error('joinTurnier error:',e);
    showToast('Fehler: '+e.message,'error');
  }
}

export function syncToFirebase(){
  if(!state.turnier||!state.turnier.tischId)return;
  // Nur Schreiber (oder Host) darf syncen
  if(state.turnier.schreiberId&&!state.turnier.isHost){
    const deviceId=getDeviceId();
    const own=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
    if(own&&own.id!==state.turnier.schreiberId)return;
  }
  if(!initFirebase())return;
  const ref=firebase.database().ref('turniere/DK'+state.turnier.code+'/tische/'+state.turnier.tischId);
  ref.update({
    spielerIds:getAllPlayers(),
    rounds:state.rounds,
    lastSync:firebase.database.ServerValue.TIMESTAMP
  }).then(()=>{
    firebase.database().ref('turniere/DK'+state.turnier.code+'/lastActivity').set(firebase.database.ServerValue.TIMESTAMP);
  }).catch(e=>console.error('Sync error:',e));
}

let turnierConfigCache=null;
let dashboardTab='tische';
let lastTischeSnapshot={};
let rotationenCache=null;
let zuweisungData={tische:{},spielerZuweisung:{}};
let zuweisungActiveTisch=null;
export async function openTurnierDashboard(){
  if(!state.turnier)return;
  if(!initFirebase()){showToast('Firebase nicht verfügbar.','error');return}
  document.getElementById('turnierModal').classList.add('show');
  renderTurnierDashboard({});
  try{
    const cs=await firebase.database().ref('turniere/DK'+state.turnier.code+'/config').get();
    turnierConfigCache=cs.val();
  }catch(e){}
  try{
    const rs=await firebase.database().ref('turniere/DK'+state.turnier.code+'/rotationen').get();
    rotationenCache=rs.val();
  }catch(e){rotationenCache=null}
  if(turnierListener){
    firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').off('value',turnierListener);
  }
  turnierListener=firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').on('value',snap=>{
    lastTischeSnapshot=snap.val()||{};
    renderTurnierDashboard(lastTischeSnapshot);
  });
}

export function closeTurnierDashboard(){
  document.getElementById('turnierModal').classList.remove('show');
  if(turnierListener&&state.turnier){
    firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').off('value',turnierListener);
    turnierListener=null;
  }
}
document.getElementById('turnierModal').addEventListener('click',function(e){if(e.target===this)closeTurnierDashboard()});

// Setter fuer onclick (Variablen sind modul-lokal, nicht global)
export function dashboardSetTab(tab){dashboardTab=tab;renderTurnierDashboard(lastTischeSnapshot)}
export function zuweisungSetTisch(id){zuweisungActiveTisch=id;renderZuweisung()}

export function renderTurnierDashboard(tische){
  const el=document.getElementById('turnierModalContent');
  if(!state.turnier)return;
  const code=state.turnier.code;
  const config=turnierConfigCache;
  const isRotation=config&&config.tableMode==='rotation';
  let tischArr=Object.entries(tische).map(([id,t])=>({id,...t}));
  const canSeeAll=state.turnier.isHost||(config&&config.playersVisible);
  if(!canSeeAll&&state.turnier.tischId){
    tischArr=tischArr.filter(t=>t.id===state.turnier.tischId);
  }
  const totalRounds=tischArr.reduce((s,t)=>s+(t.rounds?t.rounds.length:0),0);

  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">'+(state.turnier.turnierName||'Turnier DK-'+code)+'</h3>'
    +'<div style="display:flex;gap:6px">';
  if(state.turnier.isHost){
    html+='<button onclick="openCoHostSelect()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" title="Admins verwalten">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></button>';
  }
  html+='<button onclick="showTurnierQRCodes()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" title="Tisch-QR-Codes">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/></svg></button>'
    +'<button onclick="closeTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div></div>';

  // Tab-Navigation
  html+='<div class="turnier-tabs">'
    +'<button class="turnier-tab'+(dashboardTab==='tische'?' active':'')+'" onclick="dashboardSetTab(\'tische\')">Tische</button>'
    +'<button class="turnier-tab'+(dashboardTab==='gesamt'?' active':'')+'" onclick="dashboardSetTab(\'gesamt\')">Gesamtwertung</button>';
  if(isRotation){
    html+='<button class="turnier-tab'+(dashboardTab==='historie'?' active':'')+'" onclick="dashboardSetTab(\'historie\')">Historie</button>';
  }
  html+='</div>';

  html+='<div style="font-size:13px;color:var(--tx2);margin:12px 0">'+tischArr.length+' Tisch'+(tischArr.length!==1?'e':'')+' &middot; '+totalRounds+' Spiele gesamt</div>';

  function nameOf(id){const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id}

  if(dashboardTab==='tische'){
    // Auto-Rotation Trigger Banner
    if(isRotation&&state.turnier.isHost&&config.rotationTrigger==='afterRounds'){
      const targetRounds=config.rotationAfterRounds||4;
      const allReady=tischArr.length>0&&tischArr.every(t=>(t.rounds||[]).length>=targetRounds);
      if(allReady){
        html+='<div class="card" style="background:color-mix(in srgb,var(--acc) 10%,var(--bg));border:1px solid var(--acc);padding:12px;margin-bottom:12px;text-align:center">'
          +'<div style="font-weight:600;color:var(--acc);margin-bottom:6px">Alle Tische haben '+targetRounds+' Runden gespielt!</div>'
          +'<button class="btn btn-primary" onclick="startRotation()">Rotation jetzt starten</button></div>';
      }else{
        const minRounds=tischArr.reduce((m,t)=>Math.min(m,(t.rounds||[]).length),Infinity);
        if(tischArr.length)html+='<div style="font-size:11px;color:var(--tx3);margin-bottom:8px;text-align:center">Rotation nach '+targetRounds+' Runden (aktuell langsamster Tisch: '+minRounds+')</div>';
      }
    }
    if(!tischArr.length){
      html+='<div class="card" style="text-align:center;color:var(--tx3);padding:32px">Noch keine Tische beigetreten.</div>';
    }else{
      tischArr.sort((a,b)=>(a.nummer||99)-(b.nummer||99));
      tischArr.forEach(t=>{
        const rounds=t.rounds||[];
        const spielerIds=t.spielerIds||[];
        let leader='\u2013';let leaderPts=0;
        if(rounds.length&&spielerIds.length){
          const totals={};spielerIds.forEach(p=>totals[p]=0);
          rounds.forEach(r=>{if(r.scores){spielerIds.forEach(p=>{totals[p]+=(r.scores[p]||0)})}});
          const sorted=spielerIds.slice().sort((a,b)=>(totals[b]||0)-(totals[a]||0));
          leader=nameOf(sorted[0]);leaderPts=totals[sorted[0]]||0;
        }
        const spielerNames=spielerIds.map(id=>nameOf(id)).join(', ');
        const syncTime=t.lastSync?new Date(t.lastSync).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'\u2013';
        html+='<div class="card turnier-tisch-card" style="cursor:pointer" onclick="showTurnierDetail(\''+t.id+'\')">'
          +'<div style="display:flex;justify-content:space-between;align-items:center">'
          +'<div style="font-weight:600;font-size:15px">'+(t.name||'Tisch '+(t.nummer||'?'))+'</div>'
          +'<div style="font-size:11px;color:var(--tx3)">'+syncTime+'</div></div>'
          +'<div style="font-size:12px;color:var(--tx3);margin-top:2px">'+(spielerNames||'Keine Spieler')+'</div>'
          +'<div style="font-size:13px;color:var(--tx2);margin-top:2px">'
          +(rounds.length?leader+': '+leaderPts+' Pkt. &middot; '+rounds.length+' Runden':'Noch keine Runden')
          +'</div></div>';
      });
    }
    // Rotation starten Button
    if(isRotation&&state.turnier.isHost){
      html+='<div style="margin-top:16px;display:flex;gap:8px">'
        +'<button class="btn btn-primary" style="flex:1" onclick="startRotation()">Rotation starten</button></div>';
    }

  }else if(dashboardTab==='gesamt'){
    // Gesamtwertung: Punkte über alle Tische + vergangene Rotationen
    const playerTotals={};
    tischArr.forEach(t=>{
      const rounds=t.rounds||[];
      const spielerIds=t.spielerIds||[];
      rounds.forEach(r=>{
        if(!r.scores)return;
        spielerIds.forEach(id=>{
          if(!playerTotals[id])playerTotals[id]={pts:0,rounds:0,wins:0};
          playerTotals[id].pts+=(r.scores[id]||0);
          playerTotals[id].rounds++;
          if((r.winners||[]).includes(id))playerTotals[id].wins++;
        });
      });
    });
    if(rotationenCache){
      Object.values(rotationenCache).forEach(rot=>{
        if(!rot.tische)return;
        Object.values(rot.tische).forEach(snap=>{
          const rounds=snap.rounds||[];
          const spielerIds=snap.spielerIds||[];
          rounds.forEach(r=>{
            if(!r.scores)return;
            spielerIds.forEach(id=>{
              if(!playerTotals[id])playerTotals[id]={pts:0,rounds:0,wins:0};
              playerTotals[id].pts+=(r.scores[id]||0);
              playerTotals[id].rounds++;
              if((r.winners||[]).includes(id))playerTotals[id].wins++;
            });
          });
        });
      });
    }
    const sorted=Object.entries(playerTotals).sort((a,b)=>b[1].pts-a[1].pts);
    if(!sorted.length){
      html+='<div class="card" style="text-align:center;color:var(--tx3);padding:24px">Noch keine Runden gespielt.</div>';
    }else{
      if(sorted.length>=3){
        html+='<div style="display:flex;align-items:flex-end;justify-content:center;gap:8px;margin:16px 0 20px">';
        [1,0,2].forEach(idx=>{
          if(idx>=sorted.length)return;
          const [id,d]=sorted[idx];
          const displayName=nameOf(id);
          const col=d.pts>0?'var(--grn)':d.pts<0?'var(--red)':'var(--tx2)';
          const heights=['120px','90px','70px'];
          const medals=['1.','2.','3.'];
          html+='<div style="text-align:center;width:80px">'
            +'<div style="font-size:11px;color:var(--tx3)">'+medals[idx]+'</div>'
            +'<div style="font-size:13px;font-weight:600;margin:2px 0">'+displayName+'</div>'
            +'<div style="font-size:18px;font-weight:700;color:'+col+'">'+d.pts+'</div>'
            +'<div style="background:var(--bg3);border-radius:var(--r-sm) var(--r-sm) 0 0;height:'+heights[idx]+';margin-top:4px"></div>'
            +'</div>';
        });
        html+='</div>';
      }
      html+='<div class="card" style="overflow:hidden">';
      sorted.forEach(([id,d],i)=>{
        const displayName=nameOf(id);
        const col=d.pts>0?'var(--grn)':d.pts<0?'var(--red)':'var(--tx2)';
        const avg=d.rounds?Math.round(d.pts/d.rounds*10)/10:0;
        html+='<div style="display:flex;align-items:center;padding:8px 12px;font-size:13px'+(i<sorted.length-1?';border-bottom:1px solid var(--bdr)':'')+'">'
          +'<span style="width:24px;color:var(--tx3);font-weight:600">#'+(i+1)+'</span>'
          +'<span style="flex:1;font-weight:500">'+displayName+'</span>'
          +'<span style="width:50px;text-align:right;font-size:11px;color:var(--tx3)">'+d.rounds+' R</span>'
          +'<span style="width:45px;text-align:right;font-size:11px;color:var(--tx3)">'+avg+'/R</span>'
          +'<span style="width:50px;text-align:right;font-weight:600;color:'+col+'">'+d.pts+'</span>'
          +'</div>';
      });
      html+='</div>';
    }

  }else if(dashboardTab==='historie'){
    if(!rotationenCache||!Object.keys(rotationenCache).length){
      html+='<div class="card" style="text-align:center;color:var(--tx3);padding:24px">Noch keine Rotationen durchgeführt.</div>';
    }else{
      const rotArr=Object.entries(rotationenCache).sort((a,b)=>parseInt(b[0])-parseInt(a[0]));
      rotArr.forEach(([rotNr,rot])=>{
        const isActive=rot.status==='active';
        const startDate=rot.startedAt?new Date(rot.startedAt).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'\u2013';
        html+='<div class="section-label" style="margin-top:12px">Runde '+(parseInt(rotNr)+1)+(isActive?' (aktiv)':'')+' \u00b7 '+startDate+'</div>';
        if(!rot.tische){
          html+='<div class="card" style="font-size:13px;color:var(--tx3)">Keine Tisch-Daten</div>';
          return;
        }
        const tischSnaps=Object.values(rot.tische);
        tischSnaps.sort((a,b)=>(a.nummer||99)-(b.nummer||99));
        tischSnaps.forEach(snap=>{
          const spielerNames=(snap.spielerIds||[]).map(id=>nameOf(id)).join(', ');
          const rounds=snap.rounds||[];
          let leader='\u2013';let leaderPts=0;
          if(rounds.length&&snap.spielerIds&&snap.spielerIds.length){
            const totals={};snap.spielerIds.forEach(p=>totals[p]=0);
            rounds.forEach(r=>{if(r.scores){snap.spielerIds.forEach(p=>{totals[p]+=(r.scores[p]||0)})}});
            const srt=snap.spielerIds.slice().sort((a,b)=>(totals[b]||0)-(totals[a]||0));
            leader=nameOf(srt[0]);leaderPts=totals[srt[0]]||0;
          }
          html+='<div class="card" style="padding:10px;margin-bottom:6px">'
            +'<div style="font-weight:600;font-size:14px">'+(snap.name||'Tisch '+(snap.nummer||'?'))+'</div>'
            +'<div style="font-size:12px;color:var(--tx2);margin-top:2px">'+spielerNames+'</div>';
          if(rounds.length){
            html+='<div style="font-size:12px;color:var(--tx3);margin-top:2px">'+leader+': '+leaderPts+' Pkt. \u00b7 '+rounds.length+' Runden</div>';
          }
          html+='</div>';
        });
      });
    }
  }
  el.innerHTML=html;
}

export async function startRotation(){
  if(!state.turnier||!state.turnier.isHost)return;
  if(!initFirebase())return;
  const config=turnierConfigCache;
  if(!config||config.tableMode!=='rotation')return;
  if(!await showConfirm('Rotation starten? Die aktuelle Tischbesetzung wird gespeichert und Spieler wechseln die Tische.','Rotation starten'))return;

  const turnierRef=firebase.database().ref('turniere/DK'+state.turnier.code);
  const snap=await turnierRef.get();
  const data=snap.val();
  const tische=data.tische||{};
  const currentRot=data.currentRotation||0;

  const snapshot={};
  Object.entries(tische).forEach(([id,t])=>{
    snapshot[id]={spielerIds:t.spielerIds||[],nummer:t.nummer,name:t.name||null,rounds:t.rounds||[]};
  });

  const updates={};
  updates['rotationen/'+currentRot+'/status']='ended';
  updates['rotationen/'+currentRot+'/endedAt']=firebase.database.ServerValue.TIMESTAMP;
  updates['rotationen/'+currentRot+'/tische']=snapshot;

  const nextRot=currentRot+1;
  updates['rotationen/'+nextRot+'/status']='active';
  updates['rotationen/'+nextRot+'/startedAt']=firebase.database.ServerValue.TIMESTAMP;
  updates['currentRotation']=nextRot;
  updates['lastActivity']=firebase.database.ServerValue.TIMESTAMP;

  await turnierRef.update(updates);

  // rotationenCache aktualisieren
  try{
    const rs=await firebase.database().ref('turniere/DK'+state.turnier.code+'/rotationen').get();
    rotationenCache=rs.val();
  }catch(e){}

  if(config.rotationType==='host'){
    openTischZuweisung(tische);
  }else{
    const clearUpdates={};
    Object.keys(tische).forEach(id=>{
      clearUpdates['tische/'+id+'/spielerIds']=[];
      clearUpdates['tische/'+id+'/rounds']=[];
    });
    await turnierRef.update(clearUpdates);
    if(state.turnier.tischId){
      state.turnier.tischId=null;state.turnier.tischName=null;state.turnier.tischNummer=null;
      save();renderTurnierSetup();renderTurnierIndicator();
    }
    showToast('Rotation gestartet! Spieler können jetzt neue Tische wählen.','info');
  }
}

export function openTischZuweisung(tische){
  const el=document.getElementById('turnierModalContent');
  const tischArr=Object.entries(tische).map(([id,t])=>({id,...t}));
  tischArr.sort((a,b)=>(a.nummer||99)-(b.nummer||99));
  const allSpieler=new Set();
  tischArr.forEach(t=>(t.spielerIds||[]).forEach(id=>allSpieler.add(id)));
  zuweisungData={tische:{},spielerZuweisung:{}};
  tischArr.forEach(t=>{zuweisungData.tische[t.id]={id:t.id,nummer:t.nummer,name:t.name}});
  allSpieler.forEach(id=>{zuweisungData.spielerZuweisung[id]=null});
  zuweisungActiveTisch=null;
  renderZuweisung();
}

export function renderZuweisung(){
  const el=document.getElementById('turnierModalContent');
  const tischArr=Object.values(zuweisungData.tische).sort((a,b)=>(a.nummer||99)-(b.nummer||99));
  const allSpieler=Object.keys(zuweisungData.spielerZuweisung);
  function nameOf(id){const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id}

  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">Tisch-Zuweisung</h3>'
    +'<div style="font-size:12px;color:var(--tx3)">Tippe Tisch, dann Spieler</div></div>';

  const unassigned=allSpieler.filter(id=>!zuweisungData.spielerZuweisung[id]);
  if(unassigned.length){
    html+='<div class="section-label" style="margin-top:12px">Nicht zugewiesen ('+unassigned.length+')</div><div style="margin-bottom:12px">';
    unassigned.forEach(id=>{
      html+='<span class="zuweisung-chip" onclick="assignSpieler(\''+id+'\')">'+nameOf(id)+'</span>';
    });
    html+='</div>';
  }

  html+='<div class="section-label">Tische</div>';
  tischArr.forEach(t=>{
    const assigned=allSpieler.filter(id=>zuweisungData.spielerZuweisung[id]===t.id);
    const isActive=zuweisungActiveTisch===t.id;
    html+='<div class="zuweisung-tisch'+(assigned.length?' has-players':'')+'" style="'+(isActive?'border-color:var(--acc);background:color-mix(in srgb,var(--acc) 5%,transparent)':'')+'" onclick="zuweisungSetTisch(\''+t.id+'\')">'
      +'<div style="font-weight:600;font-size:14px;margin-bottom:6px">'+(t.name||'Tisch '+t.nummer)+' ('+assigned.length+'/4)</div>';
    assigned.forEach(id=>{
      html+='<span class="zuweisung-chip assigned" onclick="event.stopPropagation();unassignSpieler(\''+id+'\')">'+nameOf(id)+' &times;</span>';
    });
    if(!assigned.length)html+='<div style="font-size:12px;color:var(--tx3)">Tippe hier, dann wähle Spieler</div>';
    html+='</div>';
  });

  const allAssigned=!unassigned.length;
  html+='<button class="btn btn-primary" style="width:100%;margin-top:12px'+(allAssigned?'':';opacity:.5;pointer-events:none')+'" onclick="saveTischZuweisung()">Zuweisung speichern'+(allAssigned?'':' ('+unassigned.length+' offen)')+'</button>';
  el.innerHTML=html;
}

export function assignSpieler(spielerId){
  if(!zuweisungActiveTisch){showToast('Bitte zuerst einen Tisch auswählen.','info');return}
  const assigned=Object.values(zuweisungData.spielerZuweisung).filter(t=>t===zuweisungActiveTisch).length;
  if(assigned>=4){showToast('Tisch ist voll (4 Spieler).','error');return}
  zuweisungData.spielerZuweisung[spielerId]=zuweisungActiveTisch;
  renderZuweisung();
}

export function unassignSpieler(spielerId){
  zuweisungData.spielerZuweisung[spielerId]=null;
  renderZuweisung();
}

export async function saveTischZuweisung(){
  if(!state.turnier||!state.turnier.isHost)return;
  if(!initFirebase())return;
  const unassigned=Object.entries(zuweisungData.spielerZuweisung).filter(([id,t])=>!t);
  if(unassigned.length){showToast(unassigned.length+' Spieler noch nicht zugewiesen.','error');return}
  const turnierRef=firebase.database().ref('turniere/DK'+state.turnier.code);
  const updates={};
  Object.keys(zuweisungData.tische).forEach(tischId=>{
    const spielerIds=Object.entries(zuweisungData.spielerZuweisung)
      .filter(([id,t])=>t===tischId).map(([id])=>id);
    updates['tische/'+tischId+'/spielerIds']=spielerIds;
    updates['tische/'+tischId+'/rounds']=[];
  });
  updates['lastActivity']=firebase.database.ServerValue.TIMESTAMP;
  await turnierRef.update(updates);
  showToast('Neue Tischbesetzung gespeichert!','info');
  openTurnierDashboard();
}

export async function openSelfRotationChoice(){
  if(!state.turnier)return;
  if(!initFirebase())return;
  document.getElementById('turnierModal').classList.add('show');
  const el=document.getElementById('turnierModalContent');
  el.innerHTML='<div style="text-align:center;padding:32px;color:var(--tx3)">Lade Tische...</div>';
  const snap=await firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').get();
  const tische=snap.val()||{};
  await loadSpielerDB();
  const deviceId=getDeviceId();
  const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
  if(!ownSpieler){showToast('Spieler nicht gefunden.','error');return}
  const tischArr=Object.entries(tische).map(([id,t])=>({id,...t}));
  tischArr.sort((a,b)=>(a.nummer||99)-(b.nummer||99));

  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">Neuen Tisch wählen</h3>'
    +'<button onclick="closeTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  html+='<div style="font-size:13px;color:var(--tx2);margin:12px 0">Rotation! Wähle deinen neuen Tisch.</div>';
  tischArr.forEach(t=>{
    const spielerNames=(t.spielerIds||[]).map(id=>{const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id}).join(', ');
    const count=(t.spielerIds||[]).length;
    const isFull=count>=4;
    const alreadyHere=(t.spielerIds||[]).includes(ownSpieler.id);
    html+='<div class="card turnier-tisch-card" style="cursor:'+(isFull&&!alreadyHere?'not-allowed':'pointer')+';padding:12px;margin-bottom:8px;border:2px solid '+(alreadyHere?'var(--grn)':'var(--bdr)')+';'+(isFull&&!alreadyHere?'opacity:.5':'')+'" '
      +(isFull&&!alreadyHere?'':'onclick="selfJoinTisch(\''+t.id+'\',\''+ownSpieler.id+'\')"')+'>'
      +'<div style="display:flex;justify-content:space-between"><div style="font-weight:600">'+(t.name||'Tisch '+t.nummer)+'</div>'
      +'<div style="font-size:12px;color:var(--tx3)">'+count+'/4</div></div>'
      +'<div style="font-size:12px;color:var(--tx2);margin-top:2px">'+(spielerNames||'Noch leer')+(alreadyHere?' (du)':'')+'</div></div>';
  });
  el.innerHTML=html;
}

export async function selfJoinTisch(tischId,spielerId){
  if(!initFirebase())return;
  const tischRef=firebase.database().ref('turniere/DK'+state.turnier.code+'/tische/'+tischId);
  const snap=await tischRef.get();
  const tisch=snap.val();
  if(!tisch){showToast('Tisch nicht gefunden.','error');return}
  const spielerIds=tisch.spielerIds||[];
  if(spielerIds.includes(spielerId)){
    state.turnier.tischId=tischId;
    state.turnier.tischName=tisch.name||('Tisch '+tisch.nummer);
    state.turnier.tischNummer=tisch.nummer;
    state.turnier.schreiberId=tisch.schreiberId||null;
    save();closeTurnierDashboard();renderTurnierSetup();renderTurnierIndicator();
    showToast('Mit '+(tisch.name||'Tisch '+tisch.nummer)+' verbunden!','info');
    return;
  }
  if(spielerIds.length>=4){showToast('Tisch ist voll.','error');return}
  spielerIds.push(spielerId);
  await tischRef.child('spielerIds').set(spielerIds);
  state.turnier.tischId=tischId;
  state.turnier.tischName=tisch.name||('Tisch '+tisch.nummer);
  state.turnier.tischNummer=tisch.nummer;
  state.turnier.schreiberId=tisch.schreiberId||null;
  save();closeTurnierDashboard();renderTurnierSetup();renderTurnierIndicator();
  syncTischPlayersToSetup(spielerIds);
  showToast('Tisch '+(tisch.nummer||'')+' beigetreten!','info');
}

export function showTurnierQRCodes(){
  const el=document.getElementById('turnierModalContent');
  const code=state.turnier.code;
  const baseUrl=location.origin+location.pathname;

  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<button onclick="openTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;gap:4px;padding:0 10px;font-size:13px">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="15 18 9 12 15 6"/></svg> Zurück</button>'
    +'<h3 style="margin:0">Tisch-QR-Codes</h3><div style="width:32px"></div></div>';

  // Anzahl basiert auf existierenden Tischen + ein paar Reserve
  const existingCount=Object.keys(lastTischeSnapshot||{}).length;
  const qrCount=Math.max(existingCount+2,4);
  html+='<div style="font-size:12px;color:var(--tx3);margin:12px 0">QR-Codes ausdrucken und auf die Tische legen. Spieler scannen den Code um direkt dem richtigen Tisch beizutreten.</div>';
  for(let i=1;i<=qrCount;i++){
    const url=baseUrl+'?turnier=DK'+code+'&tisch='+i;
    const qrImg=generateQR(url,4);
    html+='<div class="card" style="display:flex;align-items:center;gap:16px;padding:12px">'
      +'<img src="'+qrImg+'" style="width:80px;height:80px;image-rendering:pixelated;border-radius:4px">'
      +'<div><div style="font-weight:600;font-size:15px">Tisch '+i+'</div>'
      +'<div style="font-size:11px;color:var(--tx3);word-break:break-all;margin-top:2px">DK-'+code+' &middot; Tisch '+i+'</div></div></div>';
  }
  el.innerHTML=html;
}

export function archiveTurnier(code){
  try{
    const archiv=JSON.parse(localStorage.getItem('doko-v4-turnierArchiv')||'[]');
    if(!archiv.some(a=>a.code===code)){
      archiv.unshift({code:code,date:new Date().toISOString(),role:state.turnier?state.turnier.isHost?'host':'tisch':'tisch',name:state.turnier&&state.turnier.turnierName||null});
      if(archiv.length>20)archiv.length=20;
      localStorage.setItem('doko-v4-turnierArchiv',JSON.stringify(archiv));
    }
  }catch(e){}
}

export async function showTurnierArchiv(){
  const archiv=JSON.parse(localStorage.getItem('doko-v4-turnierArchiv')||'[]');
  if(!archiv.length){showToast('Keine vergangenen Turniere.','info');return}
  document.getElementById('turnierModal').classList.add('show');
  const el=document.getElementById('turnierModalContent');
  el.innerHTML='<div style="text-align:center;padding:32px;color:var(--tx3)">Lade...</div>';
  // Serverabgleich: welche archivierten Turniere existieren noch in der Datenbank?
  // serverCodes=null → Abgleich nicht möglich (offline/kein Firebase) → keine „nur lokal"-Markierung.
  let serverCodes=null;
  if(initFirebase()){
    try{
      const snap=await firebase.database().ref('turniere').get();
      serverCodes=new Set(Object.keys(snap.val()||{}).map(k=>k.replace(/^DK/,'')));
    }catch(e){serverCodes=null}
  }
  const localOnly=serverCodes?archiv.filter(a=>!serverCodes.has(a.code)).length:0;
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">Turnier-Archiv</h3>'
    +'<button onclick="closeTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  html+='<div style="font-size:12px;color:var(--tx3);margin:12px 0;line-height:1.5">Das Archiv liegt nur auf diesem Gerät und zeigt Turniere, an denen du teilgenommen hast. Tippe auf ein Turnier, um die Ergebnisse zu laden.'
    +(localOnly?' <b>'+localOnly+'</b> davon sind <b>nicht mehr auf dem Server</b> – ihre Ergebnisse lassen sich nicht mehr laden.':'')
    +'</div>';
  if(localOnly)
    html+='<button class="btn btn-secondary" style="width:100%;font-size:12px;margin-bottom:10px" onclick="cleanArchivLocalOnly()">Nicht mehr vorhandene aus dem Archiv entfernen ('+localOnly+')</button>';
  archiv.forEach(a=>{
    const d=new Date(a.date);
    const dateStr=d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
    const role=a.role==='host'?'Spielleiter':'Teilnehmer';
    const onServer=serverCodes?serverCodes.has(a.code):true; // unbekannt → wie vorhanden behandeln
    const stale=serverCodes&&!onServer;
    html+='<div class="card turnier-tisch-card" style="cursor:pointer'+(stale?';opacity:.7':'')+'" onclick="openArchivTurnier(\''+a.code+'\')">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">'
      +'<div style="font-weight:600;font-size:15px;min-width:0">'+(a.name||'DK-'+a.code)+'</div>'
      +'<div style="font-size:11px;color:var(--tx3);flex:0 0 auto">'+dateStr+'</div></div>'
      +(a.name?'<div style="font-size:11px;color:var(--tx3);margin-top:1px">DK-'+a.code+'</div>':'')
      +'<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:2px">'
      +'<div style="font-size:12px;color:var(--tx2)">'+role
      +(stale?' · <span style="color:var(--red)">nur lokal · nicht mehr auf dem Server</span>':'')+'</div>'
      +'<button onclick="event.stopPropagation();removeArchivEntry(\''+a.code+'\')" style="flex:0 0 auto;background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;font-size:11px;padding:4px 8px;border-radius:var(--r-sm)">Entfernen</button>'
      +'</div></div>';
  });
  if(archiv.length)
    html+='<button class="btn btn-secondary" style="width:100%;font-size:12px;margin-top:16px;color:var(--red);border-color:var(--red)" onclick="clearTurnierArchiv()">Gesamtes Archiv leeren</button>';
  el.innerHTML=html;
}

// Komplettes lokales Archiv leeren (Serverdaten bleiben unberührt).
export async function clearTurnierArchiv(){
  if(!await showConfirm('Das gesamte lokale Turnier-Archiv leeren? Turnierdaten auf dem Server bleiben unberührt.','Archiv leeren'))return;
  localStorage.removeItem('doko-v4-turnierArchiv');
  showToast('Archiv geleert.','success');
  closeTurnierDashboard();
}

// Einzelnen (lokalen) Archiv-Eintrag entfernen.
export function removeArchivEntry(code){
  try{
    let archiv=JSON.parse(localStorage.getItem('doko-v4-turnierArchiv')||'[]');
    archiv=archiv.filter(a=>a.code!==code);
    localStorage.setItem('doko-v4-turnierArchiv',JSON.stringify(archiv));
  }catch(e){}
  showToast('Aus Archiv entfernt.','success');
  if(JSON.parse(localStorage.getItem('doko-v4-turnierArchiv')||'[]').length)showTurnierArchiv();
  else closeTurnierDashboard();
}

// Alle Archiv-Einträge entfernen, die es serverseitig nicht mehr gibt.
export async function cleanArchivLocalOnly(){
  if(!initFirebase()){showToast('Kein Serverabgleich möglich.','error');return}
  let serverCodes;
  try{
    const snap=await firebase.database().ref('turniere').get();
    serverCodes=new Set(Object.keys(snap.val()||{}).map(k=>k.replace(/^DK/,'')));
  }catch(e){showToast('Serverabgleich fehlgeschlagen.','error');return}
  let archiv=JSON.parse(localStorage.getItem('doko-v4-turnierArchiv')||'[]');
  const before=archiv.length;
  archiv=archiv.filter(a=>serverCodes.has(a.code));
  localStorage.setItem('doko-v4-turnierArchiv',JSON.stringify(archiv));
  showToast((before-archiv.length)+' Eintrag/Einträge entfernt.','success');
  if(archiv.length)showTurnierArchiv(); else closeTurnierDashboard();
}

export async function openArchivTurnier(code){
  if(!initFirebase()){showToast('Firebase nicht verfügbar.','error');return}
  const el=document.getElementById('turnierModalContent');
  el.innerHTML='<div style="text-align:center;padding:32px;color:var(--tx3)">Lade...</div>';
  try{
    const snap=await firebase.database().ref('turniere/DK'+code).get();
    if(!snap.exists()){showToast('Turnier nicht mehr vorhanden.','error');closeTurnierDashboard();return}
    await loadSpielerDB();
    const data=snap.val();
    const tische=data.tische||{};
    const tischArr=Object.entries(tische).map(([id,t])=>({id,...t}));
    tischArr.sort((a,b)=>(a.nummer||99)-(b.nummer||99));
    function nameOf(id){const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id}
    let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
      +'<button onclick="showTurnierArchiv()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;gap:4px;padding:0 10px;font-size:13px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="15 18 9 12 15 6"/></svg> Zurück</button>'
      +'<h3 style="margin:0">'+(data.name||'DK-'+code)+'</h3><div style="width:32px"></div></div>';
    html+='<div style="font-size:12px;color:var(--tx3);margin:12px 0">'+tischArr.length+' Tisch'+(tischArr.length!==1?'e':'')+' · Status: '+(data.status==='ended'?'Beendet':'Aktiv')+'</div>';
    tischArr.forEach(t=>{
      const rounds=t.rounds||[];
      const spielerIds=t.spielerIds||[];
      const totals={};spielerIds.forEach(p=>totals[p]=0);
      rounds.forEach(r=>{if(r.scores){spielerIds.forEach(p=>{totals[p]+=(r.scores[p]||0)})}});
      const sorted=spielerIds.slice().sort((a,b)=>(totals[b]||0)-(totals[a]||0));
      html+='<div class="card" style="margin-bottom:8px"><div style="font-weight:600;margin-bottom:6px">'+(t.name||'Tisch '+(t.nummer||'?'))+' · '+rounds.length+' Runden</div>';
      sorted.forEach((p,i)=>{
        const pts=totals[p]||0;
        const col=pts>0?'var(--grn)':pts<0?'var(--red)':'var(--tx2)';
        html+='<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">'
          +'<span>#'+(i+1)+' '+nameOf(p)+'</span><span style="font-weight:600;color:'+col+'">'+pts+'</span></div>';
      });
      html+='</div>';
    });
    el.innerHTML=html;
  }catch(e){
    showToast('Fehler beim Laden: '+e.message,'error');
    closeTurnierDashboard();
  }
}

export async function endTurnier(){
  if(!state.turnier||!state.turnier.isHost)return;
  if(!await showConfirm('Turnier DK-'+state.turnier.code+' beenden? Tische können danach nicht mehr beitreten.','Beenden',true))return;
  if(!initFirebase())return;
  try{
    archiveTurnier(state.turnier.code);
    await firebase.database().ref('turniere/DK'+state.turnier.code+'/status').set('ended');
    removeDiscovery(state.turnier.code);
    if(turnierListener){
      firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').off('value',turnierListener);
      turnierListener=null;
    }
    closeTurnierDashboard();
    state.turnier=null;
    save();
    renderTurnierSetup();renderTurnierIndicator();
    showToast('Turnier beendet.','info');
  }catch(e){
    console.error('endTurnier error:',e);
    showToast('Fehler: '+e.message,'error');
  }
}

// ── Turnier-Verwaltung: globale Liste, Ersteller, aktuelles setzen, Soft/Hard-Delete ──
function escTurnier(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

export async function loadAllTurniere(){
  if(!initFirebase())return[];
  await loadSpielerDB();
  try{
    const snap=await firebase.database().ref('turniere').get();
    const data=snap.val()||{};
    // Geteilte Einzelspiele (turniere/SG…) und Ligen (turniere/LG…) sind keine Turniere → herausfiltern.
    return Object.entries(data)
      .filter(([key,t])=>!key.startsWith('SG')&&!key.startsWith('LG')&&!(t&&t.kind==='sharedGame')&&!(t&&t.kind==='liga'))
      .map(([key,t])=>({code:key.replace(/^DK/,''),key,...t}));
  }catch(e){console.error('loadAllTurniere:',e);return[]}
}

export function turnierCreatorName(t){
  const id=t.createdBy||(t.hosts?Object.keys(t.hosts)[0]:null);
  if(!id)return 'unbekannt';
  const s=spielerCache.find(x=>x.id===id);
  return s?s.name:id;
}

// Erklärender Leer-Zustand statt nur „Keine Turniere." – macht klar, warum die Liste leer ist
// und wo vergangene Teilnahmen (lokales Archiv) zu finden sind.
function emptyTurnierHint(opts){
  let msg;
  if(opts.role==='admin'){
    msg='Es liegen aktuell keine Turniere in der Datenbank.';
  }else if(!opts.ownSpielerId){
    msg='Hier erscheinen Turniere, die du auf diesem Gerät erstellt hast. Es wurde keins gefunden. Ohne eigenes Cloud-Profil lassen sich Turniere, bei denen du nur Co-Spielleiter bist, nicht zuordnen – lege dafür im Turnier-Bereich einen Spieler an. Reine Teilnahmen findest du unter „Turnier-Archiv".';
  }else{
    msg='Hier erscheinen nur Turniere, die du erstellt hast oder bei denen du Co-Spielleiter bist. Turniere, an denen du nur teilgenommen hast (oder die auf dem Server gelöscht wurden), findest du unter „Turnier-Archiv".';
  }
  return '<div style="font-size:13px;color:var(--tx3);padding:12px 0;line-height:1.5">'+msg+'</div>';
}

let turnierListOpts=null;
function turnierRow(t,opts){
  const tableCount=t.tische?Object.keys(t.tische).length:0;
  const created=t.created?new Date(t.created).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}):'';
  const creator=turnierCreatorName(t);
  const isCurrent=state.turnier&&state.turnier.code===t.code;
  let h='<div class="card" style="margin-bottom:8px'+(isCurrent?';border-color:var(--acc)':'')+'">';
  h+='<div style="min-width:0"><div style="font-weight:600;font-size:15px">'+escTurnier(t.name||'DK-'+t.code)+(isCurrent?' <span style="font-size:10px;color:var(--acc)">• aktuell</span>':'')+'</div>';
  h+='<div style="font-size:11px;color:var(--tx3);margin-top:1px">DK-'+t.code+' · '+tableCount+' Tisch'+(tableCount!==1?'e':'')+(created?' · '+created:'')+'</div>';
  h+='<div style="font-size:11px;color:var(--tx3)">erstellt von '+escTurnier(creator)+'</div></div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">';
  if(t.status!=='deleted'&&!isCurrent)
    h+='<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:7px;min-width:120px" onclick="setCurrentTurnier(\''+t.code+'\')">Öffnen / Bearbeiten</button>';
  if(t.status!=='deleted')
    h+='<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:7px;min-width:100px" onclick="turnierSoftDelete(\''+t.code+'\')">Archivieren</button>';
  if(t.status==='deleted')
    h+='<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:7px;min-width:120px" onclick="turnierRestore(\''+t.code+'\')">Wiederherstellen</button>';
  if(opts.role==='admin'&&t.status==='deleted')
    h+='<button class="btn btn-secondary" style="flex:1;font-size:12px;padding:7px;min-width:120px;color:var(--red);border-color:var(--red)" onclick="turnierHardDelete(\''+t.code+'\')">Endgültig löschen</button>';
  h+='</div></div>';
  return h;
}

// Gemeinsamer Builder fuer Host (eigene) und Admin (alle, gruppiert). Schreibt in opts.containerId.
export function renderTurnierList(turniere,opts){
  opts=opts||{};
  turnierListOpts=opts;
  const el=document.getElementById(opts.containerId||'turnierListBody');
  if(!el)return;
  let list=turniere.slice();
  if(opts.role!=='admin'){
    // Eigene Turniere (Ersteller, Co-Host ODER erstellendes Geraet) – inkl. archivierter, damit sie wiederhergestellt werden können.
    list=list.filter(t=>
      (opts.ownSpielerId&&(t.createdBy===opts.ownSpielerId||(t.hosts&&t.hosts[opts.ownSpielerId])))
      ||(opts.ownDeviceId&&t.createdByDevice===opts.ownDeviceId)
    );
  }
  if(!list.length){el.innerHTML=emptyTurnierHint(opts);return}
  // Beide Rollen gruppiert: Aktiv / Beendet / Archiviert.
  const groups=[['active','Aktiv'],['ended','Beendet'],['deleted','Archiviert']];
  let h='';
  groups.forEach(([st,label])=>{
    const g=list.filter(t=>(t.status||'active')===st);
    if(!g.length)return;
    g.sort((a,b)=>(b.created||0)-(a.created||0));
    h+='<div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--tx3);margin:14px 0 6px">'+label+' ('+g.length+')</div>';
    g.forEach(t=>{h+=turnierRow(t,opts)});
  });
  el.innerHTML=h;
}

async function refreshTurnierList(){
  if(!turnierListOpts)return;
  const list=await loadAllTurniere();
  renderTurnierList(list,turnierListOpts);
}

// In ein (anderes) Turnier als Spielleiter wechseln.
export async function setCurrentTurnier(code){
  if(!initFirebase())return;
  const own=await getOwnSpieler();
  const snap=await firebase.database().ref('turniere/DK'+code).get();
  if(!snap.exists()){showToast('Turnier nicht gefunden.','error');return}
  const data=snap.val();
  const admin=spielerIsAdmin(own);
  const canHost=admin||(own&&(data.createdBy===own.id||(data.hosts&&data.hosts[own.id])));
  if(!canHost){showToast('Keine Berechtigung für dieses Turnier.','error');return}
  // Admin, der noch nicht Host ist -> als Host eintragen.
  if(admin&&own&&!(data.hosts&&data.hosts[own.id])){
    try{await firebase.database().ref('turniere/DK'+code+'/hosts/'+own.id).set(true)}catch(e){}
  }
  // Dashboard-Listener des bisherigen Turniers loesen.
  if(turnierListener&&state.turnier){
    firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').off('value',turnierListener);
    turnierListener=null;
  }
  // Caches des vorherigen Turniers zuruecksetzen, sonst zeigt das Dashboard alte Config.
  turnierConfigCache=null;lastTischeSnapshot={};rotationenCache=null;
  state.turnier={code:code,tischId:null,tischName:null,tischNummer:null,isHost:true,isPlayer:false,turnierName:data.name||null};
  save();
  renderTurnierSetup();renderTurnierIndicator();
  refreshTurnierList();
  showToast('Aktuelles Turnier: '+(data.name||'DK-'+code),'info');
}

// Archivieren (Soft-Delete) – Daten bleiben erhalten, jederzeit wiederherstellbar. Ersteller/Co-Host & Admin.
export async function turnierSoftDelete(code){
  if(!initFirebase())return;
  if(!await showConfirm('Turnier DK-'+code+' archivieren? Es verschwindet aus den aktiven Listen, die Daten bleiben erhalten und lassen sich wiederherstellen.','Archivieren',true))return;
  try{
    await firebase.database().ref('turniere/DK'+code+'/status').set('deleted');
    removeDiscovery(code);
    if(state.turnier&&state.turnier.code===code){
      if(turnierListener){firebase.database().ref('turniere/DK'+code+'/tische').off('value',turnierListener);turnierListener=null;}
      state.turnier=null;save();renderTurnierSetup();renderTurnierIndicator();
    }
    showToast('Turnier archiviert.','info');
    refreshTurnierList();
  }catch(e){showToast('Fehler: '+e.message,'error')}
}

// Archiviertes Turnier wieder aktivieren – Admin ODER Ersteller/Co-Host.
export async function turnierRestore(code){
  if(!initFirebase())return;
  const own=await getOwnSpieler();
  const snap=await firebase.database().ref('turniere/DK'+code).get();
  const data=snap.val()||{};
  const allowed=spielerIsAdmin(own)||(own&&(data.createdBy===own.id||(data.hosts&&data.hosts[own.id])));
  if(!allowed){showToast('Kein Zugriff.','error');return}
  try{
    await firebase.database().ref('turniere/DK'+code+'/status').set('active');
    showToast('Turnier wiederhergestellt.','info');
    refreshTurnierList();
  }catch(e){showToast('Fehler: '+e.message,'error')}
}

// Admin-Aktion: endgueltig aus der Datenbank entfernen.
export async function turnierHardDelete(code){
  if(!initFirebase())return;
  if(!spielerIsAdmin(await getOwnSpieler())){showToast('Kein Zugriff.','error');return}
  if(!await showConfirm('Turnier DK-'+code+' UNWIDERRUFLICH löschen? Alle Tische und Wertungen gehen verloren.','Endgültig löschen',true))return;
  try{
    await firebase.database().ref('turniere/DK'+code).remove();
    removeDiscovery(code);
    if(state.turnier&&state.turnier.code===code){state.turnier=null;save();renderTurnierSetup();renderTurnierIndicator();}
    showToast('Turnier gelöscht.','info');
    refreshTurnierList();
  }catch(e){showToast('Fehler: '+e.message,'error')}
}

// Host-Einstieg: eigene Turniere verwalten.
export async function openMyTurniere(){
  if(!initFirebase()){showToast('Firebase nicht verfügbar.','error');return}
  document.getElementById('turnierModal').classList.add('show');
  const el=document.getElementById('turnierModalContent');
  el.innerHTML='<div style="text-align:center;padding:32px;color:var(--tx3)">Lade...</div>';
  const own=await getOwnSpieler();
  const list=await loadAllTurniere();
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">Meine Turniere</h3>'
    +'<button onclick="closeTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  html+='<div style="font-size:12px;color:var(--tx3);margin:12px 0">„Öffnen / Bearbeiten" wechselt ins Turnier (voller Spielleiter-Zugriff). „Archivieren" nimmt es aus den aktiven Listen – die Daten bleiben erhalten und lassen sich jederzeit wiederherstellen.</div>';
  html+='<div id="turnierListBody"></div>';
  el.innerHTML=html;
  renderTurnierList(list,{role:'host',ownSpielerId:own?own.id:null,ownDeviceId:getDeviceId(),containerId:'turnierListBody'});
}

let coHostSelected=[];
export async function openCoHostSelect(){
  if(!state.turnier||!state.turnier.isHost)return;
  if(!initFirebase())return;
  await loadSpielerDB();
  const snap=await firebase.database().ref('turniere/DK'+state.turnier.code).get();
  const data=snap.val();
  const hosts=data.hosts?Object.keys(data.hosts):[];
  const teilnehmer=data.teilnehmer?Object.keys(data.teilnehmer):[];
  const candidates=spielerCache.filter(s=>teilnehmer.includes(s.id));
  if(!candidates.length){showToast('Keine Teilnehmer vorhanden.','error');return}
  coHostSelected=hosts.slice();
  const el=document.getElementById('turnierModalContent');
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<button onclick="openTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;gap:4px;padding:0 10px;font-size:13px">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="15 18 9 12 15 6"/></svg> Zurück</button>'
    +'<h3 style="margin:0">Admins</h3><div style="width:32px"></div></div>';
  html+='<div style="font-size:12px;color:var(--tx3);margin:12px 0">Wähle Spieler als Co-Spielleiter aus. Diese können das Dashboard und alle Tische sehen und verwalten.</div>';
  html+='<div id="coHostList">';
  candidates.forEach(s=>{
    const isHost=coHostSelected.includes(s.id);
    html+='<div data-cid="'+s.id+'" onclick="toggleCoHost(\''+s.id+'\')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--bdr);cursor:pointer;background:'+(isHost?'var(--bg3)':'transparent')+'">'
      +'<span class="cohost-check" style="width:22px;height:22px;border-radius:50%;border:2px solid '+(isHost?'var(--acc)':'var(--bdr)')+';display:flex;align-items:center;justify-content:center;font-size:14px;color:'+(isHost?'var(--acc)':'transparent')+'">&#10003;</span>'
      +'<span style="flex:1;font-size:14px">'+(s.short||s.name)+'</span>'
      +(isHost?'<span style="font-size:11px;color:var(--acc)">Admin</span>':'')
      +'</div>';
  });
  html+='</div>';
  html+='<button class="btn btn-primary" style="width:100%;margin-top:12px" onclick="saveCoHosts()">Speichern</button>';
  el.innerHTML=html;
}
export function toggleCoHost(id){
  const idx=coHostSelected.indexOf(id);
  if(idx>=0)coHostSelected.splice(idx,1);else coHostSelected.push(id);
  document.querySelectorAll('#coHostList [data-cid]').forEach(el=>{
    const cid=el.dataset.cid;
    const sel=coHostSelected.includes(cid);
    el.style.background=sel?'var(--bg3)':'transparent';
    const check=el.querySelector('.cohost-check');
    if(check){check.style.borderColor=sel?'var(--acc)':'var(--bdr)';check.style.color=sel?'var(--acc)':'transparent';check.innerHTML='&#10003;'}
    const badge=el.querySelector('span:last-child');
    if(badge&&badge.style.fontSize==='11px'){if(sel)badge.textContent='Admin';else badge.textContent=''}
  });
}
export async function saveCoHosts(){
  if(!state.turnier)return;
  const hostsObj={};
  coHostSelected.forEach(id=>hostsObj[id]=true);
  await firebase.database().ref('turniere/DK'+state.turnier.code+'/hosts').set(hostsObj);
  const count=coHostSelected.length;
  showToast(count+' Admin'+(count!==1?'s':'')+' gespeichert.','info');
  openTurnierDashboard();
}
export async function hostJoinTisch(){
  if(!state.turnier||!state.turnier.isHost)return;
  openJoinTurnier(state.turnier.code);
}
export async function hostLeaveTisch(){
  if(!state.turnier||!state.turnier.isHost||!state.turnier.tischId)return;
  // Host aus Firebase-spielerIds entfernen
  if(initFirebase()){
    try{
      const deviceId=getDeviceId();
      const ownSpieler=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(deviceId));
      if(ownSpieler){
        const ref=firebase.database().ref('turniere/DK'+state.turnier.code+'/tische/'+state.turnier.tischId+'/spielerIds');
        const snap=await ref.get();
        if(snap.exists()){
          const ids=(snap.val()||[]).filter(id=>id!==ownSpieler.id);
          await ref.set(ids);
        }
      }
    }catch(e){console.warn('hostLeaveTisch:',e)}
  }
  state.turnier.tischId=null;
  state.turnier.tischName=null;
  state.turnier.tischNummer=null;
  save();
  renderTurnierSetup();renderTurnierIndicator();
  showToast('Tisch verlassen. Du bist weiterhin Spielleiter.','info');
}

export async function leaveTurnier(silent){
  if(!state.turnier||state.turnier.isHost)return;
  if(!silent&&!await showConfirm('Turnier verlassen? Deine Daten bleiben für den Spielleiter sichtbar.','Verlassen'))return;
  archiveTurnier(state.turnier.code);
  if(turnierListener&&state.turnier){
    firebase.database().ref('turniere/DK'+state.turnier.code+'/tische').off('value',turnierListener);
    turnierListener=null;
  }
  closeTurnierDashboard();
  state.turnier=null;
  save();
  renderTurnierSetup();
  renderTurnierIndicator();
  if(!silent)showToast('Turnier verlassen.','info');
}

export async function showTurnierDetail(tischId){
  if(!initFirebase())return;
  const el=document.getElementById('turnierModalContent');
  try{
    const snap=await firebase.database().ref('turniere/DK'+state.turnier.code+'/tische/'+tischId).get();
    const t=snap.val();
    if(!t){el.innerHTML='<p>Tisch nicht gefunden.</p>';return}
    const rounds=t.rounds||[];
    const spielerIds=t.spielerIds||[];
    const totals={};spielerIds.forEach(p=>totals[p]=0);
    rounds.forEach(r=>{if(r.scores){spielerIds.forEach(p=>{totals[p]+=(r.scores[p]||0)})}});
    const sorted=spielerIds.slice().sort((a,b)=>(totals[b]||0)-(totals[a]||0));
    function nameOf(id){const s=spielerCache.find(s=>s.id===id);return s?(s.short||s.name):id}
    let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5;border-bottom:1px solid var(--bdr)">'
      +'<button onclick="openTurnierDashboard()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;gap:4px;padding:0 10px;font-size:13px">'
      +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="15 18 9 12 15 6"/></svg> Zurück</button>'
      +'<h3 style="margin:0">'+(t.name||'Tisch '+(t.nummer||'?'))+'</h3><div style="width:32px"></div></div>';
    html+='<div style="margin:12px 0;font-size:13px;color:var(--tx2)">'+rounds.length+' Runden gespielt</div>';
    html+='<div class="card">';
    sorted.forEach((p,i)=>{
      const pts=totals[p]||0;
      const col=pts>0?'var(--grn)':pts<0?'var(--red)':'var(--tx2)';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0'+(i<sorted.length-1?';border-bottom:1px solid var(--bdr)':'')+'">'
        +'<div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--tx3);width:20px">#'+(i+1)+'</span><span style="font-weight:500">'+nameOf(p)+'</span></div>'
        +'<span style="font-weight:600;color:'+col+'">'+pts+'</span></div>';
    });
    html+='</div>';
    if(rounds.length){
      html+='<div class="section-label" style="margin-top:12px">Letzte Runden</div><div class="card" style="max-height:250px;overflow-y:auto">';
      rounds.slice().reverse().slice(0,15).forEach((r,i)=>{
        const idx=rounds.length-i;
        const winnersStr=(r.winners||[]).map(id=>nameOf(id)).join(', ');
        html+='<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px'+(i<Math.min(rounds.length,15)-1?';border-bottom:1px solid var(--bdr)':'')+'">'
          +'<span style="color:var(--tx3);width:30px">#'+idx+'</span>'
          +'<span style="flex:1">'+winnersStr+'</span>'
          +'<span style="font-weight:500">'+r.points+' Pkt.</span></div>';
      });
      html+='</div>';
    }
    el.innerHTML=html;
  }catch(e){
    console.error('showTurnierDetail error:',e);
    showToast('Fehler beim Laden.','error');
  }
}

