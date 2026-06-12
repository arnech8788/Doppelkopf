// main.js – Entry Point: State, Konstanten, Navigation, Theme, Info/Debug, PWA
// Geteilter mutabler State lebt hier (export let + Setter), da er aus mehreren Modulen geschrieben wird.

import { registerSW } from 'virtual:pwa-register';
import { showToast, hideToast, showConfirm, showPrompt, ICO, launchConfetti, launchMiniConfetti } from './ui.js';
// Geschwister-Module: als Namespace importiert, damit ihr Top-Level-Code (Event-Listener,
// Autocomplete-Init) laeuft UND alle Funktionen unten auf window registriert werden koennen.
import * as setup from './setup.js';
import * as eingabe from './eingabe.js';
import * as tabelle from './tabelle.js';
import * as stats from './stats.js';
import * as archiv from './archiv.js';
import * as turnier from './turnier.js';
import * as admin from './admin.js';
import * as cloud from './cloud.js';
import * as game from './game.js';
import * as share from './share.js';
import * as liga from './liga.js';
import * as audit from './audit.js';

// Zentrale App-Version (zuverlässige Quelle, auch wenn das #versionLabel noch nicht im DOM ist).
export const APP_VERSION='v6.41';
const APP_VERSION_DATE='12.06.2026 18:30';

// ── Debug-Logging (console.error/warn abfangen) ──
const _debugLogs=[];
const _origConsoleError=console.error;
const _origConsoleWarn=console.warn;
console.error=function(){_debugLogs.push({type:'error',msg:[...arguments].map(a=>typeof a==='string'?a:JSON.stringify(a)).join(' '),ts:Date.now()});if(_debugLogs.length>50)_debugLogs.shift();_origConsoleError.apply(console,arguments)};
console.warn=function(){_debugLogs.push({type:'warn',msg:[...arguments].map(a=>typeof a==='string'?a:JSON.stringify(a)).join(' '),ts:Date.now()});if(_debugLogs.length>50)_debugLogs.shift();_origConsoleWarn.apply(console,arguments)};

// ── Konstanten ──
export const COLORS=['#5b4cdb','#0a8f6a','#c0392b','#d68910','#2980b9','#7c6fef','#16a085','#e74c3c','#f39c12','#3498db'];
export const DEFAULT_SOLOS=[
  {name:'Fleischlos',short:'FL',enabled:true},
  {name:'Damensolo',short:'Da',enabled:true},
  {name:'Bubensolo',short:'Bu',enabled:true},
  {name:'Trumpfsolo',short:'Tr',enabled:true},
  {name:'Stille Hochzeit',short:'SH',enabled:true},
  {name:'Hängen gel. Hochzeit',short:'HH',enabled:true}
];
export const ACHIEVEMENTS={
  evening:{
    hotStreak:{name:'Hot Streak',emoji:'🔥',desc:'5 Siege in Folge'},
    comebackKid:{name:'Comeback Kid',emoji:'📈',desc:'Von letztem auf Platz 1'},
    solist:{name:'Solist',emoji:'🎭',desc:'3 Soli an einem Abend'},
    unbesiegbar:{name:'Unbesiegbar',emoji:'🛡️',desc:'Keine Niederlage (mind. 5 Spiele)'},
    pechvogel:{name:'Pechvogel',emoji:'🤦',desc:'5 Niederlagen in Folge'}
  },
  season:{
    stammgast:{name:'Stammgast',emoji:'🏠',desc:'5 Spielabende dabei'},
    veteran:{name:'Veteran',emoji:'⭐',desc:'100 Spiele gespielt'},
    soloKoenig:{name:'Solokönig',emoji:'👑',desc:'10 Solos gewonnen'},
    dominator:{name:'Dominator',emoji:'💪',desc:'3× Bester des Abends'},
    dauersieger:{name:'Dauersieger',emoji:'🏆',desc:'5× hintereinander Top 2'},
    marathon:{name:'Marathon',emoji:'🏃',desc:'50 Spiele an einem Abend'}
  }
};

// ── Geteilter State ──
export let state={myPlayer:'',players:[],rounds:[],knownNames:[],bockEnabled:false,bockCount:4,bockSolo:false,bockQueue:0,soloTypesEnabled:false,soloTypes:JSON.parse(JSON.stringify(DEFAULT_SOLOS)),gameStartTime:null,kursleiterCupSeen:false,dokoRundeSeen:false,archiveMax:10,turnier:null,sharedGame:null,cloudBackup:false,uiCollapsed:{},dokoGame:null,dokoTotals:null,dokoDealer:0,dokoMitNeunen:true,dokoAuto:false,ligen:[],ligaAskOnEnd:true,ligaDefaultCode:''};
export let currentPts='';
export let pendingRound=null;
export let lastUndo=null;
export let viewingArchive=null;
export let prerenderedTabelle=null;
export let prerenderedStats=null;
export let timerInterval=null;

// ── Setter fuer geteilten mutablen State (ESM-Exports sind nur lesbar) ──
export function setCurrentPts(v){currentPts=v}
export function setPendingRound(v){pendingRound=v}
export function setLastUndo(v){lastUndo=v}
export function setViewingArchive(v){viewingArchive=v}
export function setPrerenderedTabelle(v){prerenderedTabelle=v}
export function setPrerenderedStats(v){prerenderedStats=v}
export function setTimerInterval(v){timerInterval=v}

// ── Geraete-Info (Debug) ──
export async function getDeviceInfo(){
  const info={appVersion:'',browser:'',os:'',model:'',screen:'',viewport:'',dpr:'',theme:'',online:'',sw:''};
  // App-Version aus Fußzeile
  const verEl=document.getElementById('versionLabel');
  info.appVersion=verEl?verEl.textContent.trim():'unbekannt';
  // User-Agent Client Hints (Chromium only)
  try{
    if(navigator.userAgentData){
      const hints=await navigator.userAgentData.getHighEntropyValues(['model','platformVersion','fullVersionList']);
      info.model=hints.model||'';
      info.os=navigator.userAgentData.platform+(hints.platformVersion?' '+hints.platformVersion:'');
      const br=hints.fullVersionList&&hints.fullVersionList.find(b=>b.brand!=='Not'&&!b.brand.includes('Chromium')&&!b.brand.includes('Not'));
      info.browser=br?br.brand+' '+br.version:navigator.userAgentData.brands.map(b=>b.brand+' '+b.version).join(', ');
    }
  }catch(e){}
  // Fallback: User-Agent parsing
  if(!info.browser||!info.os){
    const ua=navigator.userAgent;
    if(!info.os){
      if(/iPhone|iPad/.test(ua)){info.os='iOS';const m=ua.match(/OS (\d+[_\.]\d+)/);if(m)info.os='iOS '+m[1].replace('_','.');if(!info.model)info.model=/iPad/.test(ua)?'iPad':'iPhone'}
      else if(/Android/.test(ua)){info.os='Android';const m=ua.match(/Android ([\d.]+)/);if(m)info.os='Android '+m[1];if(!info.model){const dm=ua.match(/;\s*([^;)]+)\s*Build/);if(dm)info.model=dm[1].trim()}}
      else if(/Windows/.test(ua))info.os='Windows';
      else if(/Mac OS/.test(ua))info.os='macOS';
      else if(/Linux/.test(ua))info.os='Linux';
    }
    if(!info.browser){
      if(/CriOS\/([\d.]+)/.test(ua))info.browser='Chrome '+RegExp.$1;
      else if(/FxiOS\/([\d.]+)/.test(ua))info.browser='Firefox '+RegExp.$1;
      else if(/EdgA?\/([\d.]+)/.test(ua))info.browser='Edge '+RegExp.$1;
      else if(/SamsungBrowser\/([\d.]+)/.test(ua))info.browser='Samsung '+RegExp.$1;
      else if(/Chrome\/([\d.]+)/.test(ua))info.browser='Chrome '+RegExp.$1;
      else if(/Safari\/([\d.]+)/.test(ua)&&/Version\/([\d.]+)/.test(ua))info.browser='Safari '+RegExp.$1;
      else info.browser=ua.substring(0,80);
    }
  }
  info.screen=screen.width+'×'+screen.height;
  info.dpr=devicePixelRatio+'x';
  info.viewport=innerWidth+'×'+innerHeight;
  info.theme=document.documentElement.getAttribute('data-theme')||'light';
  info.online=navigator.onLine?'Ja':'Nein';
  // Service Worker
  try{
    const reg=await navigator.serviceWorker.getRegistration();
    if(reg&&reg.active)info.sw=reg.active.scriptURL.split('/').pop()+' (aktiv)';
    else if(reg&&reg.waiting)info.sw='wartend';
    else info.sw='keine';
  }catch(e){info.sw='nicht verfügbar'}
  return info;
}


// ── Persistenz ──
export function load(){
  try{const s=localStorage.getItem('doko-v4');if(s){const d=JSON.parse(s);Object.assign(state,d)}}catch(e){}
  // Abend-Achievements am aktuellen Abend ausrichten (heilt haengengebliebene Badges, ohne Toast).
  try{eingabe.refreshEveningAchievements({announce:false})}catch(e){}
  renderTurnierIndicator();
  if(getAllPlayers().length>=4)showScreen('eingabe');
  else showScreen('spieler');
  checkFirstStart();
  checkTurnierUrlParam();
  share.checkSpielUrlParam();
  liga.checkLigaUrlParam();
  if(state.sharedGame&&state.sharedGame.mode==='live')share.subscribe();
  restoreTischPlayers();
}
export function save(){
  const bockToggle=document.getElementById('bockEnabledToggle');
  if(bockToggle)state.bockEnabled=bockToggle.classList.contains('on');
  const bockCountEl=document.getElementById('bockCount');
  if(bockCountEl)state.bockCount=parseInt(bockCountEl.value)||4;
  const bockSoloToggle=document.getElementById('bockSoloToggle');
  if(bockSoloToggle)state.bockSolo=bockSoloToggle.classList.contains('on');
  const soloToggle=document.getElementById('soloTypesToggle');
  if(soloToggle)state.soloTypesEnabled=soloToggle.classList.contains('on');
  try{localStorage.setItem('doko-v4',JSON.stringify(state))}catch(e){}
  cloud.scheduleBackup();
  share.scheduleSharedPush();
}

// ── Einklappbare Kategorien (Mehr & Einstellungen) ──
// Default: eingeklappt. Zustand pro scope:id in state.uiCollapsed (localStorage).
export function collapseKey(scope,id){return scope+':'+id}
export function isCollapsed(scope,id){
  const v=state.uiCollapsed&&state.uiCollapsed[collapseKey(scope,id)];
  return v===undefined?true:v; // fehlend = eingeklappt
}
// Baut eine .card mit klickbarem Titel-Header (Chevron) und einklappbarem Body.
// bodyHtml-IDs bleiben erhalten -> async-Filler/save() finden ihre Elemente weiter.
export function renderCollapsibleCard(scope,id,title,bodyHtml){
  const open=!isCollapsed(scope,id);
  return '<div class="card collapse-card">'
    +'<div class="card-title collapse-head" onclick="toggleCollapse(\''+scope+'\',\''+id+'\')">'
    +'<span>'+title+'</span>'
    +'<svg class="chev'+(open?' open':'')+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="9 18 15 12 9 6"/></svg>'
    +'</div>'
    +'<div class="collapse-body'+(open?' show':'')+'" id="cb-'+scope+'-'+id+'">'+bodyHtml+'</div>'
    +'</div>';
}
// Togglet nur DOM-Klassen (kein Re-Render) -> async geladene Inhalte/Eingaben bleiben erhalten.
export function toggleCollapse(scope,id){
  if(!state.uiCollapsed)state.uiCollapsed={};
  const open=!isCollapsed(scope,id);          // aktueller offen-Zustand
  state.uiCollapsed[collapseKey(scope,id)]=open; // neuer collapsed-Zustand = vorher offen
  const body=document.getElementById('cb-'+scope+'-'+id);
  if(body){
    body.classList.toggle('show');
    const head=body.previousElementSibling;
    const chev=head&&head.querySelector('.chev');
    if(chev)chev.classList.toggle('open');
  }
  save();
}

