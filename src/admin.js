// admin.js – Admin-Bereich: vollstaendiger Firebase-Datenbank-Browser (CRUD).
// Nur fuer den Admin-Spieler sichtbar (siehe isAdmin in turnier.js).
// Navigiert durch den DB-Baum, erlaubt Anlegen/Bearbeiten (als JSON) und Loeschen
// beliebiger Knoten.

import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { initFirebase, isAdmin, loadSpielerDB, spielerIsAdmin, BOOTSTRAP_ADMINS, loadAllTurniere, renderTurnierList, getOwnSpieler, startPresenceWatch, stopPresenceWatch, loadSpecialNames, saveSpecialNames } from './turnier.js';
import { showToast, showConfirm, showPrompt, ICO } from './ui.js';
import { getSpecialNames, SPECIAL_NAME_DEFAULTS } from './main.js';

// Bekannte Top-Level-Knoten – dienen als Einstieg, falls der Root per
// Firebase-Regeln nicht lesbar ist (permission_denied at /).
const ROOT_KEYS=['spieler','turniere','discovery'];

// Aktueller Pfad als Array von Schluesseln (leer = Wurzel).
let adminPath=[];
// Kindschluessel des aktuellen Knotens (per Index in onclick referenziert -> kein Escaping noetig).
let adminKeys=[];
let adminCurrentVal=null;
let adminRootFallback=false;
let adminAdminList=[];

function pathStr(){return adminPath.join('/')}
function refAt(path){
  const db=firebase.database();
  return path?db.ref(path):db.ref();
}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

// Kurzvorschau eines Werts fuer die Listenansicht.
function preview(v){
  if(v===null||v===undefined)return '<span style="color:var(--tx3)">null</span>';
  if(typeof v==='object'){
    const n=Array.isArray(v)?v.length:Object.keys(v).length;
    return '<span style="color:var(--tx3)">'+(Array.isArray(v)?'[ '+n+' ]':'{ '+n+' }')+'</span>';
  }
  let s=String(v);
  if(s.length>40)s=s.slice(0,40)+'…';
  return '<span style="color:var(--acc2)">'+escHtml(s)+'</span>';
}

// Blendet den Admin-Einstieg im Mehr-Screen ein, falls der Nutzer Admin ist.
export async function fillAdminEntry(){
  const el=document.getElementById('adminEntrySlot');
  if(!el)return;
  let admin=false;
  try{admin=await isAdmin()}catch(e){admin=false}
  if(!admin){el.innerHTML='';return}
  el.innerHTML='<div class="section-label" style="margin-top:20px">Nur für Admins</div>'
    +'<div class="card" style="cursor:pointer;border-color:var(--acc)" onclick="openAdminModal()">'
    +'<div style="display:flex;align-items:center;gap:10px">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--acc)"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
    +'<div><div style="font-weight:500">Admin – Datenbank</div><div style="font-size:11px;color:var(--tx3)">Alles einsehen, bearbeiten und löschen</div></div></div></div>'
    +'<div class="card" style="cursor:pointer;border-color:var(--acc)" onclick="window.open(\'https://doppelkopf.goatcounter.com\',\'_blank\',\'noopener\')">'
    +'<div style="display:flex;align-items:center;gap:10px">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--acc2)"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>'
    +'<div><div style="font-weight:500">Besucher-Statistik</div><div style="font-size:11px;color:var(--tx3)">GoatCounter öffnen</div></div></div></div>';
}

export async function openAdminModal(){
  let admin=false;
  try{admin=await isAdmin()}catch(e){admin=false}
  if(!admin){showToast('Kein Zugriff.','error');return}
  if(!initFirebase()){showToast('Keine Datenbank-Verbindung.','error');return}
  adminPath=[];
  document.getElementById('adminModal').classList.add('show');
  await adminLoad();
}

export function closeAdminModal(){stopPresenceWatch();document.getElementById('adminModal').classList.remove('show')}

