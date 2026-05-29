import Chart from 'chart.js/auto';
import { state, viewingArchive, COLORS, ACHIEVEMENTS, getChartColors, getHistoricalPlayers } from './main.js';
import { ICO } from './ui.js';

let chartInstances=[];

export function renderStats(){
  chartInstances.forEach(c=>c.destroy());chartInstances=[];
  const src=viewingArchive||state;
  const all=viewingArchive?[...viewingArchive.players]:getHistoricalPlayers();
  const c=document.getElementById('statsContent');
  // Archive banner
  const statsScreen=document.getElementById('screen-stats');
  let banner=statsScreen.querySelector('.archive-banner');
  if(viewingArchive){
    if(!banner){banner=document.createElement('div');banner.className='archive-banner';statsScreen.insertBefore(banner,statsScreen.firstChild)}
    const dateStr=formatArchiveDate(viewingArchive,false);
    banner.innerHTML='<span>Archiv: '+dateStr+' \u2013 '+viewingArchive.players.length+' Spieler \u00b7 '+viewingArchive.rounds.length+' Runden</span><button onclick="closeArchiveView()">'+ICO.x+'</button>';
  }else if(banner){banner.remove()}
  // Share button visibility
  const shareBtn=statsScreen.querySelector('.share-btn');
  if(shareBtn)shareBtn.style.display='';
  const rounds=src.rounds;
  if(!rounds.length){c.innerHTML='<div class="card"><div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Spiele ein paar Spiele f\u00fcr Statistiken.</div></div>';return}
  const totals={},wins={},losses={},soloWins={},soloLosses={},gamesPlayed={};
  all.forEach(p=>{totals[p]=0;wins[p]=0;losses[p]=0;soloWins[p]=0;soloLosses[p]=0;gamesPlayed[p]=0});
  rounds.forEach(r=>{
    let solist=null;
    if(r.solo){
      if(r.winners.length===1)solist=r.winners[0];
      else if(r.winners.length===3){
        // Solist = der eine Verlierer (aus playing, nicht aus all – Spieler könnte gelöscht sein)
        solist=r.playing.find(p=>!r.winners.includes(p));
      }
    }
    all.forEach(p=>{
      if(r.playing.includes(p)){gamesPlayed[p]++;totals[p]+=(r.scores[p]||0);
        if(r.winners.includes(p)){wins[p]++;if(r.solo&&p===solist)soloWins[p]++}
        else{losses[p]++;if(r.solo&&p===solist)soloLosses[p]++}
      }
    });
  });
  const soloCount=rounds.filter(r=>r.solo).length;
  const maxSoloWins=soloCount>0?Math.max(...all.map(p=>soloWins[p])):0;
  const _soloCandidates=maxSoloWins>0?all.filter(p=>soloWins[p]===maxSoloWins):[];
  const soloKing=_soloCandidates.length===1?_soloCandidates[0]:'–';
  const maxTotal=all.length?Math.max(...all.map(p=>totals[p])):0;
  const _bestCandidates=all.filter(p=>totals[p]===maxTotal);
  const bestPlayer=_bestCandidates.length===1?_bestCandidates[0]:'–';
  let html='<div id="shareableStats">';
  html+='<div class="stat-grid">';
  html+='<div class="stat-card"><div class="stat-val">'+rounds.length+'</div><div class="stat-label">Spiele</div></div>';
  html+='<div class="stat-card"><div class="stat-val" style="font-size:16px">'+bestPlayer+'</div><div class="stat-label">Bester Spieler</div></div>';
  html+='<div class="stat-card"><div class="stat-val">'+rounds.filter(r=>r.solo).length+'</div><div class="stat-label">Soli</div></div>';
  html+='<div class="stat-card"><div class="stat-val" style="font-size:16px">'+soloKing+'</div><div class="stat-label">👑 Solokönig</div></div>';
  html+='</div>';
  html+=buildHighlights(all,rounds,src);
  html+=buildAchievementSection(all,src);
  html+='<div class="section-label" style="margin-top:20px">Spieler</div><div class="card">';
  const sortedStats=all.slice().sort((a,b)=>totals[b]-totals[a]);
  sortedStats.forEach((p,i)=>{
    const avg=gamesPlayed[p]?Math.round(totals[p]/gamesPlayed[p]*10)/10:0;
    const winRate=gamesPlayed[p]?Math.round(wins[p]/gamesPlayed[p]*100):0;
    const rc=i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'';
    html+='<div style="padding:10px 0;border-bottom:1px solid var(--bdr)"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:500"><span class="rank '+rc+'" style="display:inline-flex;width:20px;height:20px;font-size:11px;margin-right:6px">'+(i+1)+'</span>'+p+'</span><span class="'+(totals[p]>=0?'pos':'neg')+'" style="font-family:\'Space Mono\',monospace;font-weight:700">'+(totals[p]>0?'+':'')+totals[p]+'</span></div><div style="display:flex;gap:12px;font-size:12px;color:var(--tx3);margin-left:26px"><span>Siege: '+winRate+'%</span><span>Schnitt: '+(avg>0?'+':'')+avg+'</span><span>Soli: '+soloWins[p]+'/'+(soloWins[p]+soloLosses[p])+'</span></div></div>';
  });
  html+='</div></div>';
  html+='<div class="section-label" style="margin-top:20px">Punkteverlauf</div><div class="card"><div class="chart-container"><canvas id="lineChart"></canvas></div></div>';
  html+='<div class="section-label" style="margin-top:20px">Gewonnene Spiele</div><div class="card"><div class="chart-container"><canvas id="winsChart"></canvas></div></div>';
  html+='<div class="section-label" style="margin-top:20px">Punkteschnitt je Spiel</div><div class="card"><div class="chart-container"><canvas id="avgChart"></canvas></div></div>';
  html+='<div class="section-label" style="margin-top:20px">Soli (gewonnen / verloren)</div><div class="card"><div class="chart-container"><canvas id="soloChart"></canvas></div></div>';
  html+='<div class="section-label" style="margin-top:20px">Wer war im Team?</div><div class="card" id="pairCard"></div>';
  c.innerHTML=html;
  buildCharts(all,totals,wins,losses,soloWins,soloLosses,gamesPlayed);
  buildPairings(all);
}
export function buildCharts(all,totals,wins,losses,soloWins,soloLosses,gamesPlayed){
  const cumulative={};all.forEach(p=>cumulative[p]=[]);
  let running={};all.forEach(p=>running[p]=0);
  const rounds=(viewingArchive||state).rounds;
  rounds.forEach(r=>{all.forEach(p=>{running[p]+=(r.scores[p]||0);cumulative[p].push(running[p])})});
  const labels=rounds.map((_,i)=>''+(i+1));
  const cOpts={responsive:true,maintainAspectRatio:false};
  const cc=getChartColors();const gridC=cc.grid;const tickC=cc.tick;const lblC=cc.lbl;
  chartInstances.push(new Chart(document.getElementById('lineChart'),{type:'line',data:{labels,datasets:all.map((p,i)=>({label:p,data:cumulative[p],borderColor:COLORS[i%COLORS.length],backgroundColor:'transparent',borderWidth:2,pointRadius:2,tension:.3}))},options:{...cOpts,plugins:{legend:{labels:{color:lblC,font:{size:11},boxWidth:12,padding:8}}},scales:{x:{grid:{color:gridC},ticks:{color:tickC,font:{size:11}}},y:{grid:{color:gridC},ticks:{color:tickC,font:{size:11}}}}}}));
  chartInstances.push(new Chart(document.getElementById('winsChart'),{type:'bar',data:{labels:all,datasets:[{label:'Gewonnen',data:all.map(p=>wins[p]),backgroundColor:'#0a8f6a'},{label:'Verloren',data:all.map(p=>losses[p]),backgroundColor:'#c0392b'}]},options:{...cOpts,plugins:{legend:{labels:{color:lblC,font:{size:11},boxWidth:12}}},scales:{x:{grid:{display:false},ticks:{color:lblC,font:{size:11}}},y:{grid:{color:gridC},ticks:{color:tickC,font:{size:11},stepSize:1}}}}}));
  const avgs=all.map(p=>gamesPlayed[p]?Math.round(totals[p]/gamesPlayed[p]*10)/10:0);
  chartInstances.push(new Chart(document.getElementById('avgChart'),{type:'bar',data:{labels:all,datasets:[{label:'Schnitt',data:avgs,backgroundColor:avgs.map(v=>v>=0?'#0a8f6a':'#c0392b')}]},options:{...cOpts,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{grid:{color:gridC},ticks:{color:tickC,font:{size:11}}},y:{grid:{display:false},ticks:{color:lblC,font:{size:12}}}}}}));
  chartInstances.push(new Chart(document.getElementById('soloChart'),{type:'bar',data:{labels:all,datasets:[{label:'Gewonnen',data:all.map(p=>soloWins[p]),backgroundColor:'#0a8f6a'},{label:'Verloren',data:all.map(p=>soloLosses[p]),backgroundColor:'#c0392b'}]},options:{...cOpts,plugins:{legend:{labels:{color:lblC,font:{size:11},boxWidth:12}}},scales:{x:{grid:{display:false},ticks:{color:lblC,font:{size:11}}},y:{grid:{color:gridC},ticks:{color:tickC,font:{size:11},stepSize:1}}}}}));
}
export function buildPairings(all){
  const pairs={};
  for(let i=0;i<all.length;i++){for(let j=i+1;j<all.length;j++){pairs[all[i]+'|'+all[j]]=0}}
  (viewingArchive||state).rounds.forEach(r=>{
    if(r.solo)return;
    const teamWin=r.winners;const teamLose=r.playing.filter(p=>!r.winners.includes(p));
    [teamWin,teamLose].forEach(team=>{
      for(let i=0;i<team.length;i++){for(let j=i+1;j<team.length;j++){
        const a=team[i],b=team[j];
        const key=all.indexOf(a)<all.indexOf(b)?a+'|'+b:b+'|'+a;
        if(pairs[key]!==undefined)pairs[key]++;
      }}
    });
  });
  const maxP=Math.max(...Object.values(pairs),1);
  const sorted=Object.entries(pairs).sort((a,b)=>b[1]-a[1]);
  let html='';
  sorted.forEach(([key,count])=>{
    const [a,b]=key.split('|');const pct=Math.round(count/maxP*100);
    html+='<div class="pair-row"><span>'+a+' & '+b+'</span><div style="display:flex;align-items:center;gap:8px"><div class="pair-bar" style="width:'+Math.max(pct,2)+'px"></div><span style="font-family:\'Space Mono\',monospace;font-size:13px;font-weight:500;min-width:20px;text-align:right">'+count+'</span></div></div>';
  });
  document.getElementById('pairCard').innerHTML=html;
}

