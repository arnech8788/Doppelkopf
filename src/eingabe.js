import { state, save, getAllPlayers, getHistoricalPlayers, getPlayerEmoji, getVocab, invalidateEingabeCache, isBockRound, showScreen, ACHIEVEMENTS, currentPts, pendingRound, lastUndo, timerInterval, setCurrentPts, setPendingRound, setLastUndo, setTimerInterval } from './main.js';
import { showToast, showConfirm, showPrompt, ICO, launchConfetti, launchMiniConfetti } from './ui.js';
import { renderPlayerTags, renderQuickStart, initAddPlayerInput } from './setup.js';
import { archiveCurrentGame } from './archiv.js';

export function renderEingabe(){
  document.getElementById('successMsg').style.display='none';
  const spielerLeiste=document.getElementById('spielerLeiste');

  if(getAllPlayers().length<4){
    // Leerzustand – Spielerverwaltung lebt jetzt im Spieler-Tab
    spielerLeiste.innerHTML='';
    document.getElementById('bockIndicator').innerHTML='';
    document.getElementById('eingabeContent').innerHTML='<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>Trage zuerst mindestens 4 Spieler ein.<button class="btn btn-primary" style="margin-top:14px;width:auto;padding:10px 20px" onclick="showScreen(\'spieler\')">Zu „Spieler"</button></div>';
    return;
  }

  // Spieler-Leiste entfernt (spart Platz) – Spielerverwaltung lebt im Spieler-Tab,
  // der aktuelle Geber steht im Karten-Titel weiter unten.
  spielerLeiste.innerHTML='';

  const bi=document.getElementById('bockIndicator');
  let biHtml='';
  const all=getAllPlayers();
  if(state.rounds.length>0&&state.rounds.length%all.length===0){
    const completedRunde=Math.floor(state.rounds.length/all.length);
    biHtml+='<div style="background:var(--warn-bg);color:var(--warn);padding:8px 12px;border-radius:var(--r-sm);font-size:13px;font-weight:500;text-align:center;margin-bottom:8px;border:1px solid rgba(240,168,48,.15)">&#127183; Runde '+completedRunde+' beendet!</div>';
  }
  if(isBockRound()){
    const bockLabel=getVocab().bockrunde;
    biHtml+='<div class="bock-indicator">&#9889; '+bockLabel+'! Noch '+state.bockQueue+' '+(state.bockQueue>1?'Spiele':'Spiel')+'</div>';
  }
  bi.innerHTML=biHtml;
  setCurrentPts('');
  const dealerIdx=state.rounds.length%all.length;
  const dealer=all[dealerIdx];
  const rundeNr=Math.floor(state.rounds.length/all.length)+1;
  const spielInRunde=(state.rounds.length%all.length)+1;
  const dealerEmoji=getPlayerEmoji(dealer);
  const vocab=getVocab();
  let html='<div class="card"><div class="card-title" style="margin-bottom:6px">Runde '+rundeNr+' · '+vocab.spiel+' '+spielInRunde+' von '+all.length+' · <span style="color:var(--acc2)">&#9827; '+(dealerEmoji?dealerEmoji+' ':'')+dealer+' gibt</span></div>';
  html+='<div class="pts-display empty" id="ptsDisplay">Punkte eingeben</div>';
  html+='<div style="display:flex;justify-content:center;gap:6px;margin-bottom:8px;align-items:center">';
  html+='<button class="share-btn" onclick="numpadToggleSign()" style="font-size:11px;padding:5px 12px;opacity:.7;color:var(--warn)">\u00b1 Vorzeichen</button>';
  html+='<button class="share-btn" onclick="openCalcModal()" style="font-size:11px;padding:5px 12px;opacity:.7"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10.01"/><line x1="12" y1="10" x2="12" y2="10.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/><line x1="8" y1="18" x2="16" y2="18"/></svg> Punkte z\u00e4hlen</button>';
  html+='<button class="icon-btn" onclick="openCalcHelpModal()" style="padding:6px;background:var(--bg3);border:1px solid var(--bdr);border-radius:50%;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;font-family:\'Space Mono\',monospace;font-size:12px;font-weight:700;color:var(--tx2);opacity:.7" aria-label="Hilfe zur Punktez\u00e4hlung">?</button>';
  html+='</div>';
  html+='<div class="numpad">';
  for(let i=1;i<=9;i++){html+='<div class="numpad-btn" onclick="numpadPress('+i+')">'+i+'</div>'}
  html+='<div class="numpad-btn del" onclick="numpadClear()">'+ICO.trash+'</div>';
  html+='<div class="numpad-btn" onclick="numpadPress(0)">0</div>';
  html+='<div class="numpad-btn del" onclick="numpadDelete()">'+ICO.backspace+'</div>';
  html+='</div>';
  html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div class="section-label" style="margin:0">Spieler antippen</div><div class="chip-legend" style="margin:0;margin-left:auto"><span><span class="dot" style="background:var(--bg4)"></span> Nicht dabei</span><span><span class="dot" style="background:var(--red)"></span> Verloren</span><span><span class="dot" style="background:var(--grn)"></span> Gewonnen</span></div></div>';
  html+='<div class="chip-grid" id="playerChips">';
  const streaks=getWinStreaks();
  const looseStreaks=getLooseStreaks();
  all.forEach(p=>{
    const icon=getStreakIcon(p,streaks,looseStreaks);
    const emoji=getPlayerEmoji(p);
    const displayName=(emoji?emoji+' ':'')+p;
    html+='<div class="player-chip" data-player="'+p+'" data-state="neutral" onpointerdown="cycleState(this)"><span class="chip-icon"></span>'+displayName+(icon?' <span style="font-size:12px">'+icon+'</span>':'')+'</div>';
  });
  html+='</div>';
  if(state.bockEnabled){
    html+='<div class="toggle-row"><span class="toggle-label">&#9889; Neue '+vocab.bockrunde+' auslösen</span><button class="toggle" id="triggerBockToggle" onclick="this.classList.toggle(\'on\')"></button></div>';
  }
  const turnierReadOnly=state.turnier&&!state.turnier.isHost&&state.turnier.schreiberId&&(()=>{const d=getDeviceId();const o=spielerCache.find(s=>s.deviceIds&&s.deviceIds.includes(d));return o&&o.id!==state.turnier.schreiberId})();
  if(turnierReadOnly){
    html+='<div style="text-align:center;color:var(--tx3);font-size:13px;padding:16px;border:1px dashed var(--bdr);border-radius:var(--r);margin-top:8px">Du bist Zuschauer an diesem Tisch. Nur der Schreiber kann Runden eintragen.<br><a href="#" onclick="transferSchreiber();return false" style="font-size:12px;color:var(--acc)">Schreiber-Rolle übernehmen anfragen</a></div>';
  }else{
    html+='<div style="display:flex;gap:6px;margin-top:4px"><button class="btn btn-primary" style="flex:1.5;padding:10px 10px;font-size:13px" onclick="saveNewRound()">'+ICO.check+' '+vocab.spiel+' speichern</button><button class="btn btn-secondary" style="flex:1;padding:10px 10px;font-size:13px'+(lastUndo?';opacity:.7':';opacity:.35;pointer-events:none')+'" onclick="undoLastRound()">'+ICO.backspace+' Rückg\u00e4ngig</button></div>';
  }
  html+='</div>';
  if(state.gameStartTime){
    html+='<div id="gameTimer" style="text-align:center;padding:8px;font-size:11px;color:var(--tx3);font-family:\'Space Mono\',monospace"></div>';
  }
  document.getElementById('eingabeContent').innerHTML=html;
  document.getElementById('eingabeContent').dataset.roundCount=state.rounds.length;
  startTimerUpdate();
}