// Laedt den aktuellen Knoten und rendert die Ansicht neu.
async function adminLoad(){
  stopPresenceWatch(); // evtl. laufenden Online-Listener beenden, wenn wir zum Browser zurueckkehren
  const el=document.getElementById('adminModalContent');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--tx3)">Lädt…</div>';
  if(adminPath.length===0){
    // Root ist oft per Regeln gesperrt -> bekannte Top-Level-Knoten anbieten.
    adminRootFallback=false;
    try{
      const snap=await refAt('').once('value');
      const val=snap.val();
      adminCurrentVal=(val&&typeof val==='object')?val:{};
    }catch(e){
      adminCurrentVal={};
      adminRootFallback=true;
    }
    ROOT_KEYS.forEach(k=>{if(!(k in adminCurrentVal))adminCurrentVal[k]=null});
    renderAdmin();
    return;
  }
  adminRootFallback=false;
  try{
    const snap=await refAt(pathStr()).once('value');
    adminCurrentVal=snap.val();
  }catch(e){
    console.error('admin load error:',e);
    el.innerHTML='<div style="padding:40px;text-align:center;color:var(--red)">Fehler: '+escHtml(e.message||e)
      +'</div><button class="btn btn-secondary" style="margin-top:12px" onclick="adminUp('+(adminPath.length-1)+')">Zurück</button>';
    return;
  }
  renderAdmin();
}
export function adminRefresh(){adminLoad()}

