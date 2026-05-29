import html2canvas from 'html2canvas';
import { state, save, getAllPlayers, getHistoricalPlayers, getPlayerEmoji, getShortNames, invalidateEingabeCache, isDokoRundeMode, isKursleiterMode, currentPts, viewingArchive, prerenderedTabelle, prerenderedStats, setCurrentPts, setPrerenderedTabelle, setPrerenderedStats } from './main.js';
import { showToast, showConfirm, ICO, launchConfetti } from './ui.js';

let editingRound=null;
let prerenderTimer=null;

export function openEditModal(i){
  editingRound=i;const r=state.rounds[i];setCurrentPts(''+r.points);
  // Alle historischen Spieler anzeigen – damit auch gelöschte Spieler aus der Runde bearbeitbar sind
  const all=getHistoricalPlayers();
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)"><h3 style="margin:0">Spiel '+(i+1)+' bearbeiten</h3><button onclick="closeEditModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
  html+='<div class="pts-display" id="editPtsDisplay">'+r.points+'</div>';
  html+='<div style="display:flex;justify-content:center;gap:6px;margin-bottom:8px;align-items:center">';
  html+='<button class="share-btn" onclick="editNumpadToggleSign()" style="font-size:11px;padding:5px 12px;opacity:.7;color:var(--warn)">\u00b1 Vorzeichen</button>';
  html+='</div>';
  html+='<div class="numpad">';
  for(let n=1;n<=9;n++){html+='<div class="numpad-btn" onclick="editNumpadPress('+n+')">'+n+'</div>'}
  html+='<div class="numpad-btn del" onclick="editNumpadClear()">'+ICO.trash+'</div>';
  html+='<div class="numpad-btn" onclick="editNumpadPress(0)">0</div>';
  html+='<div class="numpad-btn del" onclick="editNumpadDelete()">'+ICO.backspace+'</div>';
  html+='</div>';
  html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><div class="section-label" style="margin:0">Spieler antippen</div><div class="chip-legend" style="margin:0;margin-left:auto"><span><span class="dot" style="background:var(--bg4)"></span> Nicht dabei</span><span><span class="dot" style="background:var(--red)"></span> Verloren</span><span><span class="dot" style="background:var(--grn)"></span> Gewonnen</span></div></div>';
  html+='<div class="chip-grid" id="editChips">';
  all.forEach(p=>{
    let st='neutral';if(r.winners.includes(p))st='won';else if(r.playing.includes(p))st='lost';
    const ic=st==='won'?ICO.check:st==='lost'?ICO.x:'';
    html+='<div class="player-chip" data-player="'+p+'" data-state="'+st+'" onclick="cycleState(this)"><span class="chip-icon">'+ic+'</span>'+p+'</div>';
  });
  html+='</div>';
  html+='<div style="display:flex;gap:6px;margin-top:8px;position:sticky;bottom:0;background:var(--bg2);padding:8px 0 0"><button class="btn btn-secondary" onclick="closeEditModal()" style="flex:1;padding:10px 10px;font-size:13px">Abbrechen</button><button class="btn btn-primary" onclick="saveEditRound()" style="flex:1;padding:10px 10px;font-size:13px">'+ICO.check+' Speichern</button></div>';
  document.getElementById('editModalContent').innerHTML=html;
  document.getElementById('editModal').classList.add('show');
}
export function closeEditModal(){document.getElementById('editModal').classList.remove('show')}
export function editNumpadPress(n){
  const digits=currentPts.replace('-','');
  if(digits.length>=3)return;
  setCurrentPts(currentPts+n);
  updateEditPtsDisplay();
}
export function editNumpadDelete(){setCurrentPts(currentPts.slice(0,-1));updateEditPtsDisplay()}
export function editNumpadClear(){setCurrentPts('');updateEditPtsDisplay()}
export function editNumpadToggleSign(){
  if(!currentPts)return;
  if(currentPts.startsWith('-')){setCurrentPts(currentPts.slice(1))}
  else{setCurrentPts('-'+currentPts)}
  updateEditPtsDisplay();
}
export function updateEditPtsDisplay(){
  const el=document.getElementById('editPtsDisplay');if(!el)return;
  if(currentPts){
    el.textContent=currentPts;
    el.classList.remove('empty');
    el.style.color=currentPts.startsWith('-')?'var(--red)':'';
  }else{
    el.textContent='Punkte eingeben';
    el.classList.add('empty');
    el.style.color='';
  }
}
export function saveEditRound(){
  const pts=parseInt(currentPts||'0');
  if(isNaN(pts)){showToast('Bitte Punkte eingeben.','error');return}
  if(!currentPts||currentPts==='-'){showToast('Bitte Punkte eingeben.','error');return}
  const chips=document.querySelectorAll('#editChips .player-chip');
  const playing=[];const winners=[];const losers=[];
  chips.forEach(c=>{const p=c.dataset.player;const s=c.dataset.state;if(s==='lost'){playing.push(p);losers.push(p)}else if(s==='won'){playing.push(p);winners.push(p)}});
  if(playing.length!==4){showToast('Es müssen genau 4 Spieler mitspielen. Aktuell: '+playing.length,'error');return}
  if(!winners.length){showToast('Mindestens einen Gewinner auswählen.','error');return}
  if(!losers.length){showToast('Mindestens einen Verlierer auswählen.','error');return}
  const solo=(winners.length===1)||(winners.length===3);
  const oldBock=state.rounds[editingRound].bock;
  const bockApplies=oldBock&&(!solo||state.bockSolo);
  const mult=bockApplies?2:1;
  const scores={};
  if(solo){
    const solist=winners.length===1?winners[0]:losers[0];
    const solistWon=winners.includes(solist);
    playing.forEach(p=>{if(p===solist){scores[p]=solistWon?pts*3*mult:-pts*3*mult}else{scores[p]=solistWon?-pts*mult:pts*mult}});
  }else{
    playing.forEach(p=>{scores[p]=winners.includes(p)?pts*mult:-pts*mult});
  }
  const oldSoloType=state.rounds[editingRound].soloType;
  state.rounds[editingRound]={points:pts,playing,winners,solo,bock:bockApplies,scores,soloType:solo?oldSoloType:null};
  save();syncToFirebase();invalidateEingabeCache();closeEditModal();renderTabelle(false);
  schedulePrerenderShareImages();
}
export async function deleteRound(i){
  if(!await showConfirm('Spiel '+(i+1)+' löschen?','Löschen',true))return;
  const deletedRound=state.rounds[i];
  if(deletedRound.bock){state.bockQueue++}
  state.rounds.splice(i,1);
  save();syncToFirebase();invalidateEingabeCache();renderTabelle(false);
  schedulePrerenderShareImages();
}
export function moveRound(i,dir){
  const j=i+dir;if(j<0||j>=state.rounds.length)return;
  const tmp=state.rounds[i];state.rounds[i]=state.rounds[j];state.rounds[j]=tmp;
  save();invalidateEingabeCache();renderTabelle(false);
  schedulePrerenderShareImages();
}
document.getElementById('editModal').addEventListener('click',function(e){if(e.target===this)closeEditModal()});