export function buildHighlights(all,rounds,src){
  if(rounds.length<2)return '';
  const items=[];
  // Größter Gewinn
  let maxGain={val:0,player:'',round:0};
  let maxLoss={val:0,player:'',round:0};
  rounds.forEach((r,i)=>{
    all.forEach(p=>{
      if(!r.playing.includes(p))return;
      const s=r.scores[p]||0;
      if(s>maxGain.val){maxGain={val:s,player:p,round:i+1}}
      if(s<maxLoss.val){maxLoss={val:s,player:p,round:i+1}}
    });
  });
  if(maxGain.val>0)items.push({icon:'🎯',label:'Größter Gewinn',val:maxGain.player+': +'+maxGain.val+' (Spiel '+maxGain.round+')'});
  if(maxLoss.val<0)items.push({icon:'💥',label:'Größter Verlust',val:maxLoss.player+': '+maxLoss.val+' (Spiel '+maxLoss.round+')'});
  // Längste Siegesserie
  let bestWinStreak={len:0,player:'',from:0,to:0};
  let bestLoseStreak={len:0,player:'',from:0,to:0};
  all.forEach(p=>{
    let wStreak=0,wFrom=0,lStreak=0,lFrom=0;
    rounds.forEach((r,i)=>{
      if(!r.playing.includes(p))return;
      if(r.winners.includes(p)){
        if(wStreak===0)wFrom=i+1;
        wStreak++;
        if(wStreak>bestWinStreak.len){bestWinStreak={len:wStreak,player:p,from:wFrom,to:i+1}}
        lStreak=0;
      }else{
        if(lStreak===0)lFrom=i+1;
        lStreak++;
        if(lStreak>bestLoseStreak.len){bestLoseStreak={len:lStreak,player:p,from:lFrom,to:i+1}}
        wStreak=0;
      }
    });
  });
  if(bestWinStreak.len>=2)items.push({icon:'🔥',label:'Längste Siegesserie',val:bestWinStreak.player+': '+bestWinStreak.len+' Siege (Spiel '+bestWinStreak.from+'–'+bestWinStreak.to+')'});
  if(bestLoseStreak.len>=2)items.push({icon:'💀',label:'Längste Pechserie',val:bestLoseStreak.player+': '+bestLoseStreak.len+' Niederlagen (Spiel '+bestLoseStreak.from+'–'+bestLoseStreak.to+')'});
  // Comeback des Abends
  let bestComeback={delta:0,player:'',low:0,end:0};
  all.forEach(p=>{
    let cum=0,lowest=0;
    rounds.forEach(r=>{
      if(r.playing.includes(p))cum+=(r.scores[p]||0);
      if(cum<lowest)lowest=cum;
    });
    if(lowest<0){
      const delta=cum-lowest;
      if(delta>bestComeback.delta)bestComeback={delta,player:p,low:lowest,end:cum};
    }
  });
  if(bestComeback.delta>0)items.push({icon:'📈',label:'Comeback des Abends',val:bestComeback.player+': '+bestComeback.low+' → '+(bestComeback.end>0?'+':'')+bestComeback.end+' (+'+bestComeback.delta+')'});
  // Spieldauer
  if(src.gameStartTime&&rounds.length&&rounds[rounds.length-1].timestamp){
    const totalMs=rounds[rounds.length-1].timestamp-src.gameStartTime;
    if(totalMs>0){
      const avgMs=totalMs/rounds.length;
      items.push({icon:'⏱️',label:'Spieldauer',val:formatHighlightDuration(totalMs)+' (Ø '+formatHighlightDuration(avgMs)+' pro Spiel)'});
    }
  }
  // Wendepunkt
  let leaders=[];
  let running={};all.forEach(p=>running[p]=0);
  rounds.forEach((r,i)=>{
    all.forEach(p=>running[p]+=(r.scores[p]||0));
    let leader=all[0];all.forEach(p=>{if(running[p]>running[leader])leader=p});
    leaders.push(leader);
  });
  let lastChangeIdx=-1,finalLeader=leaders[leaders.length-1];
  for(let i=leaders.length-1;i>0;i--){
    if(leaders[i]!==leaders[i-1]){lastChangeIdx=i;break}
  }
  if(lastChangeIdx>0)items.push({icon:'🔄',label:'Wendepunkt',val:'Spiel '+(lastChangeIdx+1)+': '+finalLeader+' übernimmt Führung'});
  else if(leaders.length>0)items.push({icon:'🔄',label:'Wendepunkt',val:'Führung von Anfang an: '+finalLeader});
  // HTML bauen
  if(!items.length)return '';
  let html='<div class="section-label" style="margin-top:20px">Highlights des Abends</div>';
  html+='<div class="card" style="font-size:12px">';
  items.forEach((item,i)=>{
    const border=i<items.length-1?'border-bottom:1px solid var(--bdr);':'';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;'+border+'">';
    html+='<span style="color:var(--tx3)">'+item.icon+' '+item.label+'</span>';
    html+='<span style="font-weight:500;text-align:right">'+item.val+'</span>';
    html+='</div>';
  });
  html+='</div>';
  return html;
}
export function formatHighlightDuration(ms){
  const totalSec=Math.floor(ms/1000);
  const h=Math.floor(totalSec/3600);
  const m=Math.floor((totalSec%3600)/60);
  const s=totalSec%60;
  if(h>0)return h+'h '+m+'min';
  if(m>0)return m+':'+String(s).padStart(2,'0')+'min';
  return s+'s';
}
export function buildAchievementSection(all,src){
  const eveningAch=(src===state)?state.achievements||{}:{};
  const seasonAch=loadSeasonAchievements();
  // Merge evening + season achievements per player
  const merged={};
  all.forEach(p=>{
    const ea=eveningAch[p]||[];
    const sa=seasonAch[p]||[];
    const combined=[];
    ea.forEach(id=>{const def=ACHIEVEMENTS.evening[id];if(def)combined.push(def.emoji+' '+def.name)});
    sa.forEach(id=>{const def=ACHIEVEMENTS.season[id];if(def)combined.push(def.emoji+' '+def.name)});
    if(combined.length)merged[p]=combined;
  });
  const players=Object.keys(merged);
  if(!players.length)return '';
  let html='<div class="section-label" style="margin-top:20px">Achievements</div><div class="card">';
  players.forEach((p,i)=>{
    const border=i<players.length-1?'border-bottom:1px solid var(--bdr);':'';
    html+='<div style="padding:8px 0;'+border+'">';
    html+='<div style="font-weight:500;margin-bottom:4px">'+p+'</div>';
    html+='<div style="display:flex;flex-wrap:wrap;gap:4px">';
    merged[p].forEach(badge=>{
      html+='<span style="background:var(--bg3);padding:2px 8px;border-radius:12px;font-size:11px;white-space:nowrap">'+badge+'</span>';
    });
    html+='</div></div>';
  });
  html+='</div>';
  return html;
}