function renderAdmin(){
  const el=document.getElementById('adminModalContent');
  const v=adminCurrentVal;

  // Header
  let h='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">🛡️ Admin – Datenbank</h3>'
    +'<button onclick="closeAdminModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen">'+ICO.x+'</button></div>';

  // Breadcrumb
  h+='<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:13px;margin-bottom:10px">';
  h+='<a href="#" onclick="adminUp(0);return false" style="color:var(--acc);text-decoration:none">⌂ root</a>';
  adminPath.forEach((k,i)=>{
    h+='<span style="color:var(--tx3)">/</span>';
    if(i<adminPath.length-1)h+='<a href="#" onclick="adminUp('+(i+1)+');return false" style="color:var(--acc);text-decoration:none">'+escHtml(k)+'</a>';
    else h+='<span style="color:var(--tx);font-weight:600">'+escHtml(k)+'</span>';
  });
  h+='</div>';

  const atRoot=adminPath.length===0;

  // Toolbar
  h+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">';
  h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px" onclick="adminRefresh()">↻ Aktualisieren</button>';
  if(atRoot){
    h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px" onclick="adminManageAdmins()">👥 Admins</button>';
    h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px" onclick="adminManageTurniere()">🏆 Turniere</button>';
    h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px" onclick="adminPresence()">🟢 Online</button>';
    h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px" onclick="adminSpecialNames()">✨ Besondere Namen</button>';
  }
  if(!atRoot&&v!==null&&typeof v==='object')
    h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px" onclick="adminAddKey()">+ Schlüssel</button>';
  if(!atRoot)
    h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px" onclick="adminEditRaw()">'+ICO.edit+' JSON</button>';
  if(!atRoot)
    h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px;color:var(--red);border-color:var(--red)" onclick="adminDeleteCurrent()">'+ICO.trash+' Knoten löschen</button>';
  h+='</div>';

  if(atRoot&&adminRootFallback)
    h+='<div style="font-size:11px;color:var(--tx3);margin:-4px 0 10px">Root ist per DB-Regeln gesperrt – bekannte Bereiche werden angezeigt.</div>';

  // Inhalt
  if(v===null||v===undefined){
    h+='<div class="card" style="color:var(--tx3);font-size:13px">Leer (null). Über „+ Schlüssel" anlegen.</div>';
    adminKeys=[];
  }else if(typeof v==='object'){
    adminKeys=Object.keys(v);
    h+='<div class="card" style="padding:4px 0">';
    if(!adminKeys.length)h+='<div style="padding:12px;color:var(--tx3);font-size:13px">Keine Einträge.</div>';
    adminKeys.forEach((k,i)=>{
      const child=v[k];
      const isObj=child!==null&&typeof child==='object';
      const navigable=isObj||atRoot; // Root-Knoten immer betretbar (Wert ggf. erst dort lesbar)
      h+='<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--bdr)">';
      if(navigable)
        h+='<a href="#" onclick="adminOpen('+i+');return false" style="flex:1;min-width:0;color:var(--tx);text-decoration:none;display:flex;justify-content:space-between;gap:8px;align-items:center"><span style="font-weight:500;word-break:break-all">'+escHtml(k)+'</span>'+(atRoot&&adminRootFallback?'':preview(child))+'<span style="color:var(--tx3)">›</span></a>';
      else{
        h+='<div style="flex:1;min-width:0;display:flex;justify-content:space-between;gap:8px;align-items:center"><span style="font-weight:500;word-break:break-all">'+escHtml(k)+'</span>'+preview(child)+'</div>';
        h+='<button onclick="adminEditKey('+i+')" title="Bearbeiten" style="background:none;border:none;color:var(--tx2);cursor:pointer;width:30px;height:30px;flex-shrink:0">'+ICO.edit+'</button>';
      }
      if(!atRoot)
        h+='<button onclick="adminDeleteKey('+i+')" title="Löschen" style="background:none;border:none;color:var(--red);cursor:pointer;width:30px;height:30px;flex-shrink:0">'+ICO.trash+'</button>';
      h+='</div>';
    });
    h+='</div>';
  }else{
    // Primitiver Wert
    adminKeys=[];
    h+='<div class="card"><div style="font-size:12px;color:var(--tx3);margin-bottom:6px">Wert</div>';
    h+='<input type="text" id="adminPrimVal" value="'+escHtml(String(v)).replace(/"/g,'&quot;')+'" style="width:100%;box-sizing:border-box;font-size:14px;padding:9px 10px;border-radius:var(--r-sm);border:1px solid var(--bdr);background:var(--bg);color:var(--tx)">';
    h+='<button class="btn btn-primary" style="margin-top:10px" onclick="adminSavePrimitive()">Speichern</button></div>';
  }

  el.innerHTML=h;
}

export function adminOpen(i){
  const k=adminKeys[i];
  if(k===undefined)return;
  adminPath.push(k);
  adminLoad();
}
export function adminUp(index){
  adminPath=adminPath.slice(0,index);
  adminLoad();
}

// Parst eine Texteingabe in einen JSON-Wert; faellt auf den rohen String zurueck.
function parseValue(str){
  const t=str.trim();
  if(t==='')return '';
  try{return JSON.parse(t)}catch(e){return str}
}

export async function adminEditKey(i){
  const k=adminKeys[i];
  if(k===undefined)return;
  const input=await showPrompt('Wert für „'+escHtml(k)+'" (JSON oder Text):','Wert','Speichern');
  if(input===null)return;
  try{
    await refAt(pathStr()+'/'+k).set(parseValue(input));
    showToast('Gespeichert.','info');
    adminLoad();
  }catch(e){console.error(e);showToast('Fehler beim Speichern.','error')}
}

export async function adminSavePrimitive(){
  const inp=document.getElementById('adminPrimVal');
  if(!inp)return;
  try{
    await refAt(pathStr()).set(parseValue(inp.value));
    showToast('Gespeichert.','info');
    adminLoad();
  }catch(e){console.error(e);showToast('Fehler beim Speichern.','error')}
}

export async function adminAddKey(){
  const key=await showPrompt('Name des neuen Schlüssels:','z. B. name','Weiter');
  if(!key)return;
  if(/[.#$\[\]/]/.test(key)){showToast('Ungültige Zeichen im Schlüssel (. # $ [ ] /).','error');return}
  const val=await showPrompt('Wert für „'+escHtml(key)+'" (JSON oder Text, leer = {}):','Wert','Anlegen');
  if(val===null)return;
  const value=val.trim()===''?{}:parseValue(val);
  try{
    await refAt((pathStr()?pathStr()+'/':'')+key).set(value);
    showToast('Angelegt.','info');
    adminLoad();
  }catch(e){console.error(e);showToast('Fehler beim Anlegen.','error')}
}

export async function adminDeleteKey(i){
  const k=adminKeys[i];
  if(k===undefined)return;
  const ok=await showConfirm('„'+(pathStr()?pathStr()+'/':'')+k+'" wirklich löschen?','Löschen',true);
  if(!ok)return;
  try{
    await refAt((pathStr()?pathStr()+'/':'')+k).remove();
    showToast('Gelöscht.','info');
    adminLoad();
  }catch(e){console.error(e);showToast('Fehler beim Löschen.','error')}
}

export async function adminDeleteCurrent(){
  if(!adminPath.length)return;
  const ok=await showConfirm('Knoten „'+pathStr()+'" komplett löschen?','Löschen',true);
  if(!ok)return;
  try{
    await refAt(pathStr()).remove();
    showToast('Gelöscht.','info');
    adminPath.pop();
    adminLoad();
  }catch(e){console.error(e);showToast('Fehler beim Löschen.','error')}
}

// Bearbeitet den aktuellen Knoten als Roh-JSON.
export function adminEditRaw(){
  const el=document.getElementById('adminModalContent');
  const json=JSON.stringify(adminCurrentVal===undefined?null:adminCurrentVal,null,2);
  let h='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">JSON bearbeiten</h3>'
    +'<button onclick="adminRefresh()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Zurück">'+ICO.x+'</button></div>';
  h+='<div style="font-size:12px;color:var(--tx3);margin-bottom:8px">Pfad: <code>'+escHtml(pathStr()||'/')+'</code></div>';
  h+='<textarea id="adminRawJson" spellcheck="false" style="width:100%;box-sizing:border-box;min-height:50vh;font-family:monospace;font-size:13px;padding:10px;border-radius:var(--r-sm);border:1px solid var(--bdr);background:var(--bg);color:var(--tx)">'+escHtml(json)+'</textarea>';
  h+='<div style="display:flex;gap:8px;margin-top:10px">';
  h+='<button class="btn btn-secondary" style="flex:1" onclick="adminRefresh()">Abbrechen</button>';
  h+='<button class="btn btn-primary" style="flex:1" onclick="adminSaveRaw()">Speichern</button></div>';
  el.innerHTML=h;
}

export async function adminSaveRaw(){
  const ta=document.getElementById('adminRawJson');
  if(!ta)return;
  let parsed;
  try{parsed=JSON.parse(ta.value)}
  catch(e){showToast('Ungültiges JSON: '+e.message,'error');return}
  try{
    await refAt(pathStr()).set(parsed);
    showToast('Gespeichert.','info');
    adminLoad();
  }catch(e){console.error(e);showToast('Fehler beim Speichern.','error')}
}

// ── Admins verwalten ──
// Listet alle Spieler und erlaubt das Vergeben/Entziehen von Admin-Rechten
// (Flag spieler/<id>/isAdmin). Bootstrap-Admins sind gesperrt.
export async function adminManageAdmins(){
  const el=document.getElementById('adminModalContent');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--tx3)">Lädt…</div>';
  adminAdminList=await loadSpielerDB();
  adminAdminList=adminAdminList.slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));

  let h='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">👥 Admins verwalten</h3>'
    +'<button onclick="adminRefresh()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Zurück">'+ICO.x+'</button></div>';
  h+='<div style="font-size:12px;color:var(--tx3);margin-bottom:10px">„Admin" vergibt volle Rechte. „Doko-Beta" schaltet nur „Doppelkopf spielen" frei (Admins dürfen ohnehin).</div>';
  h+='<div class="card" style="padding:4px 0">';
  if(!adminAdminList.length)h+='<div style="padding:12px;color:var(--tx3);font-size:13px">Keine Spieler.</div>';
  adminAdminList.forEach((s,i)=>{
    const boot=BOOTSTRAP_ADMINS.includes(s.id);
    const on=spielerIsAdmin(s);
    h+='<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--bdr)">';
    h+='<div style="flex:1;min-width:0"><div style="font-weight:500;word-break:break-all">'+escHtml(s.name||'(ohne Name)')+(s.short?' <span style="color:var(--tx3);font-weight:400">· '+escHtml(s.short)+'</span>':'')+'</div>';
    h+='<div style="font-size:11px;color:var(--tx3)">'+escHtml(s.id)+(boot?' · fest':'')+'</div></div>';
    h+='<div style="display:flex;gap:14px;align-items:flex-end;flex-shrink:0">';
    h+='<div style="text-align:center"><div style="font-size:9px;color:var(--tx3);margin-bottom:3px">Admin</div>';
    if(boot)
      h+='<span style="font-size:11px;color:var(--acc);border:1px solid var(--acc);border-radius:999px;padding:2px 8px">fest</span>';
    else
      h+='<button class="toggle'+(on?' on':'')+'" onclick="adminToggleAdmin('+i+')"></button>';
    h+='</div>';
    h+='<div style="text-align:center"><div style="font-size:9px;color:var(--tx3);margin-bottom:3px">Doko-Beta</div>';
    h+='<button class="toggle'+(s.betaGame===true?' on':'')+'" onclick="adminToggleBeta('+i+')"></button></div>';
    h+='</div>';
    h+='</div>';
  });
  h+='</div>';
  el.innerHTML=h;
}

