import Chart from 'chart.js/auto';
import { state, COLORS, getChartColors, showScreen, setViewingArchive, setPrerenderedTabelle, setPrerenderedStats } from './main.js';
import { showConfirm, ICO } from './ui.js';

export function loadArchive(){
  try{const s=localStorage.getItem('doko-v4-archive');return s?JSON.parse(s):[]}catch(e){return[]}
}
export function saveArchive(archive){
  try{localStorage.setItem('doko-v4-archive',JSON.stringify(archive))}catch(e){}
}
export function archiveCurrentGame(){
  if(!state.rounds.length)return;
  const snapshot={
    id:Date.now(),
    date:state.gameStartTime||new Date().toISOString(),
    myPlayer:state.myPlayer,
    players:[...state.players],
    rounds:JSON.parse(JSON.stringify(state.rounds)),
    bockEnabled:state.bockEnabled,
    bockCount:state.bockCount,
    bockSolo:state.bockSolo,
    bockQueue:state.bockQueue,
    soloTypesEnabled:state.soloTypesEnabled,
    soloTypes:JSON.parse(JSON.stringify(state.soloTypes)),
    gameStartTime:state.gameStartTime
  };
  const archive=loadArchive();
  archive.unshift(snapshot);
  while(archive.length>state.archiveMax)archive.pop();
  saveArchive(archive);
}
export function deleteArchivedGame(id){
  const archive=loadArchive().filter(g=>g.id!==id);
  saveArchive(archive);
}
export function getArchiveWinner(game){
  if(!game.rounds.length)return '\u2013';
  const totals={};
  game.players.forEach(p=>totals[p]=0);
  game.rounds.forEach(r=>game.players.forEach(p=>{totals[p]+=(r.scores[p]||0)}));
  const max=Math.max(...Object.values(totals));
  const winners=game.players.filter(p=>totals[p]===max);
  return winners.length===1?winners[0]:'\u2013';
}


export function formatArchiveDate(g,short){
  const d=new Date(g.date);
  const dateStr=d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:short?undefined:'numeric'});
  if(!g.gameStartTime)return dateStr;
  const start=new Date(g.gameStartTime);
  const startTime=start.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  let endTime='';
  if(g.rounds&&g.rounds.length){
    const lastTs=g.rounds[g.rounds.length-1].timestamp;
    if(lastTs){const end=new Date(lastTs);endTime='–'+end.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}
  }
  return dateStr+' '+startTime+endTime;
}
export function renderArchiveList(){
  const archive=loadArchive();
  const el=document.getElementById('archiveList');
  if(!archive.length){el.innerHTML='';return}
  let html='<div class="section-label" style="margin-top:20px">Vergangene Spiele ('+archive.length+')</div>';
  archive.forEach(g=>{
    const dateStr=formatArchiveDate(g,false);
    const winner=getArchiveWinner(g);
    html+='<div class="archive-item" onclick="openArchivedGame('+g.id+')">';
    html+='<div class="archive-item-info">';
    html+='<div class="archive-item-title">'+dateStr+'</div>';
    html+='<div class="archive-item-meta">'+g.players.length+' Spieler \u00b7 '+g.rounds.length+' Runden'+(winner!=='\u2013'?' \u00b7 Sieger: '+winner:'')+'</div>';
    html+='</div>';
    html+='<button class="archive-item-delete" onclick="event.stopPropagation();deleteArchived('+g.id+')">'+ICO.trash+'</button>';
    html+='</div>';
  });
  if(archive.length>=2)html+='<button class="btn btn-secondary" style="margin-top:12px;width:100%" onclick="openAllTimeModal()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg> Ewige Tabelle</button>';
  el.innerHTML=html;
}

export async function deleteArchived(id){
  if(!await showConfirm('Archiviertes Spiel wirklich löschen?','Löschen',true))return;
  deleteArchivedGame(id);
  renderArchiveList();
}
export function openArchivedGame(id){
  const archive=loadArchive();
  const game=archive.find(g=>g.id===id);
  if(!game)return;
  setViewingArchive(game);
  setPrerenderedTabelle(null);setPrerenderedStats(null);
  showScreen('tabelle');
  schedulePrerenderShareImages();
}
export function closeArchiveView(){
  setViewingArchive(null);
  setPrerenderedTabelle(null);setPrerenderedStats(null);
  showScreen('tabelle');
  schedulePrerenderShareImages();
}
export function closeAllTimeModal(){document.getElementById('allTimeModal').classList.remove('show')}
document.getElementById('allTimeModal').addEventListener('click',function(e){if(e.target===this)closeAllTimeModal()});