export function getWinStreaks(playerList){
  const all=playerList||getAllPlayers();
  const streaks={};all.forEach(p=>streaks[p]=0);
  for(let i=state.rounds.length-1;i>=0;i--){
    const r=state.rounds[i];
    all.forEach(p=>{
      if(!r.playing.includes(p))return;
      if(streaks[p]===-1)return;
      if(r.winners.includes(p)){streaks[p]++}
      else{streaks[p]=-1}
    });
  }
  all.forEach(p=>{if(streaks[p]===-1)streaks[p]=0});
  return streaks;
}
export function getLooseStreaks(playerList){
  const all=playerList||getAllPlayers();
  const streaks={};all.forEach(p=>streaks[p]=0);
  for(let i=state.rounds.length-1;i>=0;i--){
    const r=state.rounds[i];
    all.forEach(p=>{
      if(!r.playing.includes(p))return;
      if(streaks[p]===-1)return;
      if(!r.winners.includes(p)){streaks[p]++}
      else{streaks[p]=-1}
    });
  }
  all.forEach(p=>{if(streaks[p]===-1)streaks[p]=0});
  return streaks;
}
export function getFlames(streak){
  if(streak>=6)return '🔥🔥🔥';
  if(streak>=4)return '🔥🔥';
  if(streak>=2)return '🔥';
  return '';
}
export function getSkulls(streak){
  if(streak>=6)return '💀💀💀';
  if(streak>=4)return '💀💀';
  if(streak>=2)return '💀';
  return '';
}
export function getStreakIcon(p,winStreaks,looseStreaks){
  // Sieg-Serie hat Vorrang vor Pech-Serie (kann eigentlich nicht beides sein, aber sicher ist sicher)
  const f=getFlames(winStreaks[p]);
  if(f)return f;
  return getSkulls(looseStreaks[p]);
}
export function formatDuration(ms){
  const s=Math.floor(ms/1000);
  const h=Math.floor(s/3600);
  const m=Math.floor((s%3600)/60);
  const sec=s%60;
  if(h>0)return h+'h '+String(m).padStart(2,'0')+'m';
  return m+'m '+String(sec).padStart(2,'0')+'s';
}
export function updateTimerDisplay(){
  const el=document.getElementById('gameTimer');
  if(!el||!state.gameStartTime)return;
  const elapsed=Date.now()-state.gameStartTime;
  const avgPerGame=state.rounds.length?elapsed/state.rounds.length:0;
  el.textContent='⏱ '+formatDuration(elapsed)+(state.rounds.length?' · Ø '+formatDuration(avgPerGame)+'/Spiel':'');
}
export function startTimerUpdate(){
  if(timerInterval)clearInterval(timerInterval);
  if(state.gameStartTime){updateTimerDisplay();setTimerInterval(setInterval(updateTimerDisplay,1000))}
}
export function cycleState(el){
  const cur=el.dataset.state;
  let next=cur==='neutral'?'lost':cur==='lost'?'won':'neutral';
  el.dataset.state=next;
  const icon=el.querySelector('.chip-icon');
  icon.innerHTML=next==='lost'?ICO.x:next==='won'?ICO.check:'';
}
export function numpadPress(n){
  // Max 3 Ziffern (ohne Vorzeichen)
  const digits=currentPts.replace('-','');
  if(digits.length>=3)return;
  setCurrentPts(currentPts+n);
  updatePtsDisplay();
}
export function numpadDelete(){setCurrentPts(currentPts.slice(0,-1));updatePtsDisplay()}
export function numpadClear(){setCurrentPts('');updatePtsDisplay()}
export function numpadToggleSign(){
  if(!currentPts)return; // Vorzeichen nur sinnvoll bei eingegebenen Zahlen
  if(currentPts.startsWith('-')){setCurrentPts(currentPts.slice(1))}
  else{setCurrentPts('-'+currentPts)}
  updatePtsDisplay();
}
export function updatePtsDisplay(){
  const el=document.getElementById('ptsDisplay');if(!el)return;
  if(currentPts){
    el.textContent=currentPts;
    el.classList.remove('empty');
    // Bei negativen Werten visuell hervorheben
    el.style.color=currentPts.startsWith('-')?'var(--red)':'';
  }else{
    el.textContent='Punkte eingeben';
    el.classList.add('empty');
    el.style.color='';
  }
}
export function undoLastRound(){
  if(!lastUndo)return;
  state.rounds.pop();
  state.bockQueue=lastUndo.bockQueueBefore;
  save();syncToFirebase();
  renderEingabe();
  setCurrentPts(''+lastUndo.round.points);
  updatePtsDisplay();
  const chips=document.querySelectorAll('#playerChips .player-chip');
  chips.forEach(c=>{
    const p=c.dataset.player;
    const ps=lastUndo.playerStates.find(s=>s.name===p);
    if(ps){c.dataset.state=ps.won?'won':'lost';c.querySelector('.chip-icon').innerHTML=ps.won?ICO.check:ICO.x}
  });
  setLastUndo(null);
  document.getElementById('eingabeContent').dataset.roundCount=state.rounds.length;
}
export function saveNewRound(){
  // Live-Check: gibt es überhaupt noch genug Spieler?
  if(getAllPlayers().length<4){
    showToast('Mindestens 4 Spieler werden benötigt. Bitte im Setup hinzufügen.','error');
    invalidateEingabeCache();
    renderEingabe();
    return;
  }
  const pts=parseInt(currentPts||'0');
  if(isNaN(pts)){showToast('Bitte Punkte eingeben.','error');return}
  if(!currentPts||currentPts==='-'){showToast('Bitte Punkte eingeben.','error');return}
  const chips=document.querySelectorAll('#playerChips .player-chip');
  const playing=[];const winners=[];const losers=[];
  chips.forEach(c=>{
    const p=c.dataset.player;const s=c.dataset.state;
    if(s==='lost'){playing.push(p);losers.push(p)}
    else if(s==='won'){playing.push(p);winners.push(p)}
  });
  if(playing.length!==4){showToast('Es müssen genau 4 Spieler mitspielen (rot oder grün). Aktuell: '+playing.length,'error');return}
  if(!winners.length){showToast('Mindestens einen Gewinner auswählen (grün).','error');return}
  if(!losers.length){showToast('Mindestens einen Verlierer auswählen (rot).','error');return}
  const solo=(winners.length===1)||(winners.length===3);
  const bock=isBockRound();
  const bockApplies=bock&&(!solo||state.bockSolo);
  const multiplier=bockApplies?2:1;
  const scores={};
  if(solo){
    const solist=winners.length===1?winners[0]:losers[0];
    const solistWon=winners.includes(solist);
    playing.forEach(p=>{
      if(p===solist){scores[p]=solistWon?pts*3*multiplier:-pts*3*multiplier}
      else{scores[p]=solistWon?-pts*multiplier:pts*multiplier}
    });
  }else{
    playing.forEach(p=>{scores[p]=winners.includes(p)?pts*multiplier:-pts*multiplier});
  }
  const round={points:pts,playing,winners,solo,bock:bockApplies,scores,soloType:null};
  if(solo&&state.soloTypesEnabled){setPendingRound(round);openSoloModal();return}
  finalizeRound(round);
}
export function openSoloModal(){
  const enabled=state.soloTypes.filter(s=>s.enabled);
  const vocab=getVocab();
  let html='<h3>Welche:r '+vocab.solo+'?</h3>';
  html+='<div class="solo-type-grid">';
  enabled.forEach(s=>{html+='<div class="solo-chip" data-solo="'+s.name+'" onclick="selectSoloType(this)">'+s.name+'</div>'});
  html+='</div>';
  html+='<div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-secondary" onclick="skipSoloType()" style="flex:1">Überspringen</button><button class="btn btn-primary" onclick="confirmSoloType()" style="flex:1">'+ICO.check+' Bestätigen</button></div>';
  document.getElementById('soloModalContent').innerHTML=html;
  document.getElementById('soloModal').classList.add('show');
}
export function selectSoloType(el){document.querySelectorAll('#soloModalContent .solo-chip').forEach(c=>c.classList.remove('selected'));el.classList.add('selected')}
export function confirmSoloType(){
  const sel=document.querySelector('#soloModalContent .solo-chip.selected');
  if(pendingRound){pendingRound.soloType=sel?sel.dataset.solo:null;finalizeRound(pendingRound)}
  document.getElementById('soloModal').classList.remove('show');setPendingRound(null);
}
export function skipSoloType(){if(pendingRound)finalizeRound(pendingRound);document.getElementById('soloModal').classList.remove('show');setPendingRound(null)}
document.getElementById('soloModal').addEventListener('click',function(e){if(e.target===this)skipSoloType()});