export async function adminToggleAdmin(i){
  const s=adminAdminList[i];
  if(!s)return;
  if(BOOTSTRAP_ADMINS.includes(s.id)){showToast('Fest hinterlegter Admin – nicht änderbar.','info');return}
  const makeAdmin=!(s.isAdmin===true);
  try{
    const ref=firebase.database().ref('spieler/'+s.id+'/isAdmin');
    if(makeAdmin)await ref.set(true);else await ref.remove();
    s.isAdmin=makeAdmin?true:undefined;
    showToast(makeAdmin?(s.name||'Spieler')+' ist jetzt Admin.':'Admin-Rechte entzogen.','info');
    adminManageAdmins();
  }catch(e){console.error('adminToggleAdmin error:',e);showToast('Fehler beim Ändern.','error')}
}

// Schaltet „Doppelkopf spielen" (Beta) für einen Spieler frei/aus (spieler/<id>/betaGame).
export async function adminToggleBeta(i){
  const s=adminAdminList[i];
  if(!s)return;
  const makeBeta=!(s.betaGame===true);
  try{
    const ref=firebase.database().ref('spieler/'+s.id+'/betaGame');
    if(makeBeta)await ref.set(true);else await ref.remove();
    s.betaGame=makeBeta?true:undefined;
    showToast(makeBeta?(s.name||'Spieler')+' ist jetzt Doko-Beta-Tester.':'Doko-Beta entzogen.','info');
    adminManageAdmins();
  }catch(e){console.error('adminToggleBeta error:',e);showToast('Fehler beim Ändern.','error')}
}

