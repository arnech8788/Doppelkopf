// share.js – „Aktuelles Spiel teilen": ein laufendes (Nicht-Turnier-)Spiel per kurzem Code/QR
// auf ein anderes Gerät übergeben, damit dort weitergeschrieben werden kann.
// Speicherung als leichter Knoten unter dem offen beschreibbaren turniere/SG<code> (keine
// Firebase-Regel-Änderung nötig). Standard: einmalige Übergabe. Optional: Live-Sync
// (Last-write-wins über das ganze Dokument).

import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { initFirebase, getDeviceId, generateQR } from './turnier.js';
import { state, save, invalidateEingabeCache, showScreen, closeInfoModal } from './main.js';
import { archiveCurrentGame } from './archiv.js';
import { showToast, showConfirm } from './ui.js';

const PREFIX='SG';
let pushTimer=null;
let applyingRemote=false;   // während des Anwendens eines Remote-Updates → kein Push (Echo-Schutz)
let subscribedRef=null;

function gameNode(code){return firebase.database().ref('turniere/'+PREFIX+code)}
function spielUrl(code){return location.origin+location.pathname+'?spiel='+PREFIX+code}

// Nur spiel-relevante Felder.
function buildGamePayload(mode){
  return {
    kind:'sharedGame',
    mode:mode,
    updatedBy:getDeviceId(),
    updatedAt:firebase.database.ServerValue.TIMESTAMP,
    name:(state.players&&state.players.length?state.players.join(', '):'Spiel'),
    players:state.players||[],
    rounds:state.rounds||[],
    settings:{
      bockEnabled:!!state.bockEnabled,
      bockCount:state.bockCount||4,
      bockSolo:!!state.bockSolo,
      bockQueue:state.bockQueue||0,
      soloTypesEnabled:!!state.soloTypesEnabled,
      soloTypes:state.soloTypes||null,
      gameStartTime:state.gameStartTime||null
    }
  };
}

// Übernimmt players/rounds/settings aus einem geladenen Knoten ins lokale state.
function applyGame(data){
  state.players=Array.isArray(data.players)?data.players.slice():[];
  state.rounds=Array.isArray(data.rounds)?data.rounds:[];
  const s=data.settings||{};
  if('bockEnabled' in s)state.bockEnabled=!!s.bockEnabled;
  if('bockCount' in s)state.bockCount=s.bockCount||4;
  if('bockSolo' in s)state.bockSolo=!!s.bockSolo;
  if('bockQueue' in s)state.bockQueue=s.bockQueue||0;
  if('soloTypesEnabled' in s)state.soloTypesEnabled=!!s.soloTypesEnabled;
  if(s.soloTypes)state.soloTypes=s.soloTypes;
  if('gameStartTime' in s)state.gameStartTime=s.gameStartTime||null;
}

function persistLocalOnly(){try{localStorage.setItem('doko-v4',JSON.stringify(state))}catch(e){}}

function rerenderActive(){
  invalidateEingabeCache();
  const active=document.querySelector('.screen.active');
  const id=active?active.id.replace('screen-',''):'tabelle';
  showScreen(id);
}

function modalHeader(title){
  return '<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)"><h3 style="margin:0">'+title+'</h3><button onclick="closeInfoModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
}