// Berechnet die Abend-Achievements eines Spielers FRISCH aus den aktuellen Runden.
// Gibt das Set der erfuellten Badge-IDs zurueck (keine Seiteneffekte auf state).
function computeEveningBadges(p,rounds,all){
  const earned=[];
  const playerRounds=rounds.filter(r=>r.playing.includes(p));
  // hotStreak: 5 Siege in Folge (pausierte Runden ignorieren)
  {let streak=0,maxStreak=0;
    playerRounds.forEach(r=>{if(r.winners.includes(p)){streak++;if(streak>maxStreak)maxStreak=streak}else{streak=0}});
    if(maxStreak>=5)earned.push('hotStreak');}
  // pechvogel: 5 Niederlagen in Folge
  {let streak=0,maxStreak=0;
    playerRounds.forEach(r=>{if(!r.winners.includes(p)){streak++;if(streak>maxStreak)maxStreak=streak}else{streak=0}});
    if(maxStreak>=5)earned.push('pechvogel');}
  // solist: 3 Soli an einem Abend
  {let soloCount=0;
    rounds.forEach(r=>{
      if(!r.solo||!r.playing.includes(p))return;
      let solist=null;
      if(r.winners.length===1)solist=r.winners[0];
      else if(r.winners.length===3)solist=r.playing.find(x=>!r.winners.includes(x));
      if(p===solist)soloCount++;
    });
    if(soloCount>=3)earned.push('solist');}
  // unbesiegbar: Keine Niederlage, mind. 5 Spiele
  if(playerRounds.length>=5&&!playerRounds.some(r=>!r.winners.includes(p)))earned.push('unbesiegbar');
  // comebackKid: Von letztem Platz auf Platz 1
  if(rounds.length>=2){
    const totals={};all.forEach(x=>totals[x]=0);
    let wasLast=false;
    rounds.forEach((r,i)=>{
      all.forEach(x=>totals[x]+=(r.scores[x]||0));
      const active=all.filter(x=>rounds.slice(0,i+1).some(rr=>rr.playing.includes(x)));
      if(active.length<2)return;
      const sorted=active.slice().sort((a,b)=>totals[a]-totals[b]);
      if(sorted[0]===p&&totals[p]<totals[sorted[sorted.length-1]])wasLast=true;
    });
    if(wasLast){
      const finalTotals={};all.forEach(x=>finalTotals[x]=0);
      rounds.forEach(r=>all.forEach(x=>finalTotals[x]+=(r.scores[x]||0)));
      const activeFinal=all.filter(x=>rounds.some(r=>r.playing.includes(x)));
      const sortedFinal=activeFinal.slice().sort((a,b)=>finalTotals[b]-finalTotals[a]);
      if(sortedFinal[0]===p)earned.push('comebackKid');
    }
  }
  return earned;
}