// ── Einstellungen-Modal ──
export function openSettings(){
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)"><h3 style="margin:0">Einstellungen</h3><button onclick="closeSettings()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen">'+ICO.x+'</button></div>';

  // Mein Profil (Name + Kürzel anpassbar, ID read-only) – async befüllt
  html+=renderCollapsibleCard('settings','profile','Mein Profil','<div id="profileSettings"><div style="font-size:12px;color:var(--tx3)">Lädt…</div></div>');

  // Cloud-Backup (opt-in, Profil vorausgesetzt) – async befüllt
  html+=renderCollapsibleCard('settings','cloud','Cloud-Backup','<div id="cloudSettings"><div style="font-size:12px;color:var(--tx3)">Lädt…</div></div>');

  // Solo-Arten
  let soloBody='<div class="toggle-row" style="padding:4px 0"><span class="toggle-label">Solo-Art abfragen</span><button class="toggle'+(state.soloTypesEnabled?' on':'')+'" id="soloTypesToggle" onclick="this.classList.toggle(\'on\');save()"></button></div>';
  soloBody+='<div style="font-size:12px;color:var(--tx3);margin-top:4px">Bei einem Solo wird nach der Art gefragt</div>';
  soloBody+='<div id="soloTypesList"></div>';
  soloBody+='<div style="display:flex;gap:6px;margin-top:8px"><input type="text" id="customSoloInput" placeholder="Eigenes Solo..." style="font-size:13px;padding:8px 10px"><button class="btn btn-secondary" style="width:auto;padding:8px 14px;font-size:13px" onclick="addCustomSolo()">+</button></div>';
  html+=renderCollapsibleCard('settings','solo','Solo-Arten erfassen',soloBody);

  // Bockrunden
  let bockBody='<div class="toggle-row" style="padding:4px 0"><span class="toggle-label">Bockrunden aktiviert</span><button class="toggle'+(state.bockEnabled?' on':'')+'" id="bockEnabledToggle" onclick="this.classList.toggle(\'on\');save()"></button></div>';
  bockBody+='<div class="settings-row"><span>Spiele pro Bockrunde</span><input type="number" id="bockCount" value="'+(state.bockCount||4)+'" min="1" max="20" onchange="save()"></div>';
  bockBody+='<div style="font-size:11px;color:var(--tx3);padding:4px 0 8px">Standard: Anzahl der Mitspieler</div>';
  bockBody+='<div class="settings-row"><span>Bock gilt auch bei Solo</span><button class="toggle'+(state.bockSolo?' on':'')+'" id="bockSoloToggle" onclick="this.classList.toggle(\'on\');save()"></button></div>';
  html+=renderCollapsibleCard('settings','bock','Bockrunden',bockBody);

  // Archiv
  let archivBody='<div class="settings-row"><span>Max. archivierte Spiele</span><input type="number" id="archiveMax" value="'+(state.archiveMax||10)+'" min="1" max="50" onchange="state.archiveMax=parseInt(this.value)||10;save()"></div>';
  html+=renderCollapsibleCard('settings','archive','Archiv',archivBody);

  // Liga – Spielende-Verhalten
  let ligaBody='<div class="toggle-row" style="padding:4px 0"><span class="toggle-label">Beim Spielende fragen, ob in eine Liga aufnehmen</span><button class="toggle'+(state.ligaAskOnEnd!==false?' on':'')+'" onclick="this.classList.toggle(\'on\');state.ligaAskOnEnd=this.classList.contains(\'on\');save()"></button></div>';
  const ligaOpts=(state.ligen||[]).map(l=>'<option value="'+l.code+'"'+(state.ligaDefaultCode===l.code?' selected':'')+'>'+((l.name||('LG-'+l.code)).replace(/</g,'&lt;'))+'</option>').join('');
  ligaBody+='<div class="settings-row"><span>Standard-Liga (Vorschlag)</span><select onchange="state.ligaDefaultCode=this.value;save()"><option value=""'+(!state.ligaDefaultCode?' selected':'')+'>— jedes Mal fragen —</option>'+ligaOpts+'</select></div>';
  ligaBody+='<div style="font-size:11px;color:var(--tx3);padding:4px 0">Ist die Frage aus, kannst du Spiele später über die Liga oder das Spiele-Archiv („In Liga") aufnehmen.</div>';
  html+=renderCollapsibleCard('settings','liga','Liga',ligaBody);

  // Darstellung
  const isLight=document.documentElement.getAttribute('data-theme')==='light';
  let darstBody='<div class="toggle-row" style="padding:4px 0"><span class="toggle-label">Dark Mode</span><button class="toggle'+(!isLight?' on':'')+'" onclick="this.classList.toggle(\'on\');toggleTheme()"></button></div>';
  // Akzentfarbe frei wählbar
  const presets=['#2563eb','#7c3aed','#db2777','#dc2626','#ea580c','#16a34a','#0891b2','#ca8a04'];
  const curAcc=(localStorage.getItem('doko-accent')||'').toLowerCase();
  darstBody+='<div style="margin-top:12px"><span class="toggle-label">Akzentfarbe</span>';
  darstBody+='<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:8px">';
  darstBody+='<button onclick="setAccent(\'\')" title="Standard" style="width:30px;height:30px;border-radius:50%;cursor:pointer;background:linear-gradient(135deg,#1a9e8f,#2ec4b6);border:3px solid '+(curAcc?'var(--bdr)':'var(--tx)')+'"></button>';
  presets.forEach(col=>{
    darstBody+='<button onclick="setAccent(\''+col+'\')" style="width:30px;height:30px;border-radius:50%;cursor:pointer;background:'+col+';border:3px solid '+(curAcc===col?'var(--tx)':'var(--bdr)')+'"></button>';
  });
  darstBody+='<label title="Eigene Farbe" style="width:30px;height:30px;border-radius:50%;cursor:pointer;border:1px dashed var(--bdr);display:inline-flex;align-items:center;justify-content:center;position:relative;overflow:hidden;font-size:14px">🎨<input type="color" value="'+(curAcc||'#1a9e8f')+'" onchange="setAccent(this.value)" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%"></label>';
  darstBody+='</div></div>';
  // Hintergrundfarbe frei wählbar (abgestuft, Textkontrast automatisch)
  const bgPresets=['#0f1310','#10161f','#1c1622','#241a1a','#eef2f7','#f3eefa','#fbf0ee','#eef5ee'];
  const curBg=(localStorage.getItem('doko-bg')||'').toLowerCase();
  darstBody+='<div style="margin-top:16px"><span class="toggle-label">Hintergrundfarbe</span>';
  darstBody+='<div style="font-size:11px;color:var(--tx3);margin-top:2px">Textfarbe passt sich automatisch an</div>';
  darstBody+='<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:8px">';
  darstBody+='<button onclick="setBg(\'\')" title="Standard" style="width:30px;height:30px;border-radius:50%;cursor:pointer;background:linear-gradient(135deg,var(--bg),var(--bg3));border:3px solid '+(curBg?'var(--bdr)':'var(--tx)')+'"></button>';
  bgPresets.forEach(col=>{
    darstBody+='<button onclick="setBg(\''+col+'\')" style="width:30px;height:30px;border-radius:50%;cursor:pointer;background:'+col+';border:3px solid '+(curBg===col?'var(--tx)':'var(--bdr)')+'"></button>';
  });
  darstBody+='<label title="Eigene Farbe" style="width:30px;height:30px;border-radius:50%;cursor:pointer;border:1px dashed var(--bdr);display:inline-flex;align-items:center;justify-content:center;position:relative;overflow:hidden;font-size:14px">🎨<input type="color" value="'+(curBg||'#0f1310')+'" onchange="setBg(this.value)" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%"></label>';
  darstBody+='</div></div>';
  html+=renderCollapsibleCard('settings','darstellung','Darstellung',darstBody);

  // Debug
  html+='<div class="card" style="cursor:pointer" onclick="closeSettings();openDebugModal()"><div style="display:flex;align-items:center;gap:10px"><span style="font-size:18px">&#128295;</span><div><div style="font-weight:500">Debug-Modus</div><div style="font-size:11px;color:var(--tx3)">Geräteinfos, State, Logs</div></div></div></div>';

  html+='<button class="btn btn-secondary" style="margin-top:16px;position:sticky;bottom:0" onclick="closeSettings()">Schließen</button>';
  document.getElementById('settingsModalContent').innerHTML=html;
  document.getElementById('settingsModal').classList.add('show');
  setup.renderSoloTypes();
  turnier.fillProfileSettings();
  cloud.fillCloudSettings();
}
export function closeSettings(){document.getElementById('settingsModal').classList.remove('show')}
document.getElementById('settingsModal').addEventListener('click',function(e){if(e.target===this)closeSettings()});

// ── Screen-Navigation ──
export function showScreen(id){
  if(viewingArchive&&(id==='mehr'||id==='eingabe'||id==='spieler'))viewingArchive=null;
  document.querySelectorAll('.screen').forEach(s=>{s.classList.remove('active')});
  document.getElementById('screen-'+id).classList.add('active');
  document.querySelectorAll('.bottom-nav button').forEach((b,i)=>{b.classList.toggle('active',['spieler','eingabe','tabelle','stats','mehr'][i]===id)});
  // Kopfzeile: zeigt den Namen des aktiven Screens (eine einzige Titelzeile)
  const TITLES={spieler:'Spieler',eingabe:'Eingabe',tabelle:'Spielverlauf',stats:'Statistiken',mehr:'Mehr'};
  const titleEl=document.getElementById('appTitle');
  if(titleEl)titleEl.textContent=TITLES[id]||'Eingabe';
  const shareBtn=document.getElementById('headerShareBtn');
  if(shareBtn)shareBtn.style.display=(id==='tabelle'||id==='stats')?'':'none';
  if(id==='eingabe'){
    const el=document.getElementById('eingabeContent');
    if(!el.dataset.roundCount||parseInt(el.dataset.roundCount)!==state.rounds.length){
      renderEingabe();
      el.dataset.roundCount=state.rounds.length;
    }
  }
  if(id==='eingabe')renderTurnierIndicator();
  if(id==='tabelle')renderTabelle(true);
  if(id==='stats'){renderStats();schedulePrerenderShareImages();}
  if(id==='mehr')renderMehrScreen();
  if(id==='spieler')renderSpielerScreen();
}

// Teilen-Aktion der Kopfzeile – leitet je nach aktivem Screen weiter
export function shareCurrentScreen(){
  if(document.getElementById('screen-stats').classList.contains('active'))shareStats();
  else shareTabelle();
}


// ── Spieler-Helfer ──
export function getAllPlayers(){return [...state.players]}

// Alle Spieler die je in einer Runde mitgespielt haben
// (auch gelöschte – aktuelle Spieler haben Vorrang in der Reihenfolge)
export function getHistoricalPlayers(){
  const seen=new Set(state.players);
  const list=[...state.players];
  state.rounds.forEach(r=>{
    r.playing.forEach(p=>{
      if(!seen.has(p)){seen.add(p);list.push(p)}
    });
  });
  return list;
}

// Berechnet pro Spielerliste eindeutige Kürzel (z. B. für Tabellenüberschrift)
// Wächst so weit wie nötig damit alle eindeutig sind – ohne Längenbegrenzung.
// "Christoph" und "Christopher" werden zu "Christoph" und "Christophe".
// Mindestlänge: 4 Zeichen.
export function getShortNames(playerList){
  const result={};
  const minLen=4;
  playerList.forEach(p=>{
    if(p.length<=minLen){result[p]=p;return}
    // Finde die minimale Länge bei der dieses Kürzel eindeutig ist
    for(let len=minLen;len<=p.length;len++){
      const prefix=p.substring(0,len);
      const collides=playerList.some(o=>o!==p&&o.substring(0,len).toLowerCase()===prefix.toLowerCase());
      if(!collides){
        result[p]=prefix;
        return;
      }
    }
    // Fallback: voller Name (sollte nicht passieren wenn Namen unterschiedlich sind)
    result[p]=p;
  });
  return result;
}

// ═══════════════════════════════════════════════════════════
// Easter Egg: Kursleiter-Cup
// Vollmodus: genau die 4 Kursleiter aktiv (Theme + Vokabular)
// Mini: mind. 1 Kursleiter dabei, egal wer sonst (nur Badge)
// ═══════════════════════════════════════════════════════════

// ── Easter Eggs + Cache-Invalidierung ──
const KURSLEITER_NAMES=['jonas','lars','julia','jens'];
const KURSLEITER_EMOJIS={jonas:'📚',lars:'🎓',julia:'🍎',jens:'✏️'};
const KURSLEITER_VOCAB={
  solo:'Frontalunterricht',
  bockrunde:'Doppelstunde',
  spiel:'Lektion'
};

