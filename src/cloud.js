// cloud.js – Persönliches Cloud-Backup der eigenen Spiele (opt-in).
// Sichert das aktuelle Spiel + das lokale Archiv unter spieler/<id>/backup.
// Reines Backup mit manueller Wiederherstellung – keine bidirektionale Sync.
// Voraussetzung: angelegtes Profil (geräteverknüpfter Spieler).

import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { initFirebase, getOwnSpieler, getDeviceId } from './turnier.js';
import { state, save, getAllPlayers, invalidateEingabeCache, showScreen } from './main.js';
import { showToast, showConfirm } from './ui.js';

const ARCHIVE_KEY='doko-v4-archive';
let backupTimer=null;
let lastBackupAt=null; // lokal gecachter Zeitstempel des letzten erfolgreichen Uploads

export function isCloudBackupEnabled(){return !!state.cloudBackup}

function appVersion(){
  const el=document.getElementById('versionLabel');
  return el?el.textContent.trim():'';
}

function loadLocalArchive(){
  try{return JSON.parse(localStorage.getItem(ARCHIVE_KEY)||'[]')}catch(e){return []}
}

// Baut die zu sichernden Daten: nur spiel-relevante State-Felder + Archiv.
function buildPayload(){
  return {
    updatedAt:firebase.database.ServerValue.TIMESTAMP,
    deviceId:getDeviceId(),
    appVersion:appVersion(),
    game:{
      myPlayer:state.myPlayer||'',
      players:state.players||[],
      rounds:state.rounds||[],
      knownNames:state.knownNames||[],
      bockQueue:state.bockQueue||0,
      gameStartTime:state.gameStartTime||null
    },
    archive:loadLocalArchive()
  };
}

// Toggle in den Einstellungen umgelegt.
export async function toggleCloudBackup(){
  const btn=document.getElementById('cloudBackupToggle');
  const wantOn=btn?btn.classList.contains('on'):!state.cloudBackup;
  if(wantOn){
    const own=await getOwnSpieler();
    if(!own){
      if(btn)btn.classList.remove('on');
      showToast('Bitte zuerst ein Profil anlegen.','error');
      return;
    }
    state.cloudBackup=true;
    save();
    showToast('Cloud-Backup aktiviert.','info');
    await uploadBackup(true);
  }else{
    state.cloudBackup=false;
    save();
    showToast('Cloud-Backup deaktiviert.','info');
  }
  fillCloudSettings();
}

// Debounced – wird am Ende von save() aufgerufen.
export function scheduleBackup(){
  if(!state.cloudBackup)return;
  clearTimeout(backupTimer);
  backupTimer=setTimeout(()=>{uploadBackup(false)},1500);
}

// Lädt das Backup in die Cloud. manual=true zeigt Erfolgs-/Fehler-Toasts.
export async function uploadBackup(manual){
  if(!state.cloudBackup&&!manual)return;
  if(!navigator.onLine){if(manual)showToast('Keine Internetverbindung.','error');return}
  if(!initFirebase()){if(manual)showToast('Keine Datenbank-Verbindung.','error');return}
  const own=await getOwnSpieler();
  if(!own){if(manual)showToast('Kein Profil gefunden.','error');return}
  try{
    await firebase.database().ref('spieler/'+own.id+'/backup').set(buildPayload());
    lastBackupAt=Date.now();
    if(manual){showToast('In Cloud gesichert.','info');fillCloudSettings()}
  }catch(e){
    console.error('uploadBackup error:',e);
    if(manual)showToast('Sicherung fehlgeschlagen.','error');
  }
}

// Stellt das Backup aus der Cloud wieder her (ersetzt die lokalen Spiele).
export async function restoreBackup(){
  if(!initFirebase()){showToast('Keine Datenbank-Verbindung.','error');return}
  const own=await getOwnSpieler();
  if(!own){showToast('Kein Profil gefunden.','error');return}
  let backup;
  try{
    const snap=await firebase.database().ref('spieler/'+own.id+'/backup').get();
    backup=snap.val();
  }catch(e){console.error('restoreBackup error:',e);showToast('Laden fehlgeschlagen.','error');return}
  if(!backup||!backup.game){showToast('Kein Cloud-Backup vorhanden.','info');return}
  const ok=await showConfirm('Lokale Spiele durch den Cloud-Stand ersetzen? Das überschreibt das aktuelle Spiel und das Archiv auf diesem Gerät.','Wiederherstellen',true);
  if(!ok)return;
  const g=backup.game;
  state.myPlayer=g.myPlayer||'';
  state.players=Array.isArray(g.players)?g.players:[];
  state.rounds=Array.isArray(g.rounds)?g.rounds:[];
  state.knownNames=Array.isArray(g.knownNames)?g.knownNames:[];
  state.bockQueue=g.bockQueue||0;
  state.gameStartTime=g.gameStartTime||null;
  try{localStorage.setItem(ARCHIVE_KEY,JSON.stringify(Array.isArray(backup.archive)?backup.archive:[]))}catch(e){}
  save();
  invalidateEingabeCache();
  showScreen(getAllPlayers().length>=4?'eingabe':'spieler');
  showToast('Aus Cloud wiederhergestellt.','info');
}

