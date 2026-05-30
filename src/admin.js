// admin.js – Admin-Bereich: vollstaendiger Firebase-Datenbank-Browser (CRUD).
// Nur fuer den Admin-Spieler sichtbar (siehe isAdmin in turnier.js).
// Navigiert durch den DB-Baum, erlaubt Anlegen/Bearbeiten (als JSON) und Loeschen
// beliebiger Knoten.

import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import { initFirebase, isAdmin } from './turnier.js';
import { showToast, showConfirm, showPrompt, ICO } from './ui.js';

// Aktueller Pfad als Array von Schluesseln (leer = Wurzel).
let adminPath=[];
// Kindschluessel des aktuellen Knotens (per Index in onclick referenziert -> kein Escaping noetig).
let adminKeys=[];
let adminCurrentVal=null;

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
  el.innerHTML='<div class="card" style="cursor:pointer;border-color:var(--acc)" onclick="openAdminModal()">'
    +'<div style="display:flex;align-items:center;gap:10px">'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--acc)"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
    +'<div><div style="font-weight:500">Admin – Datenbank</div><div style="font-size:11px;color:var(--tx3)">Alles einsehen, bearbeiten und löschen</div></div></div></div>';
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

export function closeAdminModal(){document.getElementById('adminModal').classList.remove('show')}

// Laedt den aktuellen Knoten und rendert die Ansicht neu.
async function adminLoad(){
  const el=document.getElementById('adminModalContent');
  el.innerHTML='<div style="padding:40px;text-align:center;color:var(--tx3)">Lädt…</div>';
  try{
    const snap=await refAt(pathStr()).once('value');
    adminCurrentVal=snap.val();
  }catch(e){
    console.error('admin load error:',e);
    el.innerHTML='<div style="padding:40px;text-align:center;color:var(--red)">Fehler: '+escHtml(e.message||e)+'</div>';
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

  // Toolbar
  h+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">';
  h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px" onclick="adminRefresh()">↻ Aktualisieren</button>';
  if(v!==null&&typeof v==='object')
    h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px" onclick="adminAddKey()">+ Schlüssel</button>';
  h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px" onclick="adminEditRaw()">'+ICO.edit+' JSON</button>';
  if(adminPath.length>0)
    h+='<button class="btn btn-secondary" style="width:auto;padding:7px 12px;font-size:12px;color:var(--red);border-color:var(--red)" onclick="adminDeleteCurrent()">'+ICO.trash+' Knoten löschen</button>';
  h+='</div>';

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
      h+='<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--bdr)">';
      if(isObj)
        h+='<a href="#" onclick="adminOpen('+i+');return false" style="flex:1;min-width:0;color:var(--tx);text-decoration:none;display:flex;justify-content:space-between;gap:8px;align-items:center"><span style="font-weight:500;word-break:break-all">'+escHtml(k)+'</span>'+preview(child)+'<span style="color:var(--tx3)">›</span></a>';
      else{
        h+='<div style="flex:1;min-width:0;display:flex;justify-content:space-between;gap:8px;align-items:center"><span style="font-weight:500;word-break:break-all">'+escHtml(k)+'</span>'+preview(child)+'</div>';
        h+='<button onclick="adminEditKey('+i+')" title="Bearbeiten" style="background:none;border:none;color:var(--tx2);cursor:pointer;width:30px;height:30px;flex-shrink:0">'+ICO.edit+'</button>';
      }
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