export function isKursleiterMode(){
  const active=state.players.map(p=>p.toLowerCase());
  if(active.length!==4)return false;
  return KURSLEITER_NAMES.every(n=>active.includes(n));
}
// Mini-Modus: mind. 1 Kursleiter dabei, aber NICHT alle 4 (sonst Vollmodus)
// Egal wer sonst dabei ist
export function isKursleiterMiniMode(){
  if(isKursleiterMode())return false;
  const active=state.players.map(p=>p.toLowerCase());
  return KURSLEITER_NAMES.some(n=>active.includes(n));
}

// ═══════════════════════════════════════════════════════════
// Easter Egg: Doko-Stammrunde
// Aktiv wenn mindestens 4 aktive Spieler aus der Liste sind UND keine Fremden
// Nur Konfetti + Hinweis – keine Emojis, kein Vokabular-Switch
// ═══════════════════════════════════════════════════════════
const DOKO_RUNDE_NAMES=['alisa','arne','christoph','eva','lena','lisa','sarah','annabelle','moritz'];

export function isDokoRundeMode(){
  const active=state.players.map(p=>p.toLowerCase());
  if(active.length<4)return false;
  // Keine Fremden zugelassen
  if(!active.every(p=>DOKO_RUNDE_NAMES.includes(p)))return false;
  // Mindestens 4 müssen es sein
  return active.length>=4;
}

// Liefert Emoji für einen Spieler – aktuell nur für Kursleiter (Voll- oder Mini-Modus)
export function getPlayerEmoji(name){
  const key=name.toLowerCase();
  if(isKursleiterMode()||isKursleiterMiniMode()){
    if(KURSLEITER_EMOJIS[key])return KURSLEITER_EMOJIS[key];
  }
  return '';
}

// Welches Vokabular gerade gilt – nur Kursleiter-Vollmodus überschreibt
export function getVocab(){
  if(isKursleiterMode())return KURSLEITER_VOCAB;
  return {solo:'Solo',bockrunde:'Bockrunde',spiel:'Spiel'};
}

// Wird aufgerufen wenn sich die Spielerliste ändert –
// damit der Eingabe-Screen beim nächsten Aufruf garantiert neu gerendert wird
export function invalidateEingabeCache(){
  const el=document.getElementById('eingabeContent');
  if(el)delete el.dataset.roundCount;
}


// ── Bockrunde ──
export function isBockRound(){return state.bockEnabled&&state.bockQueue>0}


// ── Mehr-Screen ──
export function renderMehrScreen(){
  const el=document.getElementById('mehrContent');
  if(!el)return;
  let html='';
  html+='<div id="archiveList"></div>';
  html+=renderCollapsibleCard('mehr','turnier','Turnier','<div id="turnierSetupContent"></div>');
  html+=renderCollapsibleCard('mehr','liga','Liga','<div id="ligaSetupContent"></div>');
  html+='<div class="card" style="cursor:pointer" onclick="openFeedbackModal()"><div style="display:flex;align-items:center;gap:10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--acc2)"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg><div><div style="font-weight:500">Feedback &amp; Bugs</div><div style="font-size:11px;color:var(--tx3)">Rückmeldung senden</div></div></div></div>';
  html+='<div class="card" style="cursor:pointer" onclick="openChangelogModal()"><div style="display:flex;align-items:center;gap:10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--acc2)"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><div><div style="font-weight:500">Changelog</div><div style="font-size:11px;color:var(--tx3)">Versionshistorie · v6.41</div></div></div></div>';
  html+='<div class="card" style="cursor:pointer" onclick="checkForUpdate()"><div style="display:flex;align-items:center;gap:10px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--acc2)"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg><div><div style="font-weight:500">Nach Updates suchen</div><div style="font-size:11px;color:var(--tx3)">Neueste Version sofort laden</div></div></div></div>';
  html+='<div id="adminEntrySlot"></div>';
  html+='<div id="gameEntrySlot"></div>';
  html+='<div id="versionLabel" style="text-align:center;margin-top:24px;font-size:10px;color:var(--tx3);opacity:.5;cursor:default;-webkit-user-select:none;user-select:none" onclick="handleVersionTap()">'+APP_VERSION+' · '+APP_VERSION_DATE+'</div>';
  el.innerHTML=html;
  renderArchiveList();
  renderTurnierSetup();
  liga.renderLigaSetup();
  admin.fillAdminEntry();
  game.fillGameEntry();
}

// ── Info-/Debug-Modal, Version-Tap ──
export async function openInfoModal(){
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)"><h3 style="margin:0">&#9824; Doppelkopf Punktezettel</h3><button onclick="closeInfoModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';

  // App-Überblick
  html+='<div class="section-label">So funktioniert die App</div>';
  html+='<div class="card" style="font-size:12px;color:var(--tx2);line-height:1.6">';
  html+='<div style="margin-bottom:10px;color:var(--tx3)">Unten gibt es fünf Tabs: <strong>Spieler · Eingabe · Tabelle · Statistik · Mehr</strong>.</div>';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">👥 Spieler</div>';
  html+='<div style="margin-bottom:10px">Spieler hinzufügen, umbenennen, sortieren. Der <strong>erste Spieler in der Liste gibt zuerst die Karten</strong> – danach rotiert der Geber automatisch. Weitere Optionen (Bockrunden, Solo-Arten, Cloud-Backup, Liga-Optionen, Darstellung) findest du unter <strong>Einstellungen (Zahnrad oben)</strong>.</div>';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">➕ Eingabe</div>';
  html+='<div style="margin-bottom:10px">Punkte eintippen, Spieler antippen: <strong>rot = verloren</strong>, <strong>grün = gewonnen</strong>. Es müssen genau 4 mitspielen. Wer pausiert bleibt grau. Mit dem ± Button kannst du auch <strong>negative Punkte</strong> eintragen (z. B. wenn die Gewinner trotzdem unterm Strich verlieren).</div>';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">📋 Tabelle</div>';
  html+='<div style="margin-bottom:10px">Aktuelle Rangliste und alle Spiele chronologisch. Tippe auf ein Spiel um Details aufzuklappen (Geber, Dauer, Einzelpunkte). Über das Drei-Punkte-Menü kannst du Spiele bearbeiten, verschieben oder löschen.</div>';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">📊 Statistik</div>';
  html+='<div style="margin-bottom:10px">Punkteverlauf, Siege/Niederlagen, Solo-Quote, Lieblings-Teampartner und mehr. Solokönig und Bester Spieler werden automatisch ermittelt.</div>';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">⋯ Mehr</div>';
  html+='<div style="margin-bottom:4px">• <strong>Vergangene Spiele &amp; Ewige Tabelle</strong> – Archiv aller beendeten Abende mit Gesamtauswertung.</div>';
  html+='<div style="margin-bottom:4px">• <strong>Turnier</strong> – ein Spielabend live: mehrere Tische, Rotation, Dashboard, Beitritt per Code/QR. Für <em>ein</em> Event.</div>';
  html+='<div style="margin-bottom:4px">• <strong>Liga</strong> – dauerhafte Gesamttabelle über viele Abende: Spiele/Punkte je Termin sammeln, Rangliste, Spieler-Roster. Beim Spielende kann ein Spiel in eine Liga aufgenommen werden (in den Einstellungen abschaltbar).</div>';
  html+='<div style="margin-bottom:4px">• <strong>Doppelkopf gegen den Computer</strong> – für freigeschaltete Spieler bzw. Admins.</div>';
  html+='<div style="margin-bottom:10px">• Feedback &amp; Bugs, Changelog, „Nach Updates suchen".</div>';
  html+='</div>';

  // Besonderheiten
  html+='<div class="section-label" style="margin-top:16px">Besonderheiten</div>';
  html+='<div class="card" style="font-size:12px;color:var(--tx2);line-height:1.6">';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">🔥 Siegesserie</div>';
  html+='<div style="margin-bottom:4px">🔥 ab <strong>2 Siegen</strong> in Folge</div>';
  html+='<div style="margin-bottom:4px">🔥🔥 ab <strong>4 Siegen</strong> in Folge</div>';
  html+='<div style="margin-bottom:10px">🔥🔥🔥 ab <strong>6 Siegen</strong> in Folge. Sichtbar in Eingabe und Rangliste. Verschwindet bei einer Niederlage. Pausierte Spiele unterbrechen die Serie <strong>nicht</strong>.</div>';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">💀 Pech-Serie</div>';
  html+='<div style="margin-bottom:4px">💀 ab <strong>2 Niederlagen</strong> in Folge</div>';
  html+='<div style="margin-bottom:4px">💀💀 ab <strong>4 Niederlagen</strong> in Folge</div>';
  html+='<div style="margin-bottom:10px">💀💀💀 ab <strong>6 Niederlagen</strong> in Folge. Verschwindet bei einem Sieg.</div>';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">🎉 Konfetti-Animation</div>';
  html+='<div style="margin-bottom:4px">• Bei einem <strong>gewonnenen Solo</strong> (1 Spieler gegen 3)</div>';
  html+='<div style="margin-bottom:10px">• Bei einem <strong>Führungswechsel</strong> in der Rangliste</div>';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">🃏 Bockrunden</div>';
  html+='<div style="margin-bottom:10px">Wenn aktiviert, kann jedes Spiel eine neue Bockrunde auslösen (Toggle vor dem Speichern). Während einer Bockrunde zählen alle Punkte <strong>doppelt</strong>. Optional auch für Soli.</div>';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">↩️ Rückgängig</div>';
  html+='<div style="margin-bottom:10px">Nach jedem gespeicherten Spiel erscheint unter dem Speichern-Button ein dezenter "Rückgängig"-Button.</div>';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">📱 Als App installieren</div>';
  html+='<div style="margin-bottom:4px">iPhone: In Safari öffnen → Teilen → "Zum Home-Bildschirm"</div>';
  html+='<div style="margin-bottom:10px">Android: In Chrome öffnen → Menü → "App installieren"</div>';
  html+='<div style="font-weight:700;margin-bottom:6px;color:var(--tx)">🔄 Updates</div>';
  html+='<div>Neue Versionen werden im Hintergrund erkannt. Oben erscheint dann ein Hinweis; getippt wird nicht unterbrochen, sonst lädt die App selbstständig neu. Du kannst jederzeit unter „Mehr → Nach Updates suchen" manuell prüfen und sofort aktualisieren.</div>';
  html+='</div>';

  // Easter Egg Hinweis nur wenn aktiv
  if(isKursleiterMode()){
    html+='<div class="section-label" style="margin-top:16px">🎓 Kursleiter-Cup aktiv</div>';
    html+='<div class="card" style="font-size:12px;color:var(--tx2);line-height:1.6">';
    html+='<div>Sieh an, vier ganz bestimmte Namen … Genießt euren Doppelkopf-Abend!</div>';
    html+='<div style="margin-top:8px">📚 Jonas · 🎓 Lars · 🍎 Julia · ✏️ Jens</div>';
    html+='</div>';
  }else if(isKursleiterMiniMode()){
    const count=state.players.filter(p=>KURSLEITER_NAMES.includes(p.toLowerCase())).length;
    html+='<div class="section-label" style="margin-top:16px">🎓 Achievement</div>';
    html+='<div class="card" style="font-size:12px;color:var(--tx2);line-height:1.6">';
    html+='<div>'+count+' Kursleiter dabei. Wenn alle vier zusammen spielen, gibt es einen Spezial-Modus!</div>';
    html+='</div>';
  }
  if(isDokoRundeMode()){
    html+='<div class="section-label" style="margin-top:16px">🃏 Doko-Stammrunde</div>';
    html+='<div class="card" style="font-size:12px;color:var(--tx2);line-height:1.6">';
    html+='<div>Schön, dass die Stammrunde wieder zusammen ist! 🍀</div>';
    html+='</div>';
  }

  html+='<button class="btn btn-secondary" style="margin-top:16px;position:sticky;bottom:0" onclick="closeInfoModal()">Schließen</button>';
  document.getElementById('infoModalContent').innerHTML=html;
  document.getElementById('infoModal').classList.add('show');
}