// Abend-Achievements autoritativ aus state.rounds neu berechnen und state.achievements
// ueberschreiben. Toast/Konfetti nur fuer NEU hinzugekommene Badges (opts.announce!==false).
// So bleiben die Badges immer am aktuellen Abend ausgerichtet und haengengebliebene Badges
// aus frueheren Abenden (z.B. nach „Neues Spiel") heilen sich von selbst.
export function refreshEveningAchievements(opts){
  opts=opts||{};
  if(!state.achievements)state.achievements={};
  const all=getHistoricalPlayers();
  const rounds=state.rounds;
  const newAchievements=[];
  const fresh={};
  all.forEach(p=>{
    const before=state.achievements[p]||[];
    const earned=computeEveningBadges(p,rounds,all);
    if(earned.length)fresh[p]=earned;
    earned.forEach(id=>{if(!before.includes(id))newAchievements.push({player:p,id})});
  });
  state.achievements=fresh;
  if(opts.announce!==false){
    newAchievements.forEach(a=>{
      const def=ACHIEVEMENTS.evening[a.id];
      showToast(def.emoji+' '+a.player+': '+def.name+'!','info');
      setTimeout(launchMiniConfetti,300);
    });
  }
  save();
}

// Beibehaltener Name fuer den Aufruf nach jeder Runde.
export function checkRoundAchievements(round){ refreshEveningAchievements(); }