// Admin: alle Turniere sehen und verwalten (aktuell setzen, ausblenden, wiederherstellen, hart loeschen).
export async function adminManageTurniere(){
  stopPresenceWatch();
  const el=document.getElementById('adminModalContent');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--tx3)">Lädt…</div>';
  const list=await loadAllTurniere();
  const own=await getOwnSpieler();
  let h='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">🏆 Turniere verwalten</h3>'
    +'<button onclick="adminRefresh()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Zurück">'+ICO.x+'</button></div>';
  h+='<div style="font-size:12px;color:var(--tx3);margin-bottom:4px">Alle Turniere: öffnen/bearbeiten, archivieren, wiederherstellen oder endgültig löschen.</div>';
  h+='<div id="turnierListBody"></div>';
  el.innerHTML=h;
  renderTurnierList(list,{role:'admin',ownSpielerId:own?own.id:null,containerId:'turnierListBody'});
}

// Admin: wer ist gerade online (Firebase Presence). Live-Aktualisierung.
export async function adminPresence(){
  const el=document.getElementById('adminModalContent');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--tx3)">Lädt…</div>';
  let firstResponse=false;
  function header(title){
    return '<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)">'
      +'<h3 style="margin:0">'+title+'</h3>'
      +'<button onclick="adminRefresh()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Zurück">'+ICO.x+'</button></div>';
  }
  function showMessage(title,msg){
    const cont=document.getElementById('adminModalContent');
    if(cont)cont.innerHTML=header(title)+'<div class="card" style="color:var(--tx3);font-size:13px">'+escHtml(msg)+'</div>';
  }
  // map = Spieler-Datensaetze. Wir zeigen ALLE Spieler, nach „zuletzt online" sortiert.
  function agoText(ts,now){
    if(!ts)return null;
    const s=Math.max(0,Math.round((now-ts)/1000));
    if(s<60)return 'vor '+s+' s';
    const m=Math.round(s/60); if(m<60)return 'vor '+m+' min';
    const h=Math.round(m/60); if(h<24)return 'vor '+h+' h';
    const d=Math.round(h/24); if(d<7)return 'vor '+d+' Tag'+(d>1?'en':'');
    return 'am '+new Date(ts).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit'});
  }
  function render(map){
    firstResponse=true;
    const now=Date.now();
    const ONLINE=150000;
    const list=Object.entries(map||{})
      .map(([id,s])=>({id,...s}))
      .filter(s=>s.name) // alle Profile (mit Name)
      .map(s=>{
        const onTs=s.online&&s.online.lastSeen?s.online.lastSeen:0;
        const online=onTs&&(now-onTs)<ONLINE;
        const seen=Math.max(onTs||0,s.lastSeen||0);
        return {...s,_online:online,_onTs:onTs,_seen:seen};
      })
      .sort((a,b)=>(b._seen||0)-(a._seen||0)||(a.name||'').localeCompare(b.name||''));
    const onlineCount=list.filter(s=>s._online).length;
    let h=header('👥 Spieler ('+onlineCount+' online)');
    h+='<div style="font-size:12px;color:var(--tx3);margin-bottom:10px">Alle Profile, nach „zuletzt online" sortiert. Grün = App aktuell geöffnet. Aktualisiert sich live.</div>';
    h+='<div class="card" style="padding:4px 0">';
    if(!list.length)h+='<div style="padding:12px;color:var(--tx3);font-size:13px">Keine Profile.</div>';
    list.forEach((s,i)=>{
      const dot=s._online?'var(--grn)':'var(--tx3)';
      const ver=(s.online&&s.online.version)||s.appVersion||'';
      const verTxt=ver?' · '+escHtml(ver):'';
      const status=(s._online?('aktiv '+agoText(s._onTs,now)):(s._seen?('zuletzt online '+agoText(s._seen,now)):'noch nie online'))+verTxt;
      h+='<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;'+(i<list.length-1?'border-bottom:1px solid var(--bdr)':'')+'">';
      h+='<span style="width:8px;height:8px;border-radius:50%;background:'+dot+';flex-shrink:0;'+(s._online?'':'opacity:.5')+'"></span>';
      h+='<div style="flex:1;min-width:0"><div style="font-weight:500;word-break:break-all">'+escHtml(s.name||'(ohne Name)')+(s.short?' <span style="color:var(--tx3);font-weight:400">· '+escHtml(s.short)+'</span>':'')+'</div>';
      h+='<div style="font-size:11px;color:var(--tx3)">'+status+'</div></div></div>';
    });
    h+='</div>';
    const cont=document.getElementById('adminModalContent');
    if(cont)cont.innerHTML=h;
  }
  startPresenceWatch(render,err=>{
    firstResponse=true;
    console.warn('presence watch error:',err);
    showMessage('🟢 Gerade online','Online-Status konnte nicht geladen werden.');
  });
  // Sicherheitsnetz: nie dauerhaft auf "Lädt…" haengen bleiben.
  setTimeout(()=>{if(!firstResponse)showMessage('🟢 Gerade online','Keine Daten – niemand online oder keine Verbindung.')},6000);
}

