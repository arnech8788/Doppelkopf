import { state, save, getAllPlayers, getHistoricalPlayers, invalidateEingabeCache, showScreen, timerInterval, setCurrentPts, setPendingRound, setLastUndo, setTimerInterval } from './main.js';
import { showToast, showConfirm, ICO } from './ui.js';

export function renderSoloTypes(){
  const c=document.getElementById('soloTypesList');
  if(!c)return;
  c.innerHTML=state.soloTypes.map((s,i)=>
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bdr)"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" '+(s.enabled?'checked':'')+' onchange="toggleSoloType('+i+')"> '+s.name+' <span style="color:var(--tx3);font-size:11px">('+s.short+')</span></label><button class="icon-btn" onclick="removeSoloType('+i+')">'+ICO.x+'</button></div>'
  ).join('');
}
export function toggleSoloType(i){state.soloTypes[i].enabled=!state.soloTypes[i].enabled;save();renderSoloTypes()}
export function removeSoloType(i){state.soloTypes.splice(i,1);save();renderSoloTypes()}
export function addCustomSolo(){
  const inp=document.getElementById('customSoloInput');
  const name=inp.value.trim();if(!name)return;
  const short=name.substring(0,2).toUpperCase();
  state.soloTypes.push({name,short,enabled:true});
  inp.value='';save();renderSoloTypes();
}

export function renderQuickStart(){
  const el=document.getElementById('quickStartCard');
  if(!el)return;
  // Nur anzeigen wenn <4 Spieler UND Archiv vorhanden
  const archive=loadArchive();
  if(getAllPlayers().length>=4||!archive.length||!archive[0].players||!archive[0].players.length){
    el.innerHTML='';return;
  }
  const lastPlayers=archive[0].players;
  el.innerHTML='<div class="card" style="cursor:pointer;border:1px solid var(--acc2);background:var(--acc-bg)" onclick="quickStart()">'
    +'<div style="display:flex;justify-content:space-between;align-items:center">'
    +'<div><div style="font-size:11px;color:var(--tx3);margin-bottom:2px">Letzte Spielrunde</div>'
    +'<div style="font-weight:500">'+lastPlayers.join(', ')+'</div></div>'
    +'<svg viewBox="0 0 24 24" fill="none" stroke="var(--acc2)" stroke-width="2" style="width:20px;height:20px;flex-shrink:0"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
    +'</div></div>';
}
export function quickStart(){
  const archive=loadArchive();
  if(!archive.length)return;
  state.players=[...archive[0].players];
  save();
  renderPlayerTags();
  renderQuickStart();
  invalidateEingabeCache();
  showScreen('eingabe');
}
export function renderPlayerTags(){
  const c=document.getElementById('playerManageList');
  if(!c)return;
  if(!state.players.length){c.innerHTML='<div style="font-size:13px;color:var(--tx3);padding:8px 0">Noch keine Mitspieler</div>';return}
  c.innerHTML=state.players.map((p,i)=>
    '<div class="player-manage"><span class="pm-name">'+p+'</span><div class="pm-actions">'
    +'<button class="icon-btn" onclick="movePlayer('+i+',-1)"'+(i===0?' disabled':'')+'>'+ICO.up+'</button>'
    +'<button class="icon-btn" onclick="movePlayer('+i+',1)"'+(i===state.players.length-1?' disabled':'')+'>'+ICO.down+'</button>'
    +'<button class="icon-btn" onclick="editPlayerName('+i+')">'+ICO.edit+'</button>'
    +'<button class="icon-btn" onclick="removePlayer('+i+')">'+ICO.trash+'</button>'
    +'</div></div>'
  ).join('');
}
export function movePlayer(i,dir){
  const j=i+dir;if(j<0||j>=state.players.length)return;
  const tmp=state.players[i];state.players[i]=state.players[j];state.players[j]=tmp;
  save();renderPlayerTags();
  invalidateEingabeCache();
}
let editingPlayerIdx=null;
export function editPlayerName(i){
  editingPlayerIdx=i;
  const oldName=state.players[i];
  let html='<h3>Spieler umbenennen</h3>';
  html+='<div class="section-label">Neuer Name</div>';
  html+='<input type="text" id="editPlayerInput" value="'+oldName+'" style="margin-bottom:16px">';
  html+='<div style="display:flex;gap:8px"><button class="btn btn-secondary" onclick="closeRenameModal()" style="flex:1">Abbrechen</button><button class="btn btn-primary" onclick="savePlayerName()" style="flex:1">'+ICO.check+' Speichern</button></div>';
  document.getElementById('renameModalContent').innerHTML=html;
  document.getElementById('renameModal').classList.add('show');
  setTimeout(()=>{const inp=document.getElementById('editPlayerInput');inp.focus();inp.select()},50);
}
export function closeRenameModal(){document.getElementById('renameModal').classList.remove('show')}
export async function savePlayerName(){
  const inp=document.getElementById('editPlayerInput');
  const trimmed=inp.value.trim();
  const oldName=state.players[editingPlayerIdx];
  if(!trimmed||trimmed===oldName){closeRenameModal();return}
  if(state.players.includes(trimmed)){showToast('Dieser Name existiert bereits.','error');return}
  // Konflikt mit historischem (gelöschtem) Spieler abfangen –
  // sonst würden Punkte versehentlich zusammengeführt
  const historical=getHistoricalPlayers();
  if(historical.includes(trimmed)){
    if(!await showConfirm('"'+trimmed+'" wurde früher schon einmal verwendet (z. B. gelöschter Spieler). Wenn du fortfährst, werden die alten Punkte und Statistiken auf '+oldName+' übertragen.','Fortfahren'))return;
  }
  state.rounds.forEach(r=>{
    const idx=r.playing.indexOf(oldName);if(idx>=0)r.playing[idx]=trimmed;
    const wIdx=r.winners.indexOf(oldName);if(wIdx>=0)r.winners[wIdx]=trimmed;
    if(r.scores[oldName]!==undefined){r.scores[trimmed]=r.scores[oldName];delete r.scores[oldName]}
  });
  state.players[editingPlayerIdx]=trimmed;
  if(!state.knownNames.includes(trimmed))state.knownNames.push(trimmed);
  save();renderPlayerTags();closeRenameModal();
  invalidateEingabeCache();
}
document.getElementById('renameModal').addEventListener('click',function(e){if(e.target===this)closeRenameModal()});