export function loadSeasonAchievements(){
  try{const s=localStorage.getItem('doko-v4-achievements');return s?JSON.parse(s):{}}catch(e){return{}}
}
export function saveSeasonAchievements(data){
  try{localStorage.setItem('doko-v4-achievements',JSON.stringify(data))}catch(e){}
}
export function checkSeasonAchievements(){
  const archive=loadArchive();
  if(!archive.length)return;
  const sa=loadSeasonAchievements();
  const playerSet=new Set();
  archive.forEach(g=>{
    g.rounds.forEach(r=>r.playing.forEach(p=>playerSet.add(p)));
    if(g.players)g.players.forEach(p=>playerSet.add(p));
  });
  const allPlayers=[...playerSet];
  const newAchievements=[];
  // Statistiken aggregieren
  const stats={};
  allPlayers.forEach(p=>{stats[p]={abende:0,spiele:0,soloWins:0,platz1:0,maxSpiele:0}});
  const sorted=archive.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
  sorted.forEach(g=>{
    const abendPlayers=new Set();
    g.rounds.forEach(r=>r.playing.forEach(p=>abendPlayers.add(p)));
    if(g.players)g.players.forEach(p=>abendPlayers.add(p));
    const abendTotals={};
    let abendSpiele={};
    abendPlayers.forEach(p=>{abendTotals[p]=0;abendSpiele[p]=0});
    g.rounds.forEach(r=>{
      let solist=null;
      if(r.solo){
        if(r.winners.length===1)solist=r.winners[0];
        else if(r.winners.length===3)solist=r.playing.find(p=>!r.winners.includes(p));
      }
      r.playing.forEach(p=>{
        if(!stats[p])return;
        stats[p].spiele++;
        abendSpiele[p]=(abendSpiele[p]||0)+1;
        abendTotals[p]=(abendTotals[p]||0)+(r.scores[p]||0);
        if(r.winners.includes(p)&&r.solo&&p===solist)stats[p].soloWins++;
      });
    });
    abendPlayers.forEach(p=>{
      if(stats[p]){
        stats[p].abende++;
        if(abendSpiele[p]>stats[p].maxSpiele)stats[p].maxSpiele=abendSpiele[p];
      }
    });
    // Bester Spieler des Abends
    const abendArr=[...abendPlayers];
    if(abendArr.length){
      const maxPts=Math.max(...abendArr.map(p=>abendTotals[p]||0));
      const candidates=abendArr.filter(p=>(abendTotals[p]||0)===maxPts);
      if(candidates.length===1&&stats[candidates[0]])stats[candidates[0]].platz1++;
    }
  });
  // Dauersieger: 5 Abende hintereinander Top 2
  const placingsPerAbend=sorted.map(g=>{
    const ap=new Set();
    g.rounds.forEach(r=>r.playing.forEach(p=>ap.add(p)));
    if(g.players)g.players.forEach(p=>ap.add(p));
    const t={};ap.forEach(p=>{t[p]=0});
    g.rounds.forEach(r=>r.playing.forEach(p=>{t[p]=(t[p]||0)+(r.scores[p]||0)}));
    return [...ap].sort((a,b)=>(t[b]||0)-(t[a]||0));
  });
  allPlayers.forEach(p=>{
    if(!sa[p])sa[p]=[];
    // stammgast
    if(!sa[p].includes('stammgast')&&stats[p].abende>=5){sa[p].push('stammgast');newAchievements.push({player:p,id:'stammgast'})}
    // veteran
    if(!sa[p].includes('veteran')&&stats[p].spiele>=100){sa[p].push('veteran');newAchievements.push({player:p,id:'veteran'})}
    // soloKoenig
    if(!sa[p].includes('soloKoenig')&&stats[p].soloWins>=10){sa[p].push('soloKoenig');newAchievements.push({player:p,id:'soloKoenig'})}
    // dominator
    if(!sa[p].includes('dominator')&&stats[p].platz1>=3){sa[p].push('dominator');newAchievements.push({player:p,id:'dominator'})}
    // marathon
    if(!sa[p].includes('marathon')&&stats[p].maxSpiele>=50){sa[p].push('marathon');newAchievements.push({player:p,id:'marathon'})}
    // dauersieger
    if(!sa[p].includes('dauersieger')){
      let streak=0,maxStreak=0;
      placingsPerAbend.forEach(placing=>{
        const idx=placing.indexOf(p);
        if(idx===0||idx===1){streak++;if(streak>maxStreak)maxStreak=streak}else if(idx===-1){/* nicht dabei, streak bleibt */}else{streak=0}
      });
      if(maxStreak>=5){sa[p].push('dauersieger');newAchievements.push({player:p,id:'dauersieger'})}
    }
  });
  saveSeasonAchievements(sa);
  // Announce
  newAchievements.forEach(a=>{
    const def=ACHIEVEMENTS.season[a.id];
    showToast(def.emoji+' '+a.player+': '+def.name+'!','info');
  });
}

export function finalizeRound(round){
  if(!state.gameStartTime)state.gameStartTime=Date.now();
  round.timestamp=Date.now();
  setLastUndo({round:JSON.parse(JSON.stringify(round)),bockQueueBefore:state.bockQueue,playerStates:round.playing.map(p=>({name:p,won:round.winners.includes(p)}))});
  state.rounds.push(round);
  if(isBockRound()&&state.bockQueue>0)state.bockQueue--;
  const triggerBock=document.getElementById('triggerBockToggle');
  if(triggerBock&&triggerBock.classList.contains('on'))state.bockQueue+=state.bockCount;
  save();syncToFirebase();
  const soloWin=round.solo&&round.winners.length===1;
  if(soloWin)setTimeout(launchConfetti,300);
  else{
    const all=getHistoricalPlayers();
    if(all.length){
      const totals={};all.forEach(p=>totals[p]=0);
      state.rounds.forEach(r=>{all.forEach(p=>{totals[p]+=(r.scores[p]||0)})});
      const prevTotals={};all.forEach(p=>prevTotals[p]=totals[p]-(round.scores[p]||0));
      const prevLeader=all.reduce((a,b)=>prevTotals[a]>=prevTotals[b]?a:b);
      const newLeader=all.reduce((a,b)=>totals[a]>totals[b]?a:b);
      if(state.rounds.length>1&&newLeader!==prevLeader)setTimeout(launchConfetti,300);
    }
  }
  checkRoundAchievements(round);
  showScreen('tabelle');renderTabelle(true);
  schedulePrerenderShareImages();
}