export function toggleRowMenu(e,i){
  e.stopPropagation();
  const menu=document.getElementById('rowMenu'+i);
  const wasOpen=menu.classList.contains('show');
  closeAllMenus();
  if(!wasOpen){const btn=e.currentTarget;const rect=btn.getBoundingClientRect();menu.style.top=rect.bottom+'px';menu.style.right=(window.innerWidth-rect.right)+'px';menu.classList.add('show')}
}
export function closeAllMenus(){document.querySelectorAll('.row-menu.show').forEach(m=>m.classList.remove('show'))}
document.addEventListener('click',closeAllMenus);

export function renderTabelle(scrollToBottom){
  const src=viewingArchive||state;
  const all=viewingArchive?[...viewingArchive.players]:getHistoricalPlayers();
  const activePlayers=viewingArchive?[...viewingArchive.players]:getAllPlayers();
  const rounds=src.rounds;
  // Archive banner
  const tabelleScreen=document.getElementById('screen-tabelle');
  let banner=tabelleScreen.querySelector('.archive-banner');
  if(viewingArchive){
    if(!banner){banner=document.createElement('div');banner.className='archive-banner';tabelleScreen.insertBefore(banner,tabelleScreen.firstChild)}
    const dateStr=formatArchiveDate(viewingArchive,false);
    banner.innerHTML='<span>Archiv: '+dateStr+' \u2013 '+viewingArchive.players.length+' Spieler \u00b7 '+viewingArchive.rounds.length+' Runden</span><button onclick="closeArchiveView()">'+ICO.x+'</button>';
  }else if(banner){banner.remove()}
  // Share button visibility
  const shareBtn=tabelleScreen.querySelector('.share-btn');
  if(shareBtn)shareBtn.style.display='';
  if(!rounds.length){document.getElementById('standsCard').innerHTML='';document.getElementById('tableWrap').innerHTML='<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>Noch keine Daten.</div>';return}
  if(!all.length){document.getElementById('standsCard').innerHTML='';document.getElementById('tableWrap').innerHTML='<div class="empty-state">Alle Spieler wurden entfernt.</div>';return}
  const tStreaks=getWinStreaks(all);
  const tLooseStreaks=getLooseStreaks(all);
  // Easter Egg Banner in standsCard (nur bei aktivem Spiel)
  let shtml='';
  if(!viewingArchive){
    if(isKursleiterMode()){
      shtml+='<div style="background:linear-gradient(135deg,#5b4cdb,#2980b9);color:#fff;padding:10px 14px;border-radius:var(--r-sm);font-size:13px;font-weight:600;text-align:center;margin-bottom:8px;box-shadow:0 2px 8px rgba(91,76,219,.3)">🎓 Kursleiter-Cup 📚 · ✏️ · 🍎</div>';
    }
    if(isDokoRundeMode()){
      shtml+='<div style="background:linear-gradient(135deg,#e74c3c,#f0a830);color:#fff;padding:10px 14px;border-radius:var(--r-sm);font-size:13px;font-weight:600;text-align:center;margin-bottom:8px;box-shadow:0 2px 8px rgba(231,76,60,.3)">🃏 Doko-Stammrunde 🍀 Schön, dass ihr da seid!</div>';
    }
    if(isKursleiterMode()&&!state.kursleiterCupSeen){
      state.kursleiterCupSeen=true;save();setTimeout(launchConfetti,400);
    }
    if(isDokoRundeMode()&&!state.dokoRundeSeen){
      state.dokoRundeSeen=true;save();setTimeout(launchConfetti,400);
    }
  }
  document.getElementById('standsCard').innerHTML=shtml;
  const soloMap={};(src.soloTypes||state.soloTypes).forEach(s=>{soloMap[s.name]=s.short});
  const cumul={};all.forEach(p=>cumul[p]=[]);
  let run={};all.forEach(p=>run[p]=0);
  rounds.forEach(r=>{all.forEach(p=>{run[p]+=(r.scores[p]||0);cumul[p].push(run[p])})});
  let html='<table><thead><tr><th>#</th>';
  const shortNames=getShortNames(all);
  all.forEach(p=>{
    const emoji=getPlayerEmoji(p);
    const icon=getStreakIcon(p,tStreaks,tLooseStreaks);
    html+='<th title="'+p+'">'+(emoji?emoji+'<br>':'')+shortNames[p]+(icon?'<br><span style="font-size:10px">'+icon+'</span>':'')+'</th>';
  });
  html+='<th>Pkt</th><th></th></tr></thead><tbody>';
  rounds.forEach((r,i)=>{
    html+='<tr class="clickable" onclick="toggleExpand('+i+')">';
    html+='<td style="color:var(--tx3)">'+(i+1);
    if(r.bock)html+=' <span class="round-badge badge-bock">B</span>';
    html+='</td>';
    all.forEach(p=>{
      const c=cumul[p][i];
      const played=r.playing.includes(p);const won=r.winners.includes(p);const lost=played&&!won;
      const bg=won?'background:var(--grn-bg)':lost?'background:var(--red-bg)':'';
      html+='<td style="'+bg+'">'+(played?(c>0?'+':'')+c:'')+'</td>';
    });
    // Punkte des Spiels + Solo-Badge rechts
    let ptsLabel=''+r.points;
    if(r.solo){ptsLabel=r.points+'/'+r.points*3;const soloLabel=r.soloType?(soloMap[r.soloType]||r.soloType.substring(0,2)):'S';ptsLabel+=' <span class="round-badge badge-solo" title="'+(r.soloType||'Solo')+'">'+soloLabel+'</span>'}
    html+='<td style="color:var(--tx3);font-family:\'Space Mono\',monospace;white-space:nowrap">'+ptsLabel+'</td>';
    if(viewingArchive){
      html+='<td></td>';
    }else{
      html+='<td style="white-space:nowrap;position:relative"><div class="row-menu-wrap"><button class="row-menu-btn" onclick="event.stopPropagation();toggleRowMenu(event,'+i+')">&#8942;</button>';
      html+='<div class="row-menu" id="rowMenu'+i+'">';
      if(i>0)html+='<button class="row-menu-item" onclick="event.stopPropagation();closeAllMenus();moveRound('+i+',-1)">'+ICO.up+' Nach oben</button>';
      if(i<rounds.length-1)html+='<button class="row-menu-item" onclick="event.stopPropagation();closeAllMenus();moveRound('+i+',1)">'+ICO.down+' Nach unten</button>';
      html+='<button class="row-menu-item" onclick="event.stopPropagation();closeAllMenus();setTimeout(()=>openEditModal('+i+'),10)">'+ICO.edit+' Bearbeiten</button>';
      html+='<button class="row-menu-item danger" onclick="event.stopPropagation();closeAllMenus();setTimeout(()=>deleteRound('+i+'),10)">'+ICO.trash+' L\u00f6schen</button>';
      html+='</div></div></td>';
    }
    html+='</tr>';
    // Geber-Rotation läuft über die aktiven Spieler – nicht über historische
    const dealerForRound=activePlayers.length>0?activePlayers[i%activePlayers.length]:null;
    const rundeForRound=activePlayers.length>0?Math.floor(i/activePlayers.length)+1:0;
    const spielInRundeFor=activePlayers.length>0?(i%activePlayers.length)+1:0;
    html+='<tr class="expand-row" id="expandRow'+i+'"><td colspan="'+(all.length+3)+'"><div class="expand-detail">';
    if(rundeForRound)html+='<span style="font-size:10px;color:var(--tx3)">R'+rundeForRound+'/S'+spielInRundeFor+'</span> ';
    if(dealerForRound)html+='<span class="dealer-badge">&#9827; '+dealerForRound+' gibt</span> ';
    if(r.timestamp&&i>0&&rounds[i-1].timestamp){const dur=r.timestamp-rounds[i-1].timestamp;html+='<span style="font-size:10px;color:var(--tx3)">⏱ '+formatDuration(dur)+'</span> '}
    else if(r.timestamp&&i===0&&src.gameStartTime){const dur=r.timestamp-src.gameStartTime;html+='<span style="font-size:10px;color:var(--tx3)">⏱ '+formatDuration(dur)+'</span> '}
    all.forEach(p=>{const s=r.scores[p];if(r.playing.includes(p)){const cls=s>0?'pos':s<0?'neg':'';html+='<span class="expand-score '+cls+'">'+p+': '+(s>0?'+':'')+s+'</span>'}});
    html+='</div></td></tr>';
  });
  html+='</tbody></table>';
  const tw=document.getElementById('tableWrap');
  tw.innerHTML=html;
  requestAnimationFrame(()=>{
    const card=tw.closest('.card');
    if(card){const cardTop=card.getBoundingClientRect().top;tw.style.maxHeight=(window.innerHeight-cardTop-16-70-12)+'px'}
    if(scrollToBottom)tw.scrollTop=tw.scrollHeight;
  });
}
export function toggleExpand(i){const row=document.getElementById('expandRow'+i);if(row)row.classList.toggle('show')}