// Feedback als eigener Menüpunkt.
export async function openFeedbackModal(){
  const devInfo=await getDeviceInfo();
  const deviceShort=(devInfo.model?devInfo.model+' · ':'')+devInfo.os+' · '+devInfo.browser;
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)"><h3 style="margin:0">Feedback &amp; Bugs</h3><button onclick="closeInfoModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  html+='<div style="margin-bottom:4px;font-size:11px;color:var(--tx3)">Dein Gerät (optional anpassen)</div>';
  html+='<input type="text" id="feedbackDevice" value="'+deviceShort.replace(/"/g,'&quot;')+'" style="width:100%;box-sizing:border-box;font-size:13px;padding:8px 10px;margin-bottom:10px;border-radius:var(--r-sm);border:1px solid var(--bdr);background:var(--bg);color:var(--tx)">';
  html+='<a id="feedbackMailBtn" href="#" class="btn btn-secondary" style="text-decoration:none;margin-bottom:4px" onclick="sendFeedbackMail(event)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg> Feedback senden</a>';
  html+='<div style="font-size:10px;color:var(--tx3);text-align:center;margin-top:2px">Geräteinfos und App-Version werden automatisch angehängt</div>';
  html+='<button class="btn btn-secondary" style="margin-top:16px;position:sticky;bottom:0" onclick="closeInfoModal()">Schließen</button>';
  document.getElementById('infoModalContent').innerHTML=html;
  document.getElementById('infoModal').classList.add('show');
}

