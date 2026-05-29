// ui.js – UI-Helfer: Toast, Confirm, Prompt, Icons, Konfetti
// Extrahiert aus dem ehemaligen Inline-Script (verbatim).

let toastTimer=null;
export function showToast(text,type){
  const el=document.getElementById('appToast');
  const tx=document.getElementById('appToastText');
  tx.textContent=text;
  el.className='app-toast '+(type||'info');
  el.classList.add('show');
  el.onclick=hideToast;
  clearTimeout(toastTimer);
}
export function hideToast(){
  document.getElementById('appToast').classList.remove('show');
}
export function showConfirm(text,actionLabel,danger){
  return new Promise(resolve=>{
    const overlay=document.getElementById('confirmOverlay');
    document.getElementById('confirmText').textContent=text;
    const actionBtn=document.getElementById('confirmAction');
    actionBtn.textContent=actionLabel||'OK';
    actionBtn.className='confirm-action'+(danger?' danger':'');
    overlay.classList.add('show');
    const cancel=document.getElementById('confirmCancel');
    function cleanup(){overlay.classList.remove('show');actionBtn.onclick=null;cancel.onclick=null;overlay.onclick=null}
    actionBtn.onclick=function(){cleanup();resolve(true)};
    cancel.onclick=function(){cleanup();resolve(false)};
    overlay.onclick=function(e){if(e.target===overlay){cleanup();resolve(false)}};
  });
}

export function showPrompt(text,placeholder,actionLabel){
  return new Promise(resolve=>{
    const overlay=document.getElementById('confirmOverlay');
    document.getElementById('confirmText').innerHTML=text+'<input type="text" id="confirmInput" placeholder="'+(placeholder||'')+'" style="width:100%;box-sizing:border-box;font-size:15px;padding:10px;margin-top:12px;border:1px solid var(--bdr);border-radius:var(--r-sm);background:var(--bg);color:var(--tx)">';
    const actionBtn=document.getElementById('confirmAction');
    actionBtn.textContent=actionLabel||'OK';
    actionBtn.className='confirm-action';
    overlay.classList.add('show');
    setTimeout(()=>{const inp=document.getElementById('confirmInput');if(inp)inp.focus()},100);
    const cancel=document.getElementById('confirmCancel');
    function cleanup(){overlay.classList.remove('show');actionBtn.onclick=null;cancel.onclick=null;overlay.onclick=null}
    actionBtn.onclick=function(){const val=document.getElementById('confirmInput').value.trim();cleanup();resolve(val||null)};
    cancel.onclick=function(){cleanup();resolve(null)};
    overlay.onclick=function(e){if(e.target===overlay){cleanup();resolve(null)}};
  });
}

export const ICO={
  up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>',
  down:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>',
  edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
  backspace:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>',
  x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
};

export function launchConfetti(){
  const container=document.createElement('div');container.className='confetti-container';document.body.appendChild(container);
  const colors=['#2ec4b6','#e05252','#f0a830','#5b4cdb','#ff6b6b','#48dbfb','#ff9ff3','#feca57'];
  const shapes=['&#9824;','&#9829;','&#9830;','&#9827;'];
  for(let i=0;i<60;i++){
    const c=document.createElement('div');c.className='confetti';
    c.innerHTML=Math.random()>0.5?shapes[Math.floor(Math.random()*shapes.length)]:'';
    c.style.left=Math.random()*100+'%';c.style.backgroundColor=colors[Math.floor(Math.random()*colors.length)];
    c.style.borderRadius=Math.random()>0.5?'50%':'2px';c.style.width=(4+Math.random()*8)+'px';c.style.height=(4+Math.random()*8)+'px';
    c.style.animationDuration=(1.5+Math.random()*2)+'s';c.style.animationDelay=(Math.random()*0.5)+'s';
    c.style.fontSize=(10+Math.random()*10)+'px';c.style.color=colors[Math.floor(Math.random()*colors.length)];
    container.appendChild(c);
  }
  setTimeout(()=>container.remove(),4000);
}
export function launchMiniConfetti(){
  const container=document.createElement('div');container.className='confetti-container';document.body.appendChild(container);
  const colors=['#2ec4b6','#e05252','#f0a830','#5b4cdb','#ff6b6b','#48dbfb','#ff9ff3','#feca57'];
  const shapes=['&#9824;','&#9829;','&#9830;','&#9827;'];
  for(let i=0;i<25;i++){
    const c=document.createElement('div');c.className='confetti';
    c.innerHTML=Math.random()>0.5?shapes[Math.floor(Math.random()*shapes.length)]:'';
    c.style.left=Math.random()*100+'%';c.style.backgroundColor=colors[Math.floor(Math.random()*colors.length)];
    c.style.borderRadius=Math.random()>0.5?'50%':'2px';c.style.width=(4+Math.random()*8)+'px';c.style.height=(4+Math.random()*8)+'px';
    c.style.animationDuration=(1+Math.random()*1.5)+'s';c.style.animationDelay=(Math.random()*0.3)+'s';
    c.style.fontSize=(10+Math.random()*10)+'px';c.style.color=colors[Math.floor(Math.random()*colors.length)];
    container.appendChild(c);
  }
  setTimeout(()=>container.remove(),2500);
}