export function openCalcModal(){
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;z-index:5"><h3 style="margin:0">Punkte zählen</h3><div id="calcResultSticky" style="font-family:\'Space Mono\',monospace;font-size:28px;font-weight:700;color:var(--acc)">0</div></div>';
  html+='<div class="section-label">Spielart</div>';
  html+='<div style="display:flex;gap:6px;margin-bottom:12px"><div class="solo-chip selected" data-calc="normal" onclick="setCalcType(\'normal\',this)" style="flex:1;text-align:center">Normalspiel</div><div class="solo-chip" data-calc="solo" onclick="setCalcType(\'solo\',this)" style="flex:1;text-align:center">Solo</div></div>';
  html+='<div class="section-label">Ergebnis</div>';
  html+='<div class="card" style="padding:8px 10px">';
  html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdr)"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="c120" onchange="calcAutoCheck(\'result\')"> Gewonnen (120+)</label></div>';
  ['90','60','30'].forEach(v=>{html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdr)"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="c'+v+'" onchange="calcAutoCheck(\'result\')"> Keine '+v+'</label><label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--tx3);cursor:pointer"><input type="checkbox" id="c'+v+'A" onchange="calcAutoCheck(\'ansage\')"> angesagt</label></div>'});
  html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="cSchwarz" onchange="calcAutoCheck(\'result\')"> Schwarz</label><label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--tx3);cursor:pointer"><input type="checkbox" id="cSchwarzA" onchange="calcAutoCheck(\'ansage\')"> angesagt</label></div>';
  html+='</div>';
  html+='<div class="section-label">Ansagen <span style="font-size:10px;color:var(--tx3)">(verdoppeln die Punkte)</span></div>';
  html+='<div class="card" style="padding:8px 10px">';
  html+='<div style="padding:5px 0;border-bottom:1px solid var(--bdr)"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="cRe" onchange="calcPoints()"> Re angesagt</label></div>';
  html+='<div style="padding:5px 0;border-bottom:1px solid var(--bdr)"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="cKontra" onchange="calcPoints()"> Kontra angesagt</label></div>';
  html+='<div id="calcVorabRow" style="padding:5px 0;border-bottom:1px solid var(--bdr)"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="cVorab" onchange="calcPoints()"> Vorab</label></div>';
  html+='<div id="calcGegenAlte" style="padding:5px 0"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="cGegenAlte" onchange="calcPoints()"> Gegen die Alten</label></div>';
  html+='</div>';
  html+='<div id="calcSonderNormal" class="section-label">Sonderpunkte <span style="font-size:10px;color:var(--tx3)">(werden nicht verdoppelt)</span></div>';
  html+='<div id="calcSonderNormalCard" class="card" style="padding:8px 10px">';
  html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdr)"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="cFuchs" onchange="calcPoints()"> Fuchs gefangen</label><div style="display:flex;align-items:center;gap:4px"><button class="icon-btn" onclick="calcCounter(\'cFuchsN\',-1)">−</button><span id="cFuchsN" style="font-family:\'Space Mono\',monospace;font-size:13px;min-width:16px;text-align:center">1</span><button class="icon-btn" onclick="calcCounter(\'cFuchsN\',1)">+</button></div></div>';
  html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdr)"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="cDoko" onchange="calcPoints()"> Doppelkopf</label><div style="display:flex;align-items:center;gap:4px"><button class="icon-btn" onclick="calcCounter(\'cDokoN\',-1)">−</button><span id="cDokoN" style="font-family:\'Space Mono\',monospace;font-size:13px;min-width:16px;text-align:center">1</span><button class="icon-btn" onclick="calcCounter(\'cDokoN\',1)">+</button></div></div>';
  html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="cCharlie" onchange="calcPoints()"> Charlie</label><div style="display:flex;align-items:center;gap:4px"><button class="icon-btn" onclick="calcCounter(\'cCharlieN\',-1)">−</button><span id="cCharlieN" style="font-family:\'Space Mono\',monospace;font-size:13px;min-width:16px;text-align:center">1</span><button class="icon-btn" onclick="calcCounter(\'cCharlieN\',1)">+</button></div></div>';
  html+='</div>';
  html+='<div id="calcSonderSolo" class="section-label" style="display:none">Sonderpunkte</div>';
  html+='<div id="calcSonderSoloCard" class="card" style="padding:8px 10px;display:none"><div style="padding:5px 0"><label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer"><input type="checkbox" id="cSoloPkt" onchange="calcPoints()" checked> Solopunkt (+1)</label></div></div>';
  html+='<div style="display:flex;gap:8px;margin-top:16px;position:sticky;bottom:0;background:var(--bg2);padding:8px 0 0"><button class="btn btn-secondary" onclick="closeCalcModal()" style="flex:1">Abbrechen</button><button class="btn btn-primary" onclick="applyCalcPoints()" style="flex:1">'+ICO.check+' Übernehmen</button></div>';
  document.getElementById('calcModalContent').innerHTML=html;
  document.getElementById('calcModal').classList.add('show');
  calcPoints();
}
let calcGameType='normal';
const calcCounterMax={cFuchsN:2,cDokoN:9,cCharlieN:2};
export function calcCounter(id,dir){const el=document.getElementById(id);let v=parseInt(el.textContent)||1;v=Math.max(1,Math.min(calcCounterMax[id]||9,v+dir));el.textContent=v;calcPoints()}
export function calcAutoCheck(type){
  const levels=['c120','c90','c60','c30','cSchwarz'];
  const levelsA=['','c90A','c60A','c30A','cSchwarzA'];
  if(type==='result'){
    let foundChecked=false;
    for(let i=levels.length-1;i>=0;i--){if(document.getElementById(levels[i]).checked)foundChecked=true;if(foundChecked)document.getElementById(levels[i]).checked=true}
    let foundUnchecked=false;
    for(let i=0;i<levels.length;i++){if(!document.getElementById(levels[i]).checked)foundUnchecked=true;if(foundUnchecked)document.getElementById(levels[i]).checked=false}
  }
  if(type==='ansage'){
    let foundChecked=false;
    for(let i=levelsA.length-1;i>=1;i--){if(document.getElementById(levelsA[i]).checked)foundChecked=true;if(foundChecked)document.getElementById(levelsA[i]).checked=true}
    let foundUnchecked=false;
    for(let i=1;i<levelsA.length;i++){if(!document.getElementById(levelsA[i]).checked)foundUnchecked=true;if(foundUnchecked)document.getElementById(levelsA[i]).checked=false}
  }
  calcPoints();
}
export function setCalcType(type,el){
  calcGameType=type;
  document.querySelectorAll('#calcModalContent [data-calc]').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  const isSolo=type==='solo';
  document.getElementById('calcVorabRow').style.display=isSolo?'none':'';
  document.getElementById('calcGegenAlte').style.display=isSolo?'none':'';
  document.getElementById('calcSonderNormal').style.display=isSolo?'none':'';
  document.getElementById('calcSonderNormalCard').style.display=isSolo?'none':'';
  document.getElementById('calcSonderSolo').style.display=isSolo?'':'none';
  document.getElementById('calcSonderSoloCard').style.display=isSolo?'':'none';
  if(isSolo){document.getElementById('cVorab').checked=false;document.getElementById('cGegenAlte').checked=false;document.getElementById('cFuchs').checked=false;document.getElementById('cDoko').checked=false;document.getElementById('cCharlie').checked=false;document.getElementById('cSoloPkt').checked=true}
  calcPoints();
}
export function calcPoints(){
  let base=0;
  if(document.getElementById('c120').checked)base+=1;
  ['90','60','30','Schwarz'].forEach(v=>{
    const id=v==='Schwarz'?'cSchwarz':'c'+v;
    if(document.getElementById(id).checked)base+=1;
    if(document.getElementById(id+'A').checked)base+=1;
  });
  let multiplier=1;
  if(document.getElementById('cRe').checked)multiplier*=2;
  if(document.getElementById('cKontra').checked)multiplier*=2;
  if(calcGameType!=='solo'&&document.getElementById('cVorab').checked)base+=1;
  if(calcGameType!=='solo'&&document.getElementById('cGegenAlte').checked)base+=1;
  let total=base*multiplier;
  if(calcGameType!=='solo'){
    if(document.getElementById('cFuchs').checked)total+=parseInt(document.getElementById('cFuchsN').textContent)||1;
    if(document.getElementById('cDoko').checked)total+=parseInt(document.getElementById('cDokoN').textContent)||1;
    if(document.getElementById('cCharlie').checked)total+=parseInt(document.getElementById('cCharlieN').textContent)||1;
  }else{
    if(document.getElementById('cSoloPkt').checked)total+=1;
  }
  document.getElementById('calcResultSticky').textContent=total;
}
export function applyCalcPoints(){setCurrentPts(document.getElementById('calcResultSticky').textContent);updatePtsDisplay();closeCalcModal()}
export function closeCalcModal(){document.getElementById('calcModal').classList.remove('show')}
document.getElementById('calcModal').addEventListener('click',function(e){if(e.target===this)closeCalcModal()});