export async function addPlayer(){
  const inp=document.getElementById('addPlayerInput');
  if(!inp)return;
  const name=inp.value.trim();
  if(!name||state.players.includes(name))return;
  // Hinweis falls der Name historisch existiert (gelöschter Spieler kehrt zurück)
  const historical=getHistoricalPlayers();
  if(historical.includes(name)){
    if(!await showConfirm('"'+name+'" hat in dieser Runde schon einmal gespielt. Wenn du fortfährst, werden die bisherigen Punkte und Statistiken weiter mit diesem Spieler verknüpft.','Fortfahren'))return;
  }
  state.players.push(name);
  if(!state.knownNames.includes(name))state.knownNames.push(name);
  inp.value='';renderPlayerTags();renderQuickStart();
  checkAutoStart();save();
  invalidateEingabeCache();
  const sug=document.getElementById('suggestions');
  if(sug)sug.classList.remove('show');
  setTimeout(()=>{inp.focus()},50);
}
export async function removePlayer(i){
  const name=state.players[i];
  const hasGames=state.rounds.some(r=>r.playing.includes(name));
  if(hasGames){
    if(!await showConfirm(name+' hat bereits Spiele.\n\nDer Spieler wird nur aus der Eingabe-Auswahl entfernt. Alle Punkte und Statistiken bleiben erhalten.','Entfernen',true))return;
  }
  state.players.splice(i,1);renderPlayerTags();renderQuickStart();save();
  invalidateEingabeCache();
}
export function checkAutoStart(){
  if(getAllPlayers().length>=4){
    const bockCountEl=document.getElementById('bockCount');
    state.bockCount=bockCountEl?parseInt(bockCountEl.value)||getAllPlayers().length:state.bockCount||getAllPlayers().length;
  }
}