// Changelog als eigener Menüpunkt (neueste oben).
export function openChangelogModal(){
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)"><h3 style="margin:0">Changelog</h3><button onclick="closeInfoModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  html+='<div class="card">';
  const log=[
    {v:'6.41',d:'12.06.2026 18:30',t:'Liga überarbeitet: Beim Aufnehmen eines Spiels werden Spielernamen jetzt vorhandenen Liga-Spielern zugeordnet (Abfrage nur, wenn unklar – eindeutige Namen werden automatisch übernommen). So zählt dieselbe Person nur einmal, auch wenn sie unterschiedlich geschrieben wurde. Die Gesamttabelle fasst alle Spiele und Termine zu EINER Summe je Spieler zusammen (keine Trennung „Manuell/App" mehr). Zwei Spieler lassen sich nachträglich zusammenführen, und die Zuordnung eines Spiels ist im Detail editierbar. Neue Liga-Einstellung „Zahlbetrag anzeigen": summiert je Spieler nur die negativen Abende = was jeder zahlen muss.'},
    {v:'6.40',d:'12.06.2026 18:15',t:'Admin „Online": zeigt zu jedem Spieler jetzt auch die App-Version an, mit der er online ist bzw. zuletzt war.'},
    {v:'6.39',d:'12.06.2026 18:05',t:'Admin „Online": zeigt jetzt ALLE Profile, sortiert nach „zuletzt online" (grün = gerade aktiv, sonst „zuletzt online vor …/am …"). So sieht man auch Leute, die kurz vorher die App genutzt haben, aber gerade nicht online sind.'},
    {v:'6.38',d:'12.06.2026 17:55',t:'Online-Anzeige genauer: Ein nur im Hintergrund geöffneter Tab (oder ein schlafendes Gerät) zählt nicht mehr als „aktiv" – er meldet sich beim Wechsel in den Hintergrund ab und beim Zurückkommen wieder an.'},
    {v:'6.37',d:'12.06.2026 17:45',t:'Liga-Historie zeigt jetzt Details – z. B. bei „App-Spiel aufgenommen" das Datum, die Spieler und den Sieger, bei Terminen die Punkte je Spieler.'},
    {v:'6.36',d:'12.06.2026 17:15',t:'Liga: „Zurück" führt jetzt zuverlässig eine Ebene zurück (auch mit der Handy-Zurück-Geste) – dorthin, wo man herkam, statt das ganze Fenster zu schließen. Außerdem Info-Seite aktualisiert: Tabs heißen Spieler/Eingabe/Tabelle/Statistik/Mehr, und Turnier, Liga sowie „gegen Computer spielen" sind erklärt.'},
    {v:'6.35',d:'12.06.2026 17:05',t:'Liga: In den Einstellungen lässt sich nun festlegen, ob beim Spielende gefragt wird, ob das Spiel in eine Liga soll – und welche Liga vorgeschlagen wird. Ist die Frage aus, kannst du Spiele später über die Liga oder direkt im Spiele-Archiv („In Liga") aufnehmen. Außerdem behoben: „Alle Ligen verwalten" zeigte keine Ligen – die Liste wird jetzt zuverlässig aus mehreren Quellen zusammengeführt.'},
    {v:'6.34',d:'12.06.2026 16:53',t:'Liga: „Alle Ligen verwalten" funktioniert wieder. „Spiel aus Archiv aufnehmen" zeigt jetzt eine Auswahlliste mit Datum, Spielern, Rundenzahl und Sieger (neuestes oben). Außerdem kurze Erklärzeilen: Turnier = ein Live-Spielabend (mehrere Tische/Rotation), Liga = dauerhafte Gesamttabelle über viele Abende.'},
    {v:'6.33',d:'12.06.2026 14:44',t:'Liga & Turniere: Neue Änderungs-Historie („wer hat wann was geändert") mit Rückgängig-Funktion für Liga-Admins bzw. Turnier-Ersteller/Admins. In der Liga und beim Turnier gibt es dafür den Knopf „🕓 Historie". Außerdem konsistente Verwaltung: Als globaler Admin verwaltest du ALLE Turniere und ALLE Ligen, als normaler Nutzer nur deine eigenen (wo du Ersteller/Admin bist).'},
    {v:'6.32',d:'12.06.2026 15:30',t:'Liga: Beitreten jetzt auch per QR-Code (wie beim Turnier). Manuelle Termine lassen sich antippen, im Detail ansehen und (als Liga-Admin) bearbeiten. App-Spiele kann man antippen und Runde für Runde ansehen. Neu: ein Spiel lässt sich auch nachträglich aus dem Geräte-Archiv in die Liga aufnehmen. Behoben: Aufnehmen schlug bei Spielernamen mit Sonderzeichen (z. B. Punkt) fehl.'},
    {v:'6.31',d:'12.06.2026 14:12',t:'Doppelkopf-Spiel: Die Computer-Gegner überstechen den eigenen Partner nicht mehr unnötig. Führt der Partner den Stich bereits, wirft die KI jetzt eine Fehlkarte ab (bzw. schmiert hohe Augen auf den sicheren Stich) und schont ihre Trümpfe, statt sie zu verschwenden.'},
    {v:'6.30',d:'11.06.2026 20:10',t:'Liga überarbeitet: Der Ligabereich liegt jetzt – wie „Turnier" – als eigene Karte unter „Mehr" und ist für alle sichtbar. Jede:r kann eine Liga anlegen oder per Code beitreten. Liga-Ersteller (und globale Admins) verwalten ihre Liga: Spieler anlegen, Punkte je Termin eintragen (Gesamttabelle = manuelle Punkte + aufgenommene App-Spiele), Mitglieder zu Liga-Admins machen. Beim Beitritt schlägt die App passende, noch freie Spielernamen zum Verknüpfen vor; Liga-Admins können Verknüpfungen bearbeiten. Admins sehen/verwalten alle Ligen. Kleinigkeit: die Karte „Besucher-Statistik" ist jetzt rot umrandet.'},
    {v:'6.29',d:'11.06.2026 19:33',t:'Neuer Ligabereich (vom Admin pro Spieler freischaltbar, versteckt unter „Mehr"): Ligen mit Code anlegen oder beitreten, gemeinsame Gesamttabelle über alle eingetragenen Spiele (Punkte, Spiele, Siege, Soli, Ø). Beim Beenden eines Spiels kann man es in eine Liga aufnehmen; Admins/Ersteller können Einträge wieder löschen.'},
    {v:'6.28',d:'11.06.2026 15:58',t:'Doppelkopf-Spiel: Werden in einem Stich beide Herz-Zehnen (Dullen) gespielt, gewinnt jetzt die zuletzt gelegte (zweite) – wie in den meisten Runden üblich. Außerdem spielen die Computer-Gegner im Endspiel klüger: Sie kassieren sichere Trumpf-Stiche, statt einen schwachen Trumpf abzuwerfen, und verschwenden ihre höchsten Trümpfe nicht mehr.'},
    {v:'6.27',d:'11.06.2026 10:30',t:'Doppelkopf-Spiel: Solo-Regeln überarbeitet. Es gibt jetzt nur noch Trumpf-, Damen-, Buben- und Fleischlos-Solo (die Farb-Solos Karo/Herz/Pik/Kreuz gibt es nicht mehr, Fleischlos – ein Solo ganz ohne Trumpf – ist neu). Die Computer-Gegner wagen ein Solo etwas eher (z. B. mit den höchsten Trümpfen plus ein paar Assen). Neu: Wer „nicht über den Fuchs kommt" (keine Dulle, Dame oder Bube), kann das Blatt schmeißen – dann wird neu gegeben; ein angesagtes Solo hat Vorrang.'},
    {v:'6.26',d:'11.06.2026 10:04',t:'Doppelkopf-Spiel: Wertung beim Solo korrigiert – es gibt kein „Gegen die Alten" mehr, stattdessen den Solopunkt (+1, wird nicht verdoppelt). Auch Fuchs, Doppelkopf und Karlchen zählen beim Solo nicht. Damit entspricht die Spiel-Wertung dem manuellen Punkterechner.'},
    {v:'6.25',d:'11.06.2026 09:55',t:'Doppelkopf-Spiel: Die Computer-Gegner sagen nicht mehr ständig unsinnige Damen-Solos an. Die Solo-Entscheidung ist jetzt deutlich konservativer – ein Damen- oder Buben-Solo nur noch bei klarer Übermacht dieser Karten, sonst bevorzugt ein starkes Farb-/Trumpf-Solo oder „gesund".'},
    {v:'6.24',d:'10.06.2026 23:28',t:'Doppelkopf-Spiel: Karten im schöneren Spielkarten-Look (Eck-Symbol + großes Farbzeichen, im Dark-Mode besser lesbar). Mitspieler-Karten als kompakter Stapel statt langer Rückseiten-Reihe. Tippfehler behoben („Du gewinnst" / „Du machst den Stich"). „Auto-Weiter" ist jetzt standardmäßig aus.'},
    {v:'6.23',d:'10.06.2026 16:30',t:'Der 🐞-Debug-/Feedback-Button im Doppelkopf-Spiel ist wieder für alle Spielenden sichtbar (Admins und Beta-Tester) – damit auch Beta-Tester konkrete Bot-Züge melden können.'},
    {v:'6.22',d:'10.06.2026 16:25',t:'Der 🐞-Debug-Button im Doppelkopf-Spiel ist jetzt nur noch für Admins sichtbar (Beta-Tester spielen normal weiter, ohne Debug-Export).'},
    {v:'6.21',d:'10.06.2026 16:25',t:'Doppelkopf-Spiel (Beta): Neuer 🐞-Button (in der Steuerleiste und im Ergebnis-Screen) zum Kopieren des Spielstands inkl. Notizfeld. So kannst du zu einem konkreten Bot-Zug etwas notieren und den kompletten, exakt nachstellbaren Spielstand kopieren – zum Verbessern der Computer-Spielweise.'},
    {v:'6.20',d:'10.06.2026 14:10',t:'Doppelkopf-Spiel (Beta): Anzahl gewonnener Stiche pro Spieler wird angezeigt. Ansagen zeigen jetzt den Urheber – inkl. wer das Solo/die Hochzeit angesagt hat (z. B. „Buben-Solo · Max") und wer Re/Kontra/Keine 90/60/30/Schwarz gesagt hat. Hochzeit zeigt, wie geklärt wurde (Partner + welcher Stich, Fehl- oder Trumpf-Stich) bzw. „hängen gelassen → Stilles Solo" nach dem 3. Stich. Außerdem können Admins einzelne Spieler gezielt für „Doppelkopf spielen" freischalten (Doko-Beta).'},
    {v:'6.19',d:'10.06.2026 13:55',t:'„Mehr" aufgeräumt: Info ist jetzt das (i)-Symbol oben rechts neben den Einstellungen (auf allen Seiten); „Punkte zählen" entfällt hier (gibt es bei der Eingabe). Neue Reihenfolge: Vergangene Spiele, Turnier, Feedback, Changelog, Nach Updates suchen. Admin-Funktionen (Datenbank, Doppelkopf spielen) stehen getrennt darunter und nur für Admins.'},
    {v:'6.18',d:'10.06.2026 13:50',t:'„Vergangene Spiele" (Mehr) sind jetzt eine ein-/ausklappbare Kategorie und standardmäßig eingeklappt – wie Turnier, Einstellungen & Co.'},
    {v:'6.17',d:'10.06.2026 13:40',t:'Neu: „Spiel teilen" (Spieler-Tab → Aktuelles Spiel). Das laufende Spiel lässt sich per kurzem Code/QR/Link an ein anderes Gerät übergeben, das dann weiterschreibt – praktisch beim Tischwechsel. Standard ist die einmalige Übergabe (das andere Gerät übernimmt den Stand); optional „Live mitschreiben", wobei beide Geräte verbunden bleiben (es zählt der zuletzt gespeicherte Stand). Funktioniert ohne Turnier und ohne Profil; Internet wird benötigt.'},
    {v:'6.16',d:'10.06.2026 13:00',t:'„Mehr" aufgeräumt: Info, Punkte zählen, Feedback und Changelog sind jetzt eigene Menüpunkte (vorher in einem gemeinsamen Modal zusammengefasst). Changelog-Datumsangaben korrigiert.'},
    {v:'6.15',d:'10.06.2026 12:20',t:'Abend-Achievements (Hot Streak, Comeback Kid, Solist, Unbesiegbar, Pechvogel) beziehen sich jetzt korrekt nur auf den aktuellen Spielabend. Bisher blieben einmal verdiente Abend-Badges dauerhaft hängen (auch nach „Neues Spiel"), wodurch z. B. „Solist" angezeigt wurde, obwohl im laufenden Abend gar keine 3 Soli gespielt wurden. Die Badges werden nun bei jeder Runde frisch aus den aktuellen Runden berechnet und beim Start eines neuen Abends zurückgesetzt; falsch hängengebliebene Badges verschwinden automatisch.'},
    {v:'6.14',d:'10.06.2026 11:45',t:'Turnier-Archiv aufräumbar: Jeder Eintrag hat jetzt einen „Entfernen"-Button, und ganz unten gibt es „Gesamtes Archiv leeren". So lassen sich alte/nur-lokale Einträge jederzeit aufräumen – unabhängig davon, ob ein Server-Abgleich möglich ist. (Die Turnierdaten auf dem Server bleiben unberührt.)'},
    {v:'6.13',d:'10.06.2026 11:15',t:'Turniere ohne Cloud-Profil verwaltbar: Beim Erstellen wird das Turnier jetzt dem Gerät zugeordnet (zusätzlich zum Ersteller-Profil, falls vorhanden). Dadurch erscheint ein selbst erstelltes Turnier unter „Meine Turniere" auch dann, wenn (noch) kein eigenes Profil angelegt wurde. Hinweis beim Erstellen ohne Profil, dass das Turnier dann nur auf diesem Gerät verwaltbar ist.'},
    {v:'6.12',d:'10.06.2026 10:45',t:'Turnier-Verwaltung verständlicher: „Meine Turniere" und die Admin-Liste zeigen jetzt bei leerer Ansicht einen erklärenden Hinweis (z. B. „nur eigene/co-geleitete Turniere" bzw. „kein Cloud-Profil auf diesem Gerät") statt nur „Keine Turniere". Das „Turnier-Archiv" gleicht außerdem mit der Datenbank ab und markiert Einträge, die nur noch lokal vorhanden (auf dem Server gelöscht) sind – diese lassen sich einzeln oder gesammelt aus dem Archiv entfernen.'},
    {v:'6.11',d:'10.06.2026 10:20',t:'Doppelkopf-Spiel (Admins): Letzten Stich auf Abruf einsehen. Während des Spiels gibt es jetzt einen „🔍 Letzter Stich"-Button, der den zuletzt abgeschlossenen Stich noch einmal zeigt (welche Karte von wem, Gewinner und Augenzahl). Schließt sich automatisch, sobald die nächste Karte gespielt wird.'},
    {v:'6.10',d:'10.06.2026 09:55',t:'Doppelkopf-Spiel (Admins): Bedienung übersichtlicher. Beim Vorbehalt/Solo bleiben deine Karten jetzt sichtbar (Popup verdeckt die Hand nicht mehr). Ein deutlicher Banner zeigt, wer dran ist bzw. wann du dran bist, samt Hervorhebung des aktiven Spielers und deiner Hand. Ansagen (Re/Kontra/Keine 90 …) laufen jetzt über einen „Ansage"-Button, der ein Popup mit den gerade erlaubten Ansagen öffnet.'},
    {v:'6.9',d:'10.06.2026 09:30',t:'NEU (nur für Admins): Doppelkopf gegen den Computer! Über „Mehr → Doppelkopf spielen" startet ein echtes Kartenspiel gegen drei KI-Gegner – mit voller Trumpf-Ordnung, Bedienpflicht, Stichen, Vorbehalt/Solo/Hochzeit, Re/Kontra & Absagen sowie automatischer Wertung (Doppelkopf/Fuchs/Karlchen). Spielstand wird gespeichert und kann fortgesetzt werden. Erste Version – Feedback willkommen.'},
    {v:'6.8',d:'04.06.2026 20:11',t:'Turnier-Verwaltung verfeinert: „Ausblenden" heißt jetzt „Archivieren" und ist reversibel – Ersteller (und Admins) können ihre archivierten Turniere selbst wieder herstellen. „Meine Turniere" und die Admin-Ansicht zeigen Turniere gruppiert nach Aktiv/Beendet/Archiviert; „Öffnen / Bearbeiten" gibt vollen Spielleiter-Zugriff. Admins können weiterhin alle Turniere bearbeiten und endgültig löschen.'},
    {v:'6.7',d:'01.06.2026 13:00',t:'Eingabe: Mehrere Spieler lassen sich jetzt gleichzeitig mit mehreren Fingern markieren (Multi-Touch). Vorher reagierte beim gleichzeitigen Drücken zweier Spieler nur einer.'},
    {v:'6.6',d:'01.06.2026 12:00',t:'Neue Hintergrundfarbe frei wählbar (Mehr → Darstellung): Wähle aus dezenten Vorlagen oder per Farbwähler eine eigene Hintergrundfarbe – die Flächen (Seite, Karten, Felder) werden stimmig abgestuft und die Textfarbe passt sich automatisch an, damit alles lesbar bleibt. Die Akzentfarbe lässt sich weiterhin unabhängig einstellen; „Standard" setzt auf das Theme zurück.'},
    {v:'6.5',d:'31.05.2026 23:55',t:'Fix Online-Anzeige: Die Admin-Ansicht „🟢 Online" blieb auf „Lädt…" hängen (der Online-Status wurde an einem nicht freigegebenen Datenbank-Pfad gespeichert). Der Online-Status liegt jetzt direkt am Spieler und wird zuverlässig angezeigt; bei Verbindungsproblemen erscheint eine Meldung statt Dauerladen.'},
    {v:'6.4',d:'31.05.2026 23:15',t:'Turnier-Verwaltung & Online-Anzeige: Über „Mehr → Turnier → Meine Turniere" lassen sich eigene Turniere als aktuell setzen oder ausblenden – mit Anzeige, wer sie erstellt hat. Admins sehen unter „Mehr → Admin" alle Turniere (aktiv/beendet/ausgeblendet), können sie wiederherstellen oder endgültig löschen, und sehen über „🟢 Online", wer die App gerade nutzt. Außerdem sind die Kategorien in „Mehr" und „Einstellungen" jetzt einklappbar (Zustand wird gemerkt).'},
    {v:'6.3',d:'31.05.2026 22:30',t:'Update-Mechanismus repariert: Neue Versionen werden jetzt zuverlässig automatisch aktiviert und geladen (vorher konnte die App auf einer alten, zwischengespeicherten Version hängenbleiben). Der Button „Nach Updates suchen" unter „Mehr" prüft weiterhin jederzeit manuell.'},
    {v:'6.2',d:'31.05.2026 22:22',t:'Neuer Button „Nach Updates suchen" unter „Mehr" (über der Versionsnummer): prüft sofort auf eine neue Version und lädt direkt neu, wenn eine bereitsteht – sonst Rückmeldung, dass bereits die neueste Version läuft.'},
    {v:'6.1',d:'31.05.2026 22:06',t:'Zuverlaessigere Updates: Die App prueft jetzt regelmaessig (und beim Zurueckkehren) auf neue Versionen und laedt erst dann neu, wenn der neue Stand wirklich bereit ist. Kein Neuladen mitten in der Punkteingabe – dann erscheint ein Hinweis mit Button „Jetzt aktualisieren", sonst wird nach dem Speichern automatisch aktualisiert.'},
    {v:'6.0',d:'31.05.2026 21:31',t:'Cloud-Backup (Einstellungen): jeder mit Profil kann seine Spiele und sein Archiv automatisch in der Cloud sichern. Wiederherstellung per Knopfdruck – beim Gerätewechsel wird das Backup direkt zum Laden angeboten. Reines Backup, kein Zusammenführen mehrerer Geräte.'},
    {v:'5.9',d:'30.05.2026 14:05',t:'Profil: Benutzer-ID kopierbar, aufgeraeumtes Layout, Loeschen-Button. Admin: faengt gesperrten Datenbank-Root ab und zeigt die bekannten Bereiche, neue Admin-Verwaltung (Rechte vergeben/entziehen). Admin-Erkennung jetzt per Benutzer-ID bzw. isAdmin-Flag.'},
    {v:'5.8',d:'30.05.2026 12:30',t:'Profil in den Einstellungen: jeder kann seinen Namen und sein Kuerzel selbst anpassen (Benutzer-ID bleibt schreibgeschuetzt). Neuer Admin-Bereich unter „Mehr" – nur fuer den Admin sichtbar – mit vollem Zugriff auf die Datenbank: navigieren, als JSON bearbeiten, Schluessel anlegen und Knoten loeschen.'},
    {v:'5.7',d:'30.05.2026 07:42',t:'Turniere ohne Code finden: In-App-QR-Scanner und – optional beim Erstellen aktivierbar – Anzeige von Turnieren in der Naehe per Standort. Beitritt weiterhin auch per Code/Link moeglich.'},
    {v:'5.6',d:'30.05.2026 00:05',t:'Turnier nutzt jetzt ein laufendes Spiel: beim Erstellen (Freie Eingabe) kann das aktuelle Spiel direkt als eigener Tisch uebernommen werden; beim Beitritt zu einem bestehenden Tisch wird dessen Spiel geladen bzw. ein leerer Tisch kann das laufende Spiel uebernehmen.'},
    {v:'5.5',d:'29.05.2026 23:37',t:'Modals (Einstellungen, Info, Bearbeiten u. a.) lassen sich jetzt per Zurück-Geste schließen: Hardware-/Browser-Zurück sowie Wischen nach rechts auf dem Modal.'},
    {v:'5.4',d:'29.05.2026 23:14',t:'Eigener "Spieler"-Reiter unten: Spieler eintragen/umbenennen/sortieren, Quickstart und Spielsteuerung an einem Ort. Dafür die Spielernamen-Leiste oben im Eingabe-Screen entfernt (mehr Platz fürs Numpad).'},
    {v:'5.3',d:'29.05.2026 22:31',t:'Akzentfarbe frei wählbar (Einstellungen → Darstellung). Emojis erscheinen jetzt auch in der Statistik hinter den Spielern. Bugfix: Im Turnier-Wizard lassen sich die Modi wieder anklicken (auch Dashboard-Tabs und Tisch-Zuweisung).'},
    {v:'5.2',d:'29.05.2026 21:04',t:'Kopfzeile zusammengeführt: nur noch eine Titelzeile oben, die den aktuellen Screen-Namen zeigt (Teilen-Aktion rechts im Header). Die separate Überschriftenzeile entfällt – mehr Platz.'},
    {v:'5.1',d:'29.05.2026 16:26',t:'Navigation umgebaut: Bottom-Nav statt Pill-Bar oben. Setup-Screen aufgelöst in Eingabe-Leerzustand, Mehr-Screen und Einstellungen-Modal. Spieler-Leiste mit Kebab-Menü im Eingabe-Screen.'},
    {v:'5.0',d:'29.05.2026 15:14',t:'Großer technischer Umbau: Code in 8 ES-Module aufgeteilt, Vite als Bundler, Service Worker via vite-plugin-pwa (kein manuelles Cache-Busting mehr). Keine Funktions- oder UI-Änderung.'},
    {v:'4.49',d:'29.05.2026 13:20',t:'Solokönig zeigt jetzt "–" bei Gleichstand (nur eindeutiger Gewinner wird gekürt).'},
    {v:'4.48',d:'29.05.2026 13:10',t:'Teilen-Bilder werden jetzt im Hintergrund vorgerendert \u2013 sofortiges Teilen ohne Wartezeit, höhere Bildqualität (scale 2).'},
    {v:'4.47',d:'28.05.2026 17:47',t:'Turnier: Spielleiter kann jetzt Tische erstellen und beitreten \u2013 Co-Host-Erkennung blockiert nicht mehr den eigenen Host.'},
    {v:'4.46',d:'28.05.2026 17:36',t:'Turnier: 8 Bugfixes \u2013 Spieler ohne Tisch bekommt Beitreten-Button, Tischwechsel entfernt vom alten Tisch, Host-Tisch-Verlassen bereinigt Firebase, Self-Rotation auch f\u00fcr mitspielenden Host, Tisch-Auswahl visuelles Feedback gefixt, QR-Codes basieren auf Tischanzahl, Spieler-App Registrierung direkt im Beitreten-Dialog, var(--primary) komplett durch var(--acc) ersetzt.'},
    {v:'4.45',d:'28.05.2026 17:02',t:'Turnier: Textkorrekturen (Firebase-Referenzen entfernt, Wizard-Beschreibungen), Konfigurationsübersicht im Setup für Spielleiter mit Änderungsmöglichkeit (Sichtbarkeit, Gesamtwertung), Spieler-App Beitritt für bereits registrierte Spieler verbessert.'},
    {v:'4.44',d:'28.05.2026 16:36',t:'Turnier Phase 3: Rotation \u2013 Spielleiter startet Tischwechsel (manuell oder nach X Runden). Host-Zuweisung per Tisch-UI oder Selbstwahl durch Spieler. Gesamtwertung mit Podium \u00fcber alle Rotationen. Rotations-Historie im Dashboard.'},
    {v:'4.43',d:'28.05.2026 16:21',t:'Turnier: 4-Spieler-Pflicht beim Beitreten entfernt – Spieler können auch nachträglich ergänzt werden. „+ Spieler"-Button mit Checkbox „Spieler hat kein eigenes Handy" statt zwei separate Buttons.'},
    {v:'4.42',d:'28.05.2026 16:10',t:'Turnier Phase 2: Spieler-App (Modus 4) – Einzelspieler treten bei und wählen ihren Tisch. „Meine Spiele"-Ansicht zeigt eigene Punkte und Runden über alle Tische. Schreiber-Rolle pro Tisch mit Abgabe-Funktion und Zuschauer-Modus. Sichtbarkeits-Steuerung: Spielleiter bestimmt ob Spieler andere Tische sehen. Spieler ohne Gerät können manuell hinzugefügt werden.'},
    {v:'4.41',d:'28.05.2026 15:56',t:'Turnier: Turnier-Indikator auf allen Screens sichtbar (klickbar zum Dashboard). Turniername vergeben (optional beim Erstellen). Name wird in Dashboard, Archiv und Indikator angezeigt.'},
    {v:'4.40',d:'28.05.2026 15:39',t:'Turnier: Admins verwalten per Checkbox-Liste statt Nummereingabe (Schild-Icon). Spielleiter kann jetzt selbst Tische beitreten und mitspielen. Spieler-Sync vom Tisch ins Setup beim App-Start. Korrekte Grammatik bei Turnier-Archiv (vergangenes/vergangene).'},
    {v:'4.39',d:'28.05.2026 15:19',t:'Turnier: Turnier-Archiv – beendete Turniere können von allen Teilnehmern eingesehen werden. Co-Spielleiter – Spielleiter kann weitere Admins ernennen. Eindeutige Kurznamen (keine Duplikate mehr). Schöner Dialog statt Browser-Prompt beim Spieler hinzufügen. Tisch-Spieler werden automatisch ins lokale Setup übernommen.'},
    {v:'4.38',d:'28.05.2026 13:58',t:'Turnier: Verbesserter Beitritts-Flow – vorhandene Tische werden mit Spielern angezeigt und sind direkt auswählbar. Eindeutige Tischnummern mit automatischem Vorschlag der nächsten freien Nummer. Eigener Name wird automatisch als Spieler eingetragen (auch im normalen Spiel). Abfrage ob bestehende lokale Runden übernommen werden sollen. Spieler an jedem Tisch im Dashboard sichtbar.'},
    {v:'4.37',d:'28.05.2026 12:54',t:'Turnier-Modus Phase 1: Turnier erstellen mit 6-stelligem Code (DK-XXXX) und Konfiguration (4 Spieler-Modi, Tisch-Modus, Rotation). Globale Spieler-Datenbank in Firebase mit Geräte-Verknüpfung. Tische treten per Code, QR-Code oder Link bei. Spielstände werden nach jeder Runde automatisch gesynct. Spielleiter sieht Live-Dashboard mit allen Tischen und Detail-Ansicht. Tisch-QR-Codes zum Ausdrucken.'},
    {v:'4.36',d:'27.05.2026 23:12',t:'Schnellstart: Karte im Setup zeigt die letzte Spielrunde – ein Tap lädt die Spieler und wechselt direkt zur Eingabe.'},
    {v:'4.35',d:'27.05.2026 22:36',t:'Achievements: Pro-Abend-Badges (Hot Streak, Comeback Kid, Solist, Unbesiegbar, Pechvogel) und Saison-Badges (Stammgast, Veteran, Solokönig, Dominator, Dauersieger, Marathon) – werden live per Toast + Mini-Konfetti freigeschaltet und in der Statistik angezeigt. Uhrzeitanzeige im Archiv und Ewiger Tabelle.'},
    {v:'4.34',d:'27.05.2026 22:00',t:'Ewige Tabelle: Saisonübergreifende Statistik über alle archivierten Spielabende – Rangliste mit Gesamt-Punkten, Siegen, Soli und Platz-1-Zähler, Punkteverlauf-Chart über Spielabende und Platzierungstabelle. Erreichbar über Button im Archiv-Bereich (ab 2 archivierten Spielen).'},
    {v:'4.33',d:'27.05.2026 21:33',t:'Statistik: Neue Sektion "Highlights des Abends" – größter Gewinn/Verlust, längste Sieges- und Pechserie, Comeback des Abends, Spieldauer mit Durchschnitt pro Runde und Wendepunkt der Partie.'},
    {v:'4.32',d:'27.05.2026 15:52',t:'Debug-Modus: 5x auf die Versionsnummer tippen öffnet den Debug-Bereich mit Geräteinfos, App-State, localStorage, Konsolen-Logs und State-Export/Import. Feedback-Mail enthält jetzt automatisch Geräte- und App-Informationen.'},
    {v:'4.31',d:'27.05.2026 14:32',t:'Tabelle: Solo-Badge (Bu, Da, S) von der #-Spalte in die Punkte-Spalte verschoben. Solo-Punkte zeigen jetzt beide Werte (z.B. 4/12). Teilen: Volle Spielernamen statt Kürzel im Header.'},
    {v:'4.30',d:'27.05.2026 14:27',t:'Tabelle teilen: Zeigt jetzt Spaltenköpfe + letzte 8 Spiele (statt schwarzem Bild). Menü-Spalte wird beim Teilen ausgeblendet.'},
    {v:'4.29',d:'27.05.2026 14:13',t:'Teilen-Button auch bei archivierten Spielen sichtbar – Tabelle und Statistik aus dem Archiv können jetzt geteilt werden.'},
    {v:'4.28',d:'27.05.2026 13:47',t:'Statistik: Spieler nach Punkten sortiert mit Rang-Anzeige. Tabelle: Ranking-Header entfernt (Stände sieht man in der letzten Zeile), Streak-Icons (🔥💀) in Spaltenköpfe verschoben. Easter-Egg-Banner von Eingabe in Tabelle verschoben. Teilen beschleunigt (geringere Bildauflösung). Eingabe: Responsive Größen – Buttons und Numpad passen sich an die Bildschirmhöhe an (besser auf iPhone/iOS).'},
    {v:'4.27',d:'26.05.2026 16:27',t:'Einheitliche App-Dialoge: Alle Browser-Popups (alert/confirm) durch eigene Toast-Benachrichtigungen und Bestätigungs-Modals im App-Design ersetzt.'},
    {v:'4.26',d:'26.05.2026 12:48',t:'Eingabe noch kompakter: Punkte-\u00dcberschrift entfernt (Placeholder im Feld), Spieler antippen + Legende in einer Zeile, Buttons nochmals verkleinert, weniger Abstand zwischen Titel und Punktefeld. Edit-Modal identisch.'},
    {v:'4.25',d:'26.05.2026 12:36',t:'Eingabe kompakter: Punktefeld kleiner, Vorzeichen-Button in Hilfe-Zeile verschoben, R\u00fcckg\u00e4ngig-Button immer sichtbar (deaktiviert wenn nicht nutzbar), Speichern/R\u00fcckg\u00e4ngig-Buttons kleiner mit fester Position. Edit-Modal identisch angepasst.'},
    {v:'4.24',d:'26.05.2026 12:08',t:'Spielarchiv: Vergangene Spiele werden beim Start eines neuen Spiels automatisch archiviert. Archivierte Spiele im Setup einsehbar mit kompletter Tabelle und Statistiken (read-only). Max. archivierte Spiele einstellbar (1\u201350, Standard: 10). Einzelne Archiv-Eintr\u00e4ge l\u00f6schbar.'},
    {v:'4.23',d:'25.05.2026 21:53',t:'Bugfix: Spieleingabe war auf allen Screens sichtbar – CSS-Spezifitätsfehler behoben.'},
    {v:'4.22',d:'25.05.2026 21:32',t:'Eingabe-Screen: Numpad füllt jetzt den ganzen Bildschirm – kein Scrollen mehr nötig. Auf kleinen Handys kompakter Modus. Speichern und Rückgängig nebeneinander.'},
    {v:'4.21',d:'25.05.2026 20:41',t:'Bugfix Tabelle: Spielernamen bleiben beim Runterscrollen sichtbar – Tabellenkopf ist jetzt korrekt fixiert (sticky Header).'},
    {v:'4.20',d:'20.05.2026 11:19',t:'Design-Fix: Statistik-Leerseite ("Spiele ein paar Spiele für Statistiken") hat jetzt denselben weißen Kartenhintergrund wie die Tabelle ("Noch keine Daten").'},
    {v:'4.19',d:'20.05.2026 11:02',t:'Statistik-Bugfix: Solokönig zeigt jetzt "–" wenn kein einziges Solo gespielt wurde (statt fälschlich dem ersten Spieler). Bester Spieler zeigt "–" bei Gleichstand (z.B. wenn alle Spieler gleich viele Punkte haben).'},
    {v:'4.18',d:'13.05.2026 15:10',t:'Spalten-Kürzel überarbeitet: Mindestlänge ist jetzt 4 Buchstaben (vorher 3), kein Punkt mehr am Ende. Wichtiger Bugfix: bei zwei langen Namen die nur einen Buchstaben Unterschied haben (z. B. Christoph & Christopher) wurde vorher auf 8 Zeichen begrenzt und es kollidierte – jetzt wächst das Kürzel beliebig lang bis eindeutig.'},
    {v:'4.17',d:'13.05.2026 14:55',t:'Easter Eggs verfeinert: Mini-Kursleiter-Modus zeigt nur noch ein kleines Achievement-Badge "X Kursleiter dabei" (egal wer sonst dabei ist). Doko-Stammrunde aktiviert sich wenn mindestens 4 Spieler aus der Stammrunde aktiv sind und keine Fremden – Konfetti beim ersten Mal und ein Spezial-Hinweis im Banner.'},
    {v:'4.16',d:'13.05.2026 14:45',t:'Zwei neue Easter Eggs: 1) Mini-Kursleiter-Modus – wenn nur 1-3 Kursleiter dabei sind, gibts dezenten Banner und persönliche Emojis. 2) Doko-Stammrunde mit eigenen Emojis und Theme (Alisa, Arne, Christoph, Eva, Lena, Lisa, Sarah, Annabelle, Moritz). Vollmodus mit Konfetti wenn alle 4 aktiven Spieler aus der Stammrunde sind. Mini-Modus bei mind. einem dabei.'},
    {v:'4.15',d:'13.05.2026 14:30',t:'Zwei Verbesserungen: 1) Spalten-Kürzel sind jetzt eindeutig – aus "Christoph" und "Christopher" werden "Christop." und "Christophe." statt zweimal "Chris". Algorithmus kürzt so weit wie möglich, aber nur so weit dass die Namen unterscheidbar bleiben. 2) Geheimer Kursleiter-Cup-Modus (Easter Egg) wenn vier bestimmte Namen aktiv sind: eigenes Banner, persönliche Emojis und Lehrer-Vokabular ("Frontalunterricht" statt "Solo", "Doppelstunde" statt "Bockrunde", "Lektion" statt "Spiel").'},
    {v:'4.14',d:'13.05.2026 14:10',t:'Spiel-bearbeiten-Dialog auch auf Vollbild umgestellt – mit X-Button oben rechts und sticky Speichern/Abbrechen unten. Konsistent mit Punkterechner, Info und Punktezähl-Hilfe.'},
    {v:'4.13',d:'13.05.2026 13:55',t:'Tabellenzellen: nur noch Hintergrund-Farbe für Sieg/Niederlage des einzelnen Spiels (grün/rot). Die kumulierten Punkte werden in Standard-Textfarbe angezeigt – nicht mehr in Grün/Rot je nach Gesamtsaldo. Übersichtlicher.'},
    {v:'4.12',d:'13.05.2026 13:40',t:'Mehrere Änderungen: 1) Punkte-Spalte in der Tabelle nach rechts ans Ende verschoben (vor dem Menü). 2) Minuspunkte möglich – mit ±-Button im Numpad kann das Vorzeichen umgekehrt werden, für Fälle wo das Gewinner-Team trotzdem unter null landet. 3) ?-Button neben "Punkte zählen" für die Punktezähl-Anleitung. 4) Info-Modal komplett überarbeitet: kompakte App-Erklärung mit allen Besonderheiten (Streaks, Konfetti, Bockrunden, PWA-Installation, Updates).'},
    {v:'4.11',d:'13.05.2026 13:25',t:'Info-Popup auf Vollbild umgestellt mit X-Button oben rechts (sticky, immer sichtbar) und festem Schließen-Button unten. Komplette Anleitung und Changelog jetzt besser lesbar.'},
    {v:'4.10',d:'13.05.2026 13:15',t:'Auto-Update-Hinweis: Wenn eine neue Version verfügbar ist, erscheint oben ein Toast "Neue Version verfügbar – wird automatisch geladen…" mit Fortschrittsbalken. Nach 3 Sekunden lädt die App selbstständig neu.'},
    {v:'4.9',d:'13.05.2026 13:04',t:'Anonyme Besucherzählung via GoatCounter eingebaut – zählt nur Seitenaufrufe und grobe Geräteinfos. Keine Cookies, keine personenbezogenen Daten, DSGVO-konform.'},
    {v:'4.8',d:'11.05.2026 16:10',t:'Button "Neues Spiel starten" umbenannt zu "Alle Spiele löschen" mit Mülltonnen-Icon. Klare Aussage: löscht nur Spiele und Statistik, Spieler bleiben erhalten.'},
    {v:'4.7',d:'11.05.2026 15:55',t:'Spieler entfernen verhält sich jetzt sinnvoll: Spieler verschwindet nur aus der Eingabe-Auswahl, alle Punkte und Statistiken bleiben in Tabelle und Statistik vollständig erhalten.'},
    {v:'4.6',d:'11.05.2026 15:42',t:'Diverse Logik-Bugfixes für Edge Cases (Crash-Verhinderung bei leerer Spielerliste, Geber-Anzeige, Bockrunden-Konsistenz).'},
    {v:'4.5',d:'30.04.2026 18:05',t:'Bugfix: Eingabe-Cache wird bei jeder Spieleränderung invalidiert. Live-Prüfung der Spielerzahl beim Speichern.'},
    {v:'4.4',d:'30.04.2026 17:50',t:'Bugfix Reset + Pech-Serie 💀 ab 2 Niederlagen.'},
    {v:'4.3',d:'30.04.2026 17:35',t:'"Einstellungen speichern"-Button entfernt – wird automatisch gespeichert.'},
    {v:'4.2',d:'30.04.2026 17:20',t:'CSS in eigene Datei styles.css ausgelagert.'},
    {v:'4.1',d:'30.04.2026 17:08',t:'Bugfix: Eingabe zeigte fälschlich "mind. 4 Spieler".'},
    {v:'4.0',d:'30.04.2026 14:10',t:'Punkterechner: Intelligente Kaskade bei Keine-90/60/30-Optionen.'},
    {v:'3.0',d:'30.04.2026 12:40',t:'Timer: Spielzeit-Erfassung pro Spiel.'},
    {v:'2.6',d:'30.04.2026 12:10',t:'PWA: App installierbar, funktioniert offline.'},
    {v:'1.0',d:'22.04.2026',t:'Erste Version.'}
  ];
  log.forEach(e=>{html+='<div class="changelog-entry"><span class="cl-ver">v'+e.v+'</span><span class="cl-date">'+e.d+'</span><div class="cl-text">'+e.t+'</div></div>'});
  html+='</div><button class="btn btn-secondary" style="margin-top:16px;position:sticky;bottom:0" onclick="closeInfoModal()">Schließen</button>';
  document.getElementById('infoModalContent').innerHTML=html;
  document.getElementById('infoModal').classList.add('show');
}
export async function sendFeedbackMail(e){
  e.preventDefault();
  const devInfo=await getDeviceInfo();
  const customDevice=document.getElementById('feedbackDevice').value;
  const body=encodeURIComponent(
    '[Hier Feedback/Bug-Beschreibung eingeben]\n\n'+
    '---\n'+
    'Gerät: '+customDevice+'\n'+
    'App: '+devInfo.appVersion+'\n'+
    'Screen: '+devInfo.screen+' @'+devInfo.dpr+'\n'+
    'Viewport: '+devInfo.viewport+'\n'+
    'Theme: '+devInfo.theme+'\n'+
    'Online: '+devInfo.online+'\n'+
    'SW: '+devInfo.sw+'\n'+
    'Spieler: '+state.players.length+' | Runden: '+state.rounds.length
  );
  window.location.href='mailto:doppelkopf@arne-chudobba.de?subject=Doppelkopf%20Feedback%20('+encodeURIComponent(devInfo.appVersion)+')&body='+body;
}
let _versionTaps=0,_versionTapTimer=null;
export function handleVersionTap(){
  _versionTaps++;
  clearTimeout(_versionTapTimer);
  _versionTapTimer=setTimeout(()=>{_versionTaps=0},2000);
  if(_versionTaps>=5){_versionTaps=0;openDebugModal()}
}
export async function openDebugModal(){
  const info=await getDeviceInfo();
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)"><h3 style="margin:0">🔧 Debug</h3><button onclick="closeDebugModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen">'+ICO.x+'</button></div>';

  // Geräteinfos
  html+='<div class="section-label">Gerät</div>';
  html+='<div class="card" style="font-size:12px;line-height:2">';
  html+='<div><span style="color:var(--tx3)">App:</span> '+info.appVersion+'</div>';
  html+='<div><span style="color:var(--tx3)">Browser:</span> '+info.browser+'</div>';
  html+='<div><span style="color:var(--tx3)">OS:</span> '+info.os+'</div>';
  if(info.model)html+='<div><span style="color:var(--tx3)">Modell:</span> '+info.model+'</div>';
  html+='<div><span style="color:var(--tx3)">Screen:</span> '+info.screen+' @'+info.dpr+'</div>';
  html+='<div><span style="color:var(--tx3)">Viewport:</span> '+info.viewport+'</div>';
  html+='<div><span style="color:var(--tx3)">Theme:</span> '+info.theme+'</div>';
  html+='<div><span style="color:var(--tx3)">Online:</span> '+info.online+'</div>';
  html+='<div><span style="color:var(--tx3)">SW:</span> '+info.sw+'</div>';
  html+='</div>';

  // State-Übersicht
  html+='<div class="section-label" style="margin-top:12px">State</div>';
  html+='<div class="card" style="font-size:12px;line-height:2">';
  html+='<div><span style="color:var(--tx3)">Spieler:</span> '+state.players.length+(state.players.length?' ('+state.players.join(', ')+')':'')+'</div>';
  html+='<div><span style="color:var(--tx3)">Runden:</span> '+state.rounds.length+'</div>';
  html+='<div><span style="color:var(--tx3)">Bock:</span> '+(state.bockEnabled?'Aktiv (Queue: '+state.bockQueue+', Count: '+state.bockCount+(state.bockSolo?', Solo: ja':'')+')':'Aus')+'</div>';
  html+='<div><span style="color:var(--tx3)">Solo-Typen:</span> '+(state.soloTypesEnabled?'Aktiv ('+state.soloTypes.filter(s=>s.enabled).length+' aktiv)':'Aus')+'</div>';
  const archive=loadArchive();
  html+='<div><span style="color:var(--tx3)">Archiv:</span> '+archive.length+' Spiele (Max: '+state.archiveMax+')</div>';
  if(state.gameStartTime)html+='<div><span style="color:var(--tx3)">Spielstart:</span> '+new Date(state.gameStartTime).toLocaleString('de-DE')+'</div>';
  html+='</div>';

  // localStorage
  html+='<div class="section-label" style="margin-top:12px">localStorage</div>';
  html+='<div class="card" style="font-size:12px;line-height:2">';
  let totalBytes=0;
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(key.startsWith('doko')){
      const size=new Blob([localStorage.getItem(key)]).size;
      totalBytes+=size;
      html+='<div><span style="color:var(--tx3)">'+key+':</span> '+(size/1024).toFixed(2)+' KB</div>';
    }
  }
  html+='<div style="font-weight:700;margin-top:4px"><span style="color:var(--tx3)">Gesamt:</span> '+(totalBytes/1024).toFixed(2)+' KB</div>';
  html+='</div>';

  // Konsolen-Logs
  html+='<div class="section-label" style="margin-top:12px">Konsole (letzte 20)</div>';
  html+='<div class="card" style="font-size:11px;font-family:monospace;line-height:1.6;max-height:160px;overflow-y:auto">';
  const logs=_debugLogs.slice(-20);
  if(logs.length===0)html+='<div style="color:var(--tx3)">Keine Fehler oder Warnungen</div>';
  else logs.forEach(l=>{
    const color=l.type==='error'?'#d32f2f':'#f57c00';
    const icon=l.type==='error'?'⛔':'⚠️';
    const time=new Date(l.ts).toLocaleTimeString('de-DE');
    html+='<div style="color:'+color+'">'+icon+' <span style="opacity:0.6">'+time+'</span> '+l.msg.replace(/</g,'&lt;').substring(0,200)+'</div>';
  });
  html+='</div>';

  // State Export/Import
  html+='<div class="section-label" style="margin-top:12px">State Export / Import</div>';
  html+='<div style="display:flex;gap:8px;margin-bottom:8px">';
  html+='<button class="btn btn-secondary" style="flex:1" onclick="copyStateJSON()">📋 State kopieren</button>';
  html+='<button class="btn btn-secondary" style="flex:1" onclick="toggleStateImport()">📥 State importieren</button>';
  html+='</div>';
  html+='<div id="stateImportArea" style="display:none"><textarea id="stateImportInput" placeholder="State-JSON hier einfügen..." style="width:100%;box-sizing:border-box;height:120px;font-size:11px;font-family:monospace;padding:8px;border-radius:var(--r-sm);border:1px solid var(--bdr);background:var(--bg);color:var(--tx);resize:vertical"></textarea><button class="btn btn-primary" style="margin-top:6px" onclick="importState()">Importieren</button></div>';

  html+='<button class="btn btn-secondary" style="margin-top:16px;position:sticky;bottom:0" onclick="closeDebugModal()">Schließen</button>';
  document.getElementById('debugModalContent').innerHTML=html;
  document.getElementById('debugModal').classList.add('show');
}
export function copyStateJSON(){
  const json=JSON.stringify(state,null,2);
  navigator.clipboard.writeText(json).then(()=>showToast('State in Zwischenablage kopiert','success')).catch(()=>{
    const ta=document.createElement('textarea');ta.value=json;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
    showToast('State in Zwischenablage kopiert','success');
  });
}
export function toggleStateImport(){
  const area=document.getElementById('stateImportArea');
  area.style.display=area.style.display==='none'?'block':'none';
}
export async function importState(){
  const input=document.getElementById('stateImportInput').value.trim();
  if(!input){showToast('Kein JSON eingegeben','error');return}
  let parsed;
  try{parsed=JSON.parse(input)}catch(e){showToast('Ungültiges JSON: '+e.message,'error');return}
  if(!parsed.players||!Array.isArray(parsed.players)){showToast('Ungültiger State: players fehlt','error');return}
  const ok=await showConfirm('Aktuellen State wirklich überschreiben? Das kann nicht rückgängig gemacht werden.','Überschreiben',true);
  if(!ok)return;
  Object.assign(state,parsed);
  save();
  closeDebugModal();
  load();
  renderAll();
  showToast('State importiert','success');
}
export function renderAll(){
  invalidateEingabeCache();
  showScreen('eingabe');
}
export function closeDebugModal(){document.getElementById('debugModal').classList.remove('show')}
document.getElementById('debugModal').addEventListener('click',function(e){if(e.target===this)closeDebugModal()});
export function closeInfoModal(){document.getElementById('infoModal').classList.remove('show')}
document.getElementById('infoModal').addEventListener('click',function(e){if(e.target===this)closeInfoModal()});