export function openCalcHelpModal(){
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)"><h3 style="margin:0">🧮 Punkte zählen</h3><button onclick="closeCalcHelpModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  html+='<div class="section-label">Normalspiel</div>';
  html+='<div class="card" style="font-size:12px;color:var(--tx2);line-height:1.6">';
  html+='<div style="font-weight:700;margin-bottom:8px;color:var(--tx)">Grundwerte</div>';
  html+='<div style="margin-bottom:4px">&#9679; Gewonnen (120+ Augen): <strong>1 Punkt</strong></div>';
  html+='<div style="margin-bottom:12px">&#9679; Gegen die Alten (Re verliert): <strong>+1</strong> (wird mit verdoppelt)</div>';
  html+='<div style="font-weight:700;margin-bottom:8px;color:var(--tx)">Ansagen</div>';
  html+='<div style="margin-bottom:4px">&#9679; Re/Kontra <strong>angesagt</strong>: Punkte werden <strong>verdoppelt</strong></div>';
  html+='<div style="margin-bottom:4px">&#9679; Re/Kontra <strong>vorab</strong> angesagt (vor der 1. Karte): <strong>+1</strong> (wird mit verdoppelt)</div>';
  html+='<div style="margin-bottom:4px">&#9679; Keine 90 angesagt: <strong>+1</strong></div>';
  html+='<div style="margin-bottom:4px">&#9679; Keine 60 angesagt: <strong>+1</strong></div>';
  html+='<div style="margin-bottom:4px">&#9679; Keine 30 angesagt: <strong>+1</strong></div>';
  html+='<div style="margin-bottom:12px">&#9679; Schwarz angesagt: <strong>+1</strong></div>';
  html+='<div style="font-weight:700;margin-bottom:8px;color:var(--tx)">Sonderpunkte</div>';
  html+='<div style="margin-bottom:4px">&#9679; Keine 90/60/30/schwarz gespielt: jeweils <strong>+1</strong></div>';
  html+='<div style="margin-bottom:4px">&#9679; Fuchs gefangen (Karo Ass): <strong>+1</strong></div>';
  html+='<div style="margin-bottom:4px">&#9679; Doppelkopf (Stich mit 40+ Augen): <strong>+1</strong></div>';
  html+='<div style="margin-bottom:4px">&#9679; Charlie (Kreuz Bube letzter Stich): <strong>+1</strong></div>';
  html+='<div style="font-weight:700;margin-top:12px;margin-bottom:8px;color:var(--tx)">Verteilung</div>';
  html+='<div style="margin-bottom:4px">&#9679; Gewinner: <strong>+Punkte</strong>, Verlierer: <strong>−Punkte</strong></div>';
  html+='</div>';
  html+='<div class="section-label" style="margin-top:16px">Solo</div>';
  html+='<div class="card" style="font-size:12px;color:var(--tx2);line-height:1.6">';
  html+='<div style="font-weight:700;margin-bottom:8px;color:var(--tx)">Grundwerte</div>';
  html+='<div style="margin-bottom:4px">&#9679; Gewonnen (120+ Augen): <strong>1 Punkt</strong></div>';
  html+='<div style="margin-bottom:12px">&#9679; Solopunkt: <strong>+1</strong></div>';
  html+='<div style="font-weight:700;margin-bottom:8px;color:var(--tx)">Ansagen</div>';
  html+='<div style="margin-bottom:4px">&#9679; Re/Kontra <strong>angesagt</strong>: Punkte werden <strong>verdoppelt</strong></div>';
  html+='<div style="margin-bottom:4px">&#9679; <strong>Kein Vorab</strong> beim Solo</div>';
  html+='<div style="margin-bottom:4px">&#9679; Keine 90/60/30/schwarz angesagt: jeweils <strong>+1</strong></div>';
  html+='<div style="margin-bottom:12px">&#9679; Keine 90/60/30/schwarz gespielt: jeweils <strong>+1</strong></div>';
  html+='<div style="font-weight:700;margin-bottom:8px;color:var(--tx)">Sonderpunkte</div>';
  html+='<div style="margin-bottom:4px">&#9679; Solopunkt: <strong>+1</strong> (wird nicht verdoppelt)</div>';
  html+='<div style="margin-bottom:4px;font-size:11px;color:var(--tx3)">Fuchs, Doppelkopf und Charlie gibt es beim Solo nicht.</div>';
  html+='<div style="font-weight:700;margin-top:12px;margin-bottom:8px;color:var(--tx)">Verteilung</div>';
  html+='<div style="margin-bottom:4px">&#9679; Solist bekommt die <strong>dreifachen</strong> Punkte</div>';
  html+='<div style="margin-bottom:4px">&#9679; Die 3 Gegner bekommen die <strong>einfachen</strong> Punkte</div>';
  html+='<div style="margin-bottom:4px">&#9679; Solo gewonnen: Solist <strong>+3×</strong>, Gegner je <strong>−1×</strong></div>';
  html+='<div style="margin-bottom:4px">&#9679; Solo verloren: Solist <strong>−3×</strong>, Gegner je <strong>+1×</strong></div>';
  html+='</div>';
  html+='<div style="margin-top:8px;font-size:11px;color:var(--tx3);padding:0 4px">Hinweis: Die Punktewerte können je nach Hausregeln abweichen. Diese App berechnet keine Punkte automatisch – alle Werte werden manuell eingetragen.</div>';
  html+='<button class="btn btn-secondary" style="margin-top:16px;position:sticky;bottom:0" onclick="closeCalcHelpModal()">Schließen</button>';
  document.getElementById('calcHelpModalContent').innerHTML=html;
  document.getElementById('calcHelpModal').classList.add('show');
}
export function closeCalcHelpModal(){document.getElementById('calcHelpModal').classList.remove('show')}
document.getElementById('calcHelpModal').addEventListener('click',function(e){if(e.target===this)closeCalcHelpModal()});