let allTimeChartInstance=null;
export function openAllTimeModal(){
  if(allTimeChartInstance){allTimeChartInstance.destroy();allTimeChartInstance=null}
  const archive=loadArchive();
  if(archive.length<2)return;
  // Alle Spieler sammeln
  const playerSet=new Set();
  archive.forEach(g=>{
    g.rounds.forEach(r=>r.playing.forEach(p=>playerSet.add(p)));
    if(g.players)g.players.forEach(p=>playerSet.add(p));
  });
  const allPlayers=[...playerSet];
  // Statistiken aggregieren
  const stats={};
  allPlayers.forEach(p=>{stats[p]={abende:0,spiele:0,punkte:0,siege:0,soloWins:0,soloTotal:0,platz1:0}});
  // Archiv chronologisch sortieren
  const sorted=archive.slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
  sorted.forEach(g=>{
    const abendPlayers=new Set();
    g.rounds.forEach(r=>r.playing.forEach(p=>abendPlayers.add(p)));
    if(g.players)g.players.forEach(p=>abendPlayers.add(p));
    const abendTotals={};
    abendPlayers.forEach(p=>{abendTotals[p]=0});
    g.rounds.forEach(r=>{
      let solist=null;
      if(r.solo){
        if(r.winners.length===1)solist=r.winners[0];
        else if(r.winners.length===3)solist=r.playing.find(p=>!r.winners.includes(p));
      }
      r.playing.forEach(p=>{
        if(!stats[p])return;
        stats[p].spiele++;
        const s=r.scores[p]||0;
        stats[p].punkte+=s;
        abendTotals[p]=(abendTotals[p]||0)+s;
        if(r.winners.includes(p)){
          stats[p].siege++;
          if(r.solo&&p===solist)stats[p].soloWins++;
        }
        if(r.solo&&p===solist)stats[p].soloTotal++;
      });
    });
    abendPlayers.forEach(p=>{if(stats[p])stats[p].abende++});
    // Bester Spieler des Abends
    const abendArr=[...abendPlayers];
    if(abendArr.length){
      const maxPts=Math.max(...abendArr.map(p=>abendTotals[p]||0));
      const candidates=abendArr.filter(p=>(abendTotals[p]||0)===maxPts);
      if(candidates.length===1&&stats[candidates[0]])stats[candidates[0]].platz1++;
    }
  });
  // Sortieren nach Gesamt-Punkten
  const ranked=allPlayers.slice().sort((a,b)=>stats[b].punkte-stats[a].punkte);
  // HTML bauen
  let html='<div style="display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);padding:0 0 12px;margin:0 0 4px;z-index:5;border-bottom:1px solid var(--bdr)"><h3 style="margin:0">🏆 Ewige Tabelle</h3><button onclick="closeAllTimeModal()" style="background:var(--bg3);border:1px solid var(--bdr);color:var(--tx2);cursor:pointer;width:32px;height:32px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;padding:0" aria-label="Schließen">'+ICO.x+'</button></div>';
  html+='<div style="font-size:11px;color:var(--tx3);margin-bottom:12px">'+sorted.length+' Spielabende · '+allPlayers.length+' Spieler</div>';
  // Ewige Tabelle
  html+='<div class="section-label">Rangliste</div><div class="card">';
  ranked.forEach((p,i)=>{
    const s=stats[p];
    const winRate=s.spiele?Math.round(s.siege/s.spiele*100):0;
    const avg=s.abende?Math.round(s.punkte/s.abende*10)/10:0;
    const rc=i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'';
    html+='<div style="padding:10px 0;'+(i<ranked.length-1?'border-bottom:1px solid var(--bdr)':'')+'">';
    html+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:500"><span class="rank '+rc+'" style="display:inline-flex;width:20px;height:20px;font-size:11px;margin-right:6px">'+(i+1)+'</span>'+p+'</span><span class="'+(s.punkte>=0?'pos':'neg')+'" style="font-family:\'Space Mono\',monospace;font-weight:700">'+(s.punkte>0?'+':'')+s.punkte+'</span></div>';
    html+='<div style="display:flex;flex-wrap:wrap;gap:8px 12px;font-size:11px;color:var(--tx3);margin-left:26px">';
    html+='<span>Abende: '+s.abende+'</span>';
    html+='<span>Spiele: '+s.spiele+'</span>';
    html+='<span>Siege: '+winRate+'%</span>';
    html+='<span>Soli: '+s.soloWins+'/'+s.soloTotal+'</span>';
    if(s.platz1>0)html+='<span>Platz 1: '+s.platz1+'×</span>';
    html+='<span>Ø/Abend: '+(avg>0?'+':'')+avg+'</span>';
    html+='</div></div>';
  });
  html+='</div>';
  // Punkteverlauf-Chart
  html+='<div class="section-label" style="margin-top:20px">Punkteverlauf über Spielabende</div><div class="card"><div class="chart-container"><canvas id="allTimeChart"></canvas></div></div>';
  // Platzierungstabelle
  html+='<div class="section-label" style="margin-top:20px">Platzierungen</div><div class="card" style="overflow-x:auto">';
  const maxPlayers=Math.max(...sorted.map(g=>{const s=new Set();g.rounds.forEach(r=>r.playing.forEach(p=>s.add(p)));if(g.players)g.players.forEach(p=>s.add(p));return s.size}));
  html+='<table style="width:100%;font-size:11px;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:4px 6px;border-bottom:2px solid var(--bdr)">Datum</th>';
  for(let i=1;i<=maxPlayers;i++)html+='<th style="text-align:center;padding:4px 6px;border-bottom:2px solid var(--bdr)">'+i+'.</th>';
  html+='</tr></thead><tbody>';
  sorted.forEach(g=>{
    const abendPlayers=new Set();
    g.rounds.forEach(r=>r.playing.forEach(p=>abendPlayers.add(p)));
    if(g.players)g.players.forEach(p=>abendPlayers.add(p));
    const abendTotals={};
    abendPlayers.forEach(p=>{abendTotals[p]=0});
    g.rounds.forEach(r=>r.playing.forEach(p=>{abendTotals[p]=(abendTotals[p]||0)+(r.scores[p]||0)}));
    const placings=[...abendPlayers].sort((a,b)=>(abendTotals[b]||0)-(abendTotals[a]||0));
    const dateStr=formatArchiveDate(g,true);
    html+='<tr><td style="padding:4px 6px;border-bottom:1px solid var(--bdr);white-space:nowrap">'+dateStr+'</td>';
    for(let i=0;i<maxPlayers;i++){
      const p=placings[i];
      html+='<td style="text-align:center;padding:4px 6px;border-bottom:1px solid var(--bdr)">'+(p||'')+'</td>';
    }
    html+='</tr>';
  });
  html+='</tbody></table></div>';
  html+='<button class="btn btn-secondary" style="margin-top:16px;position:sticky;bottom:0" onclick="closeAllTimeModal()">Schließen</button>';
  document.getElementById('allTimeModalContent').innerHTML=html;
  document.getElementById('allTimeModal').classList.add('show');
  // Chart bauen
  const labels=sorted.map(g=>formatArchiveDate(g,true));
  const datasets=ranked.map((p,idx)=>{
    const data=sorted.map(g=>{
      const abendPlayers=new Set();
      g.rounds.forEach(r=>r.playing.forEach(pl=>abendPlayers.add(pl)));
      if(g.players)g.players.forEach(pl=>abendPlayers.add(pl));
      if(!abendPlayers.has(p))return null;
      let total=0;g.rounds.forEach(r=>{if(r.playing.includes(p))total+=(r.scores[p]||0)});
      return total;
    });
    return {label:p,data,borderColor:COLORS[idx%COLORS.length],backgroundColor:'transparent',borderWidth:2,pointRadius:3,tension:.3,spanGaps:false};
  });
  const cc=getChartColors();
  allTimeChartInstance=new Chart(document.getElementById('allTimeChart'),{type:'line',data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:cc.lbl,font:{size:11},boxWidth:12,padding:8}}},scales:{x:{grid:{color:cc.grid},ticks:{color:cc.tick,font:{size:11}}},y:{grid:{color:cc.grid},ticks:{color:cc.tick,font:{size:11}}}}}});
}