export function initAddPlayerInput(){
  const addInp=document.getElementById('addPlayerInput');
  if(!addInp)return;
  addInp.addEventListener('input',function(){
    const v=this.value.trim().toLowerCase();
    const sug=document.getElementById('suggestions');
    if(!v){sug.classList.remove('show');return}
    const all=getAllPlayers();
    const matches=state.knownNames.filter(n=>n.toLowerCase().includes(v)&&!all.includes(n));
    if(!matches.length){sug.classList.remove('show');return}
    sug.innerHTML=matches.map(m=>'<div class="sug-item" onclick="pickSuggestion(\''+m.replace(/'/g,"\\'")+'\')">' +m+'</div>').join('');
    sug.classList.add('show');
  });
  addInp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();addPlayer()}});
}
initAddPlayerInput();
export function pickSuggestion(name){document.getElementById('addPlayerInput').value=name;document.getElementById('suggestions').classList.remove('show');addPlayer()}

// Eigener Spieler-Screen (Bottom-Nav-Reiter "Spieler"): Spieler eintragen/anpassen,
// Quickstart und Spielsteuerung – wiederverwendet die vorhandenen Render-Helfer.
export function renderSpielerScreen(){
  const el=document.getElementById('spielerContent');
  if(!el)return;
  let html='<div id="quickStartCard"></div>';
  html+='<div class="card"><div class="card-title">Spieler</div>';
  html+='<div style="font-size:12px;color:var(--tx3);margin-bottom:12px;line-height:1.5">Reihenfolge bestimmt den Geber – der erste Spieler gibt zuerst. Antippen zum Umbenennen, Pfeile zum Sortieren.</div>';
  html+='<div id="playerManageList"></div>';
  html+='<div class="input-wrap" style="margin-top:8px"><input type="text" id="addPlayerInput" placeholder="Spieler hinzufügen..." autocomplete="off"><div class="suggestions" id="suggestions"></div></div>';
  html+='<button class="btn btn-secondary" style="margin-top:8px" onclick="addPlayer()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M12 5v14M5 12h14"/></svg> Hinzufügen</button>';
  html+='</div>';
  if(state.rounds.length>0){
    html+='<div class="card"><div class="card-title">Aktuelles Spiel</div>';
    html+='<div style="display:flex;gap:8px">';
    html+='<button class="btn btn-secondary" style="margin:0" onclick="startNewGame()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><polygon points="5 3 19 12 5 21 5 3"/></svg> Neues Spiel</button>';
    html+='<button class="btn btn-secondary" style="margin:0" onclick="endGame()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><rect x="5" y="5" width="14" height="14" rx="2"/></svg> Spiel beenden</button>';
    html+='</div></div>';
  }
  el.innerHTML=html;
  renderPlayerTags();
  renderQuickStart();
  initAddPlayerInput();
}

export async function startNewGame(){
  if(state.rounds.length===0){
    showToast('Es sind noch keine Spiele eingetragen.','info');
    return;
  }
  if(!await showConfirm('Aktuelles Spiel wird archiviert und ein neues gestartet.','Neues Spiel'))return;
  archiveCurrentGame();
  checkSeasonAchievements();
  state.rounds=[];
  state.bockQueue=0;
  state.gameStartTime=null;
  state.kursleiterCupSeen=false;
  state.dokoRundeSeen=false;
  if(state.turnier&&!state.turnier.isHost){leaveTurnier(true)}
  setLastUndo(null);
  setPendingRound(null);
  setCurrentPts('');
  if(timerInterval){clearInterval(timerInterval);setTimerInterval(null)}
  invalidateEingabeCache();
  save();
  showScreen('eingabe');
}