// ── Theme ──
export function toggleTheme(){
  const html=document.documentElement;
  const isLight=html.getAttribute('data-theme')==='light';
  html.setAttribute('data-theme',isLight?'dark':'light');
  localStorage.setItem('doko-theme',isLight?'dark':'light');
  updateThemeIcon();
}
export function updateThemeIcon(){
  const el=document.getElementById('themeIcon');
  if(!el)return;
  const isLight=document.documentElement.getAttribute('data-theme')==='light';
  el.innerHTML=isLight?'<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>':'<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
}
// ── Akzentfarbe (frei wählbar, überschreibt die Theme-Standardfarbe) ──
function hexToRgb(hex){
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex||'');
  return m?{r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16)}:null;
}
function lightenHex(hex,pct){
  const c=hexToRgb(hex);if(!c)return hex;
  const f=v=>Math.round(v+(255-v)*(pct/100)).toString(16).padStart(2,'0');
  return '#'+f(c.r)+f(c.g)+f(c.b);
}
function darkenHex(hex,pct){
  const c=hexToRgb(hex);if(!c)return hex;
  const f=v=>Math.round(v*(1-pct/100)).toString(16).padStart(2,'0');
  return '#'+f(c.r)+f(c.g)+f(c.b);
}
// Relative Helligkeit 0..1 (Lesbarkeit: <0.5 ≈ dunkel)
function luminance(hex){
  const c=hexToRgb(hex);if(!c)return 1;
  return (0.299*c.r+0.587*c.g+0.114*c.b)/255;
}
// Setzt --acc/--acc2/--acc-bg als Inline-Override (leerer Wert = Theme-Standard)
export function applyAccent(hex){
  const root=document.documentElement;
  if(hex){
    const c=hexToRgb(hex);
    root.style.setProperty('--acc',hex);
    root.style.setProperty('--acc2',lightenHex(hex,18));
    if(c)root.style.setProperty('--acc-bg','rgba('+c.r+','+c.g+','+c.b+',.12)');
  }else{
    root.style.removeProperty('--acc');
    root.style.removeProperty('--acc2');
    root.style.removeProperty('--acc-bg');
  }
}
export function setAccent(hex){
  if(hex)localStorage.setItem('doko-accent',hex);else localStorage.removeItem('doko-accent');
  applyAccent(hex);
  openSettings(); // Modal neu rendern, damit die aktive Farbe markiert wird
}