// ── Teilen (Sender) ──
export function openShareGameModal(){
  if(state.turnier){showToast('Im Turnier wird ohnehin automatisch synchronisiert.','info');return}
  if(!state.rounds||state.rounds.length===0){showToast('Noch keine Runden zum Teilen.','info');return}
  if(state.sharedGame&&state.sharedGame.mode==='live'){showShareModal(state.sharedGame.code,'live');return}
  let html=modalHeader('Spiel teilen');
  html+='<div style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:16px">Übertrage das laufende Spiel auf ein anderes Gerät – das andere Gerät öffnet den Code/QR und schreibt weiter. Das Spiel wird dafür kurz über die Cloud bereitgestellt (Internet nötig).</div>';
  html+='<button class="btn btn-primary" style="width:100%;margin-bottom:8px" onclick="shareCurrentGame(\'once\')">Einmalige Übergabe</button>';
  html+='<div style="font-size:11px;color:var(--tx3);margin-bottom:14px">Das andere Gerät übernimmt den Stand und schreibt allein weiter. Dein Gerät bleibt unverändert.</div>';
  html+='<button class="btn btn-secondary" style="width:100%;margin-bottom:8px" onclick="shareCurrentGame(\'live\')">Live mitschreiben</button>';
  html+='<div style="font-size:11px;color:var(--tx3);margin-bottom:8px">Beide Geräte bleiben verbunden und sehen Änderungen gegenseitig. Es zählt jeweils der zuletzt gespeicherte Stand.</div>';
  html+='<button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="closeInfoModal()">Abbrechen</button>';
  document.getElementById('infoModalContent').innerHTML=html;
  document.getElementById('infoModal').classList.add('show');
}

export async function shareCurrentGame(mode){
  if(!navigator.onLine){showToast('Keine Internetverbindung.','error');return}
  if(!initFirebase()){showToast('Keine Datenbank-Verbindung.','error');return}
  document.getElementById('infoModalContent').innerHTML='<div style="text-align:center;padding:32px;color:var(--tx3)">Wird geteilt…</div>';
  document.getElementById('infoModal').classList.add('show');
  let code=null;
  try{
    for(let i=0;i<8;i++){
      const c=String(Math.floor(1000+Math.random()*9000));
      const snap=await gameNode(c).get();
      if(!snap.exists()){code=c;break}
    }
    if(!code){showToast('Bitte erneut versuchen.','error');return}
    await gameNode(code).set(buildGamePayload(mode));
  }catch(e){console.error('shareCurrentGame:',e);showToast('Teilen fehlgeschlagen.','error');return}
  if(mode==='live'){state.sharedGame={code:code,role:'owner',mode:'live'};save();subscribe()}
  showShareModal(code,mode);
}

function showShareModal(code,mode){
  const url=spielUrl(code);
  const qr=generateQR(url,6);
  let html=modalHeader('Spiel teilen');
  html+='<div style="text-align:center;margin:16px 0">';
  html+='<div style="font-size:30px;font-weight:700;letter-spacing:3px;margin-bottom:14px">'+PREFIX+'-'+code+'</div>';
  html+='<img src="'+qr+'" style="width:200px;height:200px;image-rendering:pixelated;border-radius:var(--r-sm)">';
  html+='<div style="font-size:12px;color:var(--tx3);margin-top:8px;word-break:break-all">'+url+'</div></div>';
  html+='<div style="font-size:12px;color:var(--tx2);text-align:center;line-height:1.5;margin-bottom:14px">'+(mode==='live'?'📡 Live: Beide Geräte bleiben verbunden. Es zählt der zuletzt gespeicherte Stand.':'Das andere Gerät öffnet Code/QR/Link, übernimmt den Stand und schreibt allein weiter.')+'</div>';
  html+='<div style="display:flex;gap:8px;margin-bottom:10px">';
  if(navigator.share)html+='<button class="btn btn-primary" style="flex:1" onclick="shareGameLink(\''+code+'\')">Teilen</button>';
  html+='<button class="btn btn-secondary" style="flex:1" onclick="copyGameLink(\''+code+'\')">Link kopieren</button></div>';
  if(mode==='live')html+='<button class="btn btn-secondary" style="width:100%;margin-bottom:6px" onclick="stopSharing()">Live-Teilen beenden</button>';
  html+='<button class="btn btn-secondary" style="width:100%" onclick="closeInfoModal()">Schließen</button>';
  document.getElementById('infoModalContent').innerHTML=html;
  document.getElementById('infoModal').classList.add('show');
}