export async function captureToBlob(element){
  const canvas=await html2canvas(element,{backgroundColor:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),scale:2,useCORS:true});
  return new Promise(resolve=>{canvas.toBlob(blob=>resolve(blob),'image/png')});
}
export async function shareBlob(blob,filename){
  try{
    const file=new File([blob],filename,{type:'image/png'});
    if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:'Doppelkopf Ergebnis'})}
    else{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url)}
  }catch(e){console.error('Share failed:',e)}
}
export async function captureAndShare(element,filename){
  try{const blob=await captureToBlob(element);await shareBlob(blob,filename)}catch(e){console.error('Share failed:',e)}
}
export function schedulePrerenderShareImages(){
  if(prerenderTimer)clearTimeout(prerenderTimer);
  prerenderTimer=setTimeout(prerenderShareImages,500);
}
export async function prerenderShareImages(){
  prerenderTimer=null;
  try{
    const tableEl=buildShareTableElement();
    if(tableEl){document.body.appendChild(tableEl);setPrerenderedTabelle(await captureToBlob(tableEl));tableEl.remove()}
    const statsEl=document.getElementById('shareableStats');
    if(statsEl&&statsEl.innerHTML)setPrerenderedStats(await captureToBlob(statsEl));
  }catch(e){console.error('Prerender failed:',e)}
}
export function shareStats(){
  if(prerenderedStats){shareBlob(prerenderedStats,'doppelkopf-statistik.png');return}
  const el=document.getElementById('shareableStats');if(el)captureAndShare(el,'doppelkopf-statistik.png');
}
export function buildShareTableElement(){
  const table=document.querySelector('#tableWrap table');
  if(!table)return null;
  const maxRows=8;
  const clone=table.cloneNode(true);
  const all=viewingArchive?[...viewingArchive.players]:getHistoricalPlayers();
  const headerThs=clone.querySelectorAll('thead th');
  all.forEach((p,i)=>{
    const th=headerThs[i+1];
    if(th)th.innerHTML=p;
  });
  clone.querySelectorAll('.expand-row').forEach(r=>r.remove());
  const rows=clone.querySelectorAll('tbody tr');
  const total=rows.length;
  if(total>maxRows){
    for(let i=0;i<total-maxRows;i++)rows[i].remove();
    const sep=document.createElement('tr');
    const td=document.createElement('td');
    td.colSpan=clone.querySelector('thead tr').children.length;
    td.style.cssText='text-align:center;color:var(--tx3);font-size:11px;padding:4px';
    td.textContent='··· '+(total-maxRows)+' weitere Spiele ···';
    sep.appendChild(td);
    clone.querySelector('tbody').insertBefore(sep,clone.querySelector('tbody tr'));
  }
  clone.querySelectorAll('tr').forEach(r=>{const last=r.lastElementChild;if(last&&(last.querySelector('.row-menu-wrap')||last.textContent.trim()===''))last.remove()});
  const ths=clone.querySelectorAll('thead th');
  if(ths.length&&ths[ths.length-1].textContent.trim()==='')ths[ths.length-1].remove();
  const wrap=document.createElement('div');
  wrap.style.cssText='position:fixed;left:-9999px;top:0;background:var(--bg2);padding:16px;border-radius:8px;font-family:inherit';
  wrap.appendChild(clone);
  return wrap;
}
export function shareTabelle(){
  if(prerenderedTabelle){shareBlob(prerenderedTabelle,'doppelkopf-tabelle.png');return}
  const wrap=buildShareTableElement();
  if(!wrap)return;
  document.body.appendChild(wrap);
  captureAndShare(wrap,'doppelkopf-tabelle.png').then(()=>wrap.remove()).catch(()=>wrap.remove());
}