// ── Hintergrundfarbe (frei wählbar) ──
// Leitet aus einer Basisfarbe die abgestuften Flächen (--bg/--bg2/--bg3/--bg4)
// ab und wählt automatisch lesbare Textfarben (--tx/--tx2/--tx3) + Rahmen (--bdr).
// Leerer Wert = Theme-Standard.
export function applyBg(hex){
  const root=document.documentElement;
  if(hex){
    const dark=luminance(hex)<0.5;
    root.style.setProperty('--bg',hex);
    if(dark){
      root.style.setProperty('--bg2',lightenHex(hex,6));
      root.style.setProperty('--bg3',lightenHex(hex,12));
      root.style.setProperty('--bg4',lightenHex(hex,20));
      root.style.setProperty('--tx','#e8ecf4');
      root.style.setProperty('--tx2','#9ba3b8');
      root.style.setProperty('--tx3','#636b82');
      root.style.setProperty('--bdr','rgba(255,255,255,.07)');
    }else{
      root.style.setProperty('--bg2',lightenHex(hex,4));
      root.style.setProperty('--bg3',darkenHex(hex,5));
      root.style.setProperty('--bg4',darkenHex(hex,11));
      root.style.setProperty('--tx','#1a1c24');
      root.style.setProperty('--tx2','#5a5e72');
      root.style.setProperty('--tx3','#8b8fa6');
      root.style.setProperty('--bdr','rgba(0,0,0,.08)');
    }
  }else{
    ['--bg','--bg2','--bg3','--bg4','--tx','--tx2','--tx3','--bdr'].forEach(p=>root.style.removeProperty(p));
  }
}
export function setBg(hex){
  if(hex)localStorage.setItem('doko-bg',hex);else localStorage.removeItem('doko-bg');
  applyBg(hex);
  openSettings(); // Modal neu rendern, damit die aktive Farbe markiert wird
}