// ── Kebab-Menü ──
export function toggleKebab(){
  const menu=document.getElementById('kebabMenu');
  if(!menu)return;
  const show=menu.style.display==='none';
  menu.style.display=show?'block':'none';
  if(show){
    setTimeout(()=>document.addEventListener('click',_closeKebabOutside,{once:true}),0);
  }
}
export function closeKebab(){
  const menu=document.getElementById('kebabMenu');
  if(menu)menu.style.display='none';
}
function _closeKebabOutside(e){
  const menu=document.getElementById('kebabMenu');
  if(menu&&!menu.contains(e.target)&&!e.target.closest('.kebab-btn')){
    menu.style.display='none';
  }
}

// ── Spieler bearbeiten (Modal) ──
export function openPlayerManageModal(){
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)"><h3 style="margin:0">Spieler bearbeiten</h3><button onclick="closePlayerManageModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen">'+ICO.x+'</button></div>';
  html+='<div style="font-size:12px;color:var(--tx3);margin-bottom:12px;line-height:1.5">Reihenfolge bestimmt den Geber. Erster Spieler gibt zuerst.</div>';
  html+='<div id="playerManageList"></div>';
  html+='<div class="input-wrap" style="margin-top:8px"><input type="text" id="addPlayerInput" placeholder="Spieler hinzufügen..." autocomplete="off"><div class="suggestions" id="suggestions"></div></div>';
  html+='<button class="btn btn-secondary" style="margin-top:8px" onclick="addPlayer()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M12 5v14M5 12h14"/></svg> Hinzufügen</button>';
  html+='<button class="btn btn-secondary" style="margin-top:16px;position:sticky;bottom:0" onclick="closePlayerManageModal()">Schließen</button>';
  document.getElementById('settingsModalContent').innerHTML=html;
  document.getElementById('settingsModal').classList.add('show');
  renderPlayerTags();
  initAddPlayerInput();
}
export function closePlayerManageModal(){
  document.getElementById('settingsModal').classList.remove('show');
  invalidateEingabeCache();
  renderEingabe();
}

// ── Spiel beenden ──
export async function endGame(){
  if(state.rounds.length===0){
    showToast('Es sind noch keine Spiele eingetragen.','info');
    return;
  }
  if(!await showConfirm('Aktuelles Spiel archivieren und beenden?','Beenden',true))return;
  archiveCurrentGame();
  checkSeasonAchievements();
  state.rounds=[];
  state.achievements={}; // Abend-Achievements gehoeren zum beendeten Abend
  state.bockQueue=0;
  state.gameStartTime=null;
  state.kursleiterCupSeen=false;
  state.dokoRundeSeen=false;
  setLastUndo(null);
  setPendingRound(null);
  setCurrentPts('');
  if(timerInterval){clearInterval(timerInterval);setTimerInterval(null)}
  invalidateEingabeCache();
  save();
  renderEingabe();
}

// ── Inline Spieler hinzufügen (via Prompt) ──
export async function openAddPlayerInline(){
  const name=await showPrompt('Spieler hinzufügen','Name eingeben...');
  if(!name||!name.trim())return;
  const trimmed=name.trim();
  if(state.players.includes(trimmed)){showToast('Spieler existiert bereits.','error');return}
  state.players.push(trimmed);
  if(!state.knownNames.includes(trimmed))state.knownNames.push(trimmed);
  save();
  invalidateEingabeCache();
  renderEingabe();
  showToast(trimmed+' hinzugefügt','success');
}