// Wird nach dem Übernehmen eines Profils auf einem neuen Gerät angeboten.
export async function maybeOfferRestore(){
  if(!initFirebase())return;
  const own=await getOwnSpieler();
  if(!own)return;
  let backup;
  try{const snap=await firebase.database().ref('spieler/'+own.id+'/backup').get();backup=snap.val()}
  catch(e){return}
  if(!backup||!backup.game)return;
  const n=(backup.game.rounds||[]).length;
  const a=(backup.archive||[]).length;
  const ok=await showConfirm('Für dein Profil liegt ein Cloud-Backup ('+n+' Runden, '+a+' archivierte Abende). Jetzt auf dieses Gerät laden?','Laden',false);
  if(!ok)return;
  // Auto-Backup einschalten, damit das neue Gerät weiter sichert.
  state.cloudBackup=true;
  await restoreBackupNoConfirm(backup);
}

// interne Wiederherstellung ohne Rückfrage (für maybeOfferRestore)
async function restoreBackupNoConfirm(backup){
  const g=backup.game;
  state.myPlayer=g.myPlayer||'';
  state.players=Array.isArray(g.players)?g.players:[];
  state.rounds=Array.isArray(g.rounds)?g.rounds:[];
  state.knownNames=Array.isArray(g.knownNames)?g.knownNames:[];
  state.bockQueue=g.bockQueue||0;
  state.gameStartTime=g.gameStartTime||null;
  try{localStorage.setItem(ARCHIVE_KEY,JSON.stringify(Array.isArray(backup.archive)?backup.archive:[]))}catch(e){}
  save();
  invalidateEingabeCache();
  showScreen(getAllPlayers().length>=4?'eingabe':'spieler');
  showToast('Aus Cloud geladen.','info');
}

function fmtTime(ts){
  if(!ts)return '–';
  try{const d=new Date(ts);return d.toLocaleDateString('de-DE')+' '+d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}
  catch(e){return '–'}
}

// Befüllt die Cloud-Backup-Card im Einstellungen-Modal (async).
export async function fillCloudSettings(){
  const el=document.getElementById('cloudSettings');
  if(!el)return;
  const own=await getOwnSpieler();
  if(!own){
    el.innerHTML='<div style="font-size:12px;color:var(--tx3)">Lege zuerst unter „Mein Profil" ein Profil an, dann kannst du deine Spiele in der Cloud sichern.</div>';
    return;
  }
  let lastTs=lastBackupAt;
  try{const snap=await firebase.database().ref('spieler/'+own.id+'/backup/updatedAt').get();if(snap.val())lastTs=snap.val()}catch(e){}
  let h='';
  h+='<div class="toggle-row" style="padding:4px 0"><span class="toggle-label">Meine Spiele in der Cloud sichern</span>'
    +'<button class="toggle'+(state.cloudBackup?' on':'')+'" id="cloudBackupToggle" onclick="this.classList.toggle(\'on\');toggleCloudBackup()"></button></div>';
  h+='<div style="font-size:11px;color:var(--tx3);margin:4px 0 8px">Sichert das aktuelle Spiel und dein Archiv automatisch. Wiederherstellung manuell – ideal beim Gerätewechsel.</div>';
  h+='<div style="font-size:12px;color:var(--tx2);margin-bottom:10px">Zuletzt gesichert: <b>'+fmtTime(lastTs)+'</b></div>';
  h+='<div style="display:flex;gap:8px">';
  h+='<button class="btn btn-secondary" style="flex:1" onclick="uploadBackup(true)">Jetzt sichern</button>';
  h+='<button class="btn btn-secondary" style="flex:1" onclick="restoreBackup()">Wiederherstellen</button>';
  h+='</div>';
  el.innerHTML=h;
}