(function(){
  const saved=localStorage.getItem('doko-theme');
  if(saved)document.documentElement.setAttribute('data-theme',saved);
  else document.documentElement.setAttribute('data-theme','light');
  applyAccent(localStorage.getItem('doko-accent')||'');
  applyBg(localStorage.getItem('doko-bg')||'');
  updateThemeIcon();
})();

export function getChartColors(){
  const s=getComputedStyle(document.documentElement);
  return{grid:s.getPropertyValue('--chart-grid').trim(),tick:s.getPropertyValue('--chart-tick').trim(),lbl:s.getPropertyValue('--chart-lbl').trim()};
}

// ═══════════════════════════════════════════════════════════
// Modals per Zurück-Geste schließen:
//  - Hardware-/Browser-Zurück (popstate) – Android-Back, Safari-Kantenwisch
//  - Touch-Swipe nach rechts auf dem Modal – iOS-Standalone hat keine System-Geste
// Zentral für alle Overlays; nameModal ausgenommen (erzwungene Eingabe).
// ═══════════════════════════════════════════════════════════
function dokoOpenOverlays(){
  return [...document.querySelectorAll('.modal-overlay.show:not(#nameModal), .confirm-overlay.show')];
}
function dokoTopOverlay(){
  const open=dokoOpenOverlays();
  if(!open.length)return null;
  return open.sort((a,b)=>(parseInt(getComputedStyle(a).zIndex)||0)-(parseInt(getComputedStyle(b).zIndex)||0)).pop();
}
function dokoCloseOverlay(ov){
  if(!ov)return;
  // Bevorzugt die eigene Schließ-Logik des Overlays auslösen (Klick aufs Overlay)
  ov.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
  if(ov.classList.contains('show'))ov.classList.remove('show'); // Fallback
}
// History-Synchronisierung über MutationObserver (kein Eingriff in die vielen open*-Funktionen nötig).
// Beim Öffnen genau EINEN History-Eintrag anlegen; programmatisches history.back() vermeiden wir
// bewusst – die Zurück-Geste/-Taste (popstate) schließt das oberste Overlay.
function dokoSyncHistory(){
  if(dokoOpenOverlays().length>0 && !(history.state&&history.state.dokoModal)){
    history.pushState({dokoModal:1},'');
  }
}
const dokoMO=new MutationObserver(dokoSyncHistory);
document.querySelectorAll('.modal-overlay, .confirm-overlay').forEach(el=>dokoMO.observe(el,{attributes:true,attributeFilter:['class']}));
window.addEventListener('popstate',()=>{
  if(!dokoOpenOverlays().length)return;
  const top=dokoTopOverlay();
  // Im Liga-Fenster eine Navigationsebene zurück statt gleich alles zu schließen.
  if(top&&top.id==='ligaModal'&&liga.ligaCanGoBack&&liga.ligaCanGoBack()){
    liga.ligaBack();
    history.pushState({dokoModal:1},'');
    return;
  }
  dokoCloseOverlay(top);
});
// Touch-Swipe nach rechts
let dokoSwX=0,dokoSwY=0,dokoSwOv=null;
document.addEventListener('touchstart',e=>{
  dokoSwOv=dokoTopOverlay();
  if(!dokoSwOv)return;
  const t=e.changedTouches[0];dokoSwX=t.clientX;dokoSwY=t.clientY;
},{passive:true});
document.addEventListener('touchend',e=>{
  if(!dokoSwOv)return;
  const t=e.changedTouches[0];
  const dx=t.clientX-dokoSwX, dy=t.clientY-dokoSwY;
  const fromEdge=dokoSwX<=36;
  if(dx>80 && Math.abs(dy)<60 && dx>Math.abs(dy)*1.5 && (fromEdge||dx>120)){
    if(dokoTopOverlay()===dokoSwOv)dokoCloseOverlay(dokoSwOv);
  }
  dokoSwOv=null;
},{passive:true});

// ═══════════════════════════════════════════════════════════
// PWA / Service Worker (vite-plugin-pwa) – ersetzt das alte sw.js
// ═══════════════════════════════════════════════════════════
// Auto-Update (registerType:'autoUpdate'): Ein neuer Service Worker uebernimmt sofort
// (skipWaiting + clientsClaim); vite-plugin-pwa laedt die Seite bei "controllerchange"
// automatisch neu. Wir pruefen zusaetzlich periodisch und bei Rueckkehr in die App,
// damit ein laufender Tab Updates zeitnah mitbekommt.
let swRegistration=null;  // ServiceWorkerRegistration (fuer manuelle Pruefung)
let refreshing=false;     // Reload-Guard gegen Doppel-Reload
const UPDATE_INTERVAL=60000;

// Sofort neu laden (Toast-Button "Jetzt aktualisieren").
export function applyUpdate(){
  if(refreshing)return;
  refreshing=true;
  location.reload();
}

// Manuelle Update-Pruefung (Button im "Mehr"-Screen). Fragt den SW aktiv nach
// einem Update; bei einem Treffer aktiviert dieser sofort und die App laedt neu.
export async function checkForUpdate(){
  if(refreshing)return;
  showToast('Suche nach Updates…');
  if(!('serviceWorker'in navigator)||!swRegistration){
    // Kein SW (z.B. Dev/Browser ohne PWA) -> harter Reload als Fallback.
    showToast('Lade neu…');
    setTimeout(()=>location.reload(),400);
    return;
  }
  try{
    await swRegistration.update();
  }catch(e){
    showToast('Update-Pruefung fehlgeschlagen – bist du online?');
    return;
  }
  // Kurz warten, bis ein evtl. neuer SW erkannt wurde (installing/waiting).
  await new Promise(res=>setTimeout(res,1000));
  if(swRegistration.installing||swRegistration.waiting){
    showToast('Neue Version gefunden – wird geladen…');
    // Sicherheitshalber selbst neu laden, falls controllerchange ausbleibt.
    setTimeout(()=>{if(!refreshing){refreshing=true;location.reload();}},3000);
  }else{
    showToast('Du hast bereits die neueste Version. ✅');
  }
}

const updateSW = registerSW({
  onRegisteredSW(swUrl,r){
    if(!r)return;
    swRegistration=r;
    try{r.update()}catch(e){}
    setInterval(()=>{try{r.update()}catch(e){}},UPDATE_INTERVAL);
    const recheck=()=>{if(document.visibilityState==='visible'){try{r.update()}catch(e){}}};
    document.addEventListener('visibilitychange',recheck);
    window.addEventListener('focus',recheck);
    window.addEventListener('online',recheck);
  },
  onRegisterError(e){console.error('SW register error:',e);}
});

// ═══════════════════════════════════════════════════════════
// window-Registrierung ALLER onclick-Funktionen (main + ui + Geschwister-Module).
// onclick-Handler im HTML/innerHTML referenzieren globale Funktionsnamen – durch
// dieses Object.assign sind alle Modul-Exporte global verfuegbar.
// ═══════════════════════════════════════════════════════════
Object.assign(window,
  {
    showToast, hideToast, showConfirm, showPrompt, launchConfetti, launchMiniConfetti,
    showScreen, shareCurrentScreen, toggleTheme, getChartColors, openSettings, closeSettings, renderMehrScreen,
    applyAccent, setAccent, applyBg, setBg,
    openInfoModal, openChangelogModal, openFeedbackModal, closeInfoModal, sendFeedbackMail, handleVersionTap,
    openDebugModal, closeDebugModal, copyStateJSON, toggleStateImport, importState,
    renderAll, applyUpdate, checkForUpdate, toggleCollapse
  },
  setup, eingabe, tabelle, stats, archiv, turnier, admin, cloud, game, share, liga, audit
);

// ═══════════════════════════════════════════════════════════
// App initialisieren (nachdem alle Funktionen global registriert sind).
// ═══════════════════════════════════════════════════════════
load();