// ── Besondere Namen verwalten (Kursleiter/Spielleiter + Doko-Stammrunde) ──
// Arbeitskopie der Konfiguration; wird beim Hinzufügen/Entfernen/Speichern aus den Feldern gelesen.
let adminSpecial={kursleiter:[],dokoRunde:[]};
function specialHeader(){
  return '<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)">'
    +'<h3 style="margin:0">✨ Besondere Namen</h3>'
    +'<button onclick="adminRefresh()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Zurück">'+ICO.x+'</button></div>';
}
export async function adminSpecialNames(){
  const el=document.getElementById('adminModalContent');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--tx3)">Lädt…</div>';
  // Aktuelle Konfiguration aus Firebase laden (fällt sonst auf die aktiven/Default-Listen zurück).
  try{await loadSpecialNames();}catch(e){/* offline → aktive Listen */}
  adminSpecial=getSpecialNames();
  renderAdminSpecial();
}
// Liest die aktuellen Feldwerte in die Arbeitskopie (vor strukturellen Änderungen / Speichern).
function adminSpecialSync(){
  adminSpecial.kursleiter.forEach((k,i)=>{
    const n=document.getElementById('spkN'+i), e=document.getElementById('spkE'+i);
    if(n)k.name=n.value; if(e)k.emoji=e.value;
  });
  adminSpecial.dokoRunde.forEach((d,i)=>{
    const n=document.getElementById('spdN'+i);
    if(n)adminSpecial.dokoRunde[i]=n.value;
  });
}
function renderAdminSpecial(){
  const el=document.getElementById('adminModalContent');
  const inp='width:100%;box-sizing:border-box;font-size:14px;padding:8px 10px;border-radius:var(--r-sm);border:1px solid var(--bdr);background:var(--bg);color:var(--tx)';
  let h=specialHeader();
  h+='<div style="font-size:12px;color:var(--tx3);margin-bottom:12px;line-height:1.5">Diese Namen lösen die Easter-Eggs aus (Theme & Begrüßung). Änderungen gelten für alle Geräte. Groß-/Kleinschreibung egal.</div>';

  // Kursleiter / Spielleiter
  h+='<div class="section-label">🎓 Kursleiter / Spielleiter</div>';
  h+='<div style="font-size:11px;color:var(--tx3);margin-bottom:6px">Vollmodus (Theme + Vokabular), wenn genau diese vier zusammen spielen. Emoji optional.</div>';
  h+='<div class="card" style="padding:4px 0">';
  if(!adminSpecial.kursleiter.length)h+='<div style="padding:10px 12px;color:var(--tx3);font-size:13px">Keine Einträge.</div>';
  adminSpecial.kursleiter.forEach((k,i)=>{
    h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;'+(i<adminSpecial.kursleiter.length-1?'border-bottom:1px solid var(--bdr)':'')+'">';
    h+='<input id="spkN'+i+'" value="'+escHtml(k.name||'').replace(/"/g,'&quot;')+'" placeholder="Name" style="'+inp+';flex:1">';
    h+='<input id="spkE'+i+'" value="'+escHtml(k.emoji||'').replace(/"/g,'&quot;')+'" placeholder="Emoji" maxlength="4" style="'+inp+';width:64px;flex:none;text-align:center">';
    h+='<button onclick="adminSpecialDel(\'kursleiter\','+i+')" title="Entfernen" style="background:none;border:none;color:var(--red);cursor:pointer;width:30px;height:30px;flex-shrink:0">'+ICO.trash+'</button>';
    h+='</div>';
  });
  h+='</div>';
  h+='<button class="btn btn-secondary" style="width:100%;margin-top:8px;font-size:13px" onclick="adminSpecialAdd(\'kursleiter\')">+ Name hinzufügen</button>';

  // Doppelkopf-Stammrunde
  h+='<div class="section-label" style="margin-top:20px">🃏 Doppelkopf-Stammrunde</div>';
  h+='<div style="font-size:11px;color:var(--tx3);margin-bottom:6px">Begrüßung + Konfetti, wenn mindestens vier Spieler – und ausschließlich Namen aus dieser Liste – mitspielen.</div>';
  h+='<div class="card" style="padding:4px 0">';
  if(!adminSpecial.dokoRunde.length)h+='<div style="padding:10px 12px;color:var(--tx3);font-size:13px">Keine Einträge.</div>';
  adminSpecial.dokoRunde.forEach((d,i)=>{
    h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;'+(i<adminSpecial.dokoRunde.length-1?'border-bottom:1px solid var(--bdr)':'')+'">';
    h+='<input id="spdN'+i+'" value="'+escHtml(d||'').replace(/"/g,'&quot;')+'" placeholder="Name" style="'+inp+';flex:1">';
    h+='<button onclick="adminSpecialDel(\'dokoRunde\','+i+')" title="Entfernen" style="background:none;border:none;color:var(--red);cursor:pointer;width:30px;height:30px;flex-shrink:0">'+ICO.trash+'</button>';
    h+='</div>';
  });
  h+='</div>';
  h+='<button class="btn btn-secondary" style="width:100%;margin-top:8px;font-size:13px" onclick="adminSpecialAdd(\'dokoRunde\')">+ Name hinzufügen</button>';

  h+='<div style="display:flex;gap:8px;margin-top:20px">';
  h+='<button class="btn btn-secondary" style="flex:1" onclick="adminSpecialReset()">Standard</button>';
  h+='<button class="btn btn-primary" style="flex:1" onclick="adminSpecialSave()">Speichern</button></div>';
  el.innerHTML=h;
}
export function adminSpecialAdd(which){
  adminSpecialSync();
  if(which==='kursleiter')adminSpecial.kursleiter.push({name:'',emoji:''});
  else adminSpecial.dokoRunde.push('');
  renderAdminSpecial();
}
export function adminSpecialDel(which,i){
  adminSpecialSync();
  if(which==='kursleiter')adminSpecial.kursleiter.splice(i,1);
  else adminSpecial.dokoRunde.splice(i,1);
  renderAdminSpecial();
}
export async function adminSpecialReset(){
  if(!await showConfirm('Beide Listen auf die Standardwerte zurücksetzen? (Erst beim Speichern wirksam.)','Zurücksetzen'))return;
  adminSpecial=JSON.parse(JSON.stringify(SPECIAL_NAME_DEFAULTS));
  renderAdminSpecial();
}
export async function adminSpecialSave(){
  adminSpecialSync();
  // Leere Namen verwerfen, normalisieren.
  const cfg={
    kursleiter:adminSpecial.kursleiter.map(k=>({name:String(k.name||'').trim(),emoji:String(k.emoji||'').trim()})).filter(k=>k.name),
    dokoRunde:adminSpecial.dokoRunde.map(d=>String(d||'').trim()).filter(Boolean)
  };
  try{
    await saveSpecialNames(cfg);
    showToast('Besondere Namen gespeichert.','info');
    adminRefresh();
  }catch(e){console.error('adminSpecialSave:',e);showToast('Speichern fehlgeschlagen: '+(e&&e.message||e),'error');}
}