export function shareGameLink(code){
  navigator.share({title:'Doppelkopf – Spiel',text:'Übernimm das Spiel: '+PREFIX+'-'+code,url:spielUrl(code)}).catch(()=>{});
}
export function copyGameLink(code){
  navigator.clipboard.writeText(spielUrl(code)).then(()=>showToast('Link kopiert!','info')).catch(()=>showToast(PREFIX+'-'+code,'info'));
}

// ── Übernehmen (Empfänger) ──
export async function importSharedGame(code){
  if(!initFirebase()){showToast('Keine Datenbank-Verbindung.','error');return}
  let data;
  try{
    const snap=await gameNode(code).get();
    if(!snap.exists()){showToast('Geteiltes Spiel nicht gefunden.','error');return}
    data=snap.val();
  }catch(e){console.error('importSharedGame:',e);showToast('Laden fehlgeschlagen.','error');return}
  if(!data||data.kind!=='sharedGame'){showToast('Ungültiger Code.','error');return}
  const cnt=Array.isArray(data.rounds)?data.rounds.length:0;
  const nm=data.name||'Spiel';
  const msg=(state.rounds&&state.rounds.length?'Dein aktuelles Spiel wird archiviert. ':'')+'Geteiltes Spiel übernehmen: '+nm+' ('+cnt+' Runde'+(cnt!==1?'n':'')+')?';
  if(!await showConfirm(msg,'Übernehmen'))return;
  if(state.rounds&&state.rounds.length)archiveCurrentGame();
  applyGame(data);
  if(data.mode==='live'){state.sharedGame={code:code,role:'guest',mode:'live'};save();subscribe()}
  else{state.sharedGame=null;save()}
  invalidateEingabeCache();
  showToast('Spiel übernommen.','info');
  showScreen('tabelle');
}

// ── Live-Sync ──
export function subscribe(){
  if(!state.sharedGame||state.sharedGame.mode!=='live')return;
  if(subscribedRef)return;
  if(!initFirebase())return;
  const code=state.sharedGame.code;
  subscribedRef=gameNode(code);
  subscribedRef.on('value',snap=>{
    const data=snap.val();
    if(!data){showToast('Live-Teilen wurde beendet.','info');stopSharing(true);return}
    if(data.kind!=='sharedGame')return;
    if(data.updatedBy===getDeviceId())return; // eigener Schreibvorgang
    applyingRemote=true;
    applyGame(data);
    persistLocalOnly();
    applyingRemote=false;
    rerenderActive();
  });
}

// Debounced – wird am Ende von save() aufgerufen. No-Op außer im Live-Modus.
export function scheduleSharedPush(){
  if(applyingRemote)return;
  if(!state.sharedGame||state.sharedGame.mode!=='live')return;
  clearTimeout(pushTimer);
  pushTimer=setTimeout(pushNow,1200);
}
async function pushNow(){
  if(!state.sharedGame||state.sharedGame.mode!=='live')return;
  if(!navigator.onLine||!initFirebase())return;
  try{await gameNode(state.sharedGame.code).set(buildGamePayload('live'))}catch(e){console.error('sharedPush:',e)}
}

export async function stopSharing(silent){
  const sg=state.sharedGame;
  if(subscribedRef){subscribedRef.off();subscribedRef=null}
  state.sharedGame=null;
  save();
  // Beim Beenden durch den Ersteller den Knoten entfernen (Gast lässt ihn stehen).
  if(sg&&sg.role==='owner'&&initFirebase()){try{await gameNode(sg.code).remove()}catch(e){}}
  if(!silent)showToast('Live-Teilen beendet.','info');
  const a=document.querySelector('.screen.active');
  if(a&&a.id==='screen-spieler')showScreen('spieler');
}

// Deep-Link beim Start: ?spiel=SG1234
export function checkSpielUrlParam(){
  const params=new URLSearchParams(location.search);
  const sp=params.get('spiel');
  if(!sp)return;
  history.replaceState(null,'',location.pathname);
  const code=String(sp).replace(/SG/i,'');
  if(!/^\d{4}$/.test(code))return;
  setTimeout(()=>{importSharedGame(code)},500);
}
