import {mountAnalytics,layoutCards,hbars} from '../analytics/analytics.js';

// HR side of the office site (spec 008): the «Аналітика» tab (shared analytics module) and
// «Налаштування HR» (pulse question, onboarding checklist, games schedule + quiz).
export function initHr({$, API, app, esc, getToken, openTokenModal, toast}){
/* ---------- HR analytics tab (spec 008): shared module public/analytics.js ---------- */
let anView=null;
async function renderStats(){const box=$('#stats'); if(!box) return; const tok=getToken();
  if(!tok){anView&&anView.destroy(); anView=null; box.innerHTML='<p class="hint">Аналітика доступна HR. <button class="btn" id="statsLogin">Ввести код доступу</button></p>'; $('#statsLogin').onclick=()=>openTokenModal(); return;}
  if(anView){anView.reload(); return;}
  box.innerHTML='<div id="anRoot"></div><details id="hrToolsWrap"><summary><span class="hr-ic" style="--c1:#A9AFB7;--c2:#5B626B"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg></span><span class="tx"><b>Налаштування HR</b><small>Пульс тижня · онбординг новачків · ігри в телефоні</small></span><svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></summary><div id="hrTools"></div></details>';
  const H=()=>({'X-Edit-Token':getToken()});
  const get=async p=>{const r=await fetch(API+'/analytics'+p,{headers:H()}); if(!r.ok) throw Object.assign(new Error(r.status),{code:r.status}); return r.json();};
  anView=mountAnalytics($('#anRoot'),{get,toast,
    fullscreen:on=>{if(on) app.dataset.anfull='1'; else delete app.dataset.anfull;},
    async exportFile(kind,q){const r=await fetch(`${API}/analytics/export.${kind}?${q}`,{headers:H()}); if(!r.ok) throw new Error(r.status);
      const name=decodeURIComponent((/filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition')||'')||[])[1]||`analytics.${kind}`);
      const url=URL.createObjectURL(await r.blob()), a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),4000); toast('Файл завантажено');}});}
/* ---------- HR tools (spec 007): weekly pulse, newcomer onboarding, games schedule + quiz ---------- */
async function renderHrTools(){const box=$('#stats'), tok=getToken(); if(!box||!tok) return;
  let el=$('#hrTools'); if(!el) return;
  const H={'X-Edit-Token':tok,'content-type':'application/json'};
  const get=p=>fetch(API+p,{headers:H}).then(r=>r.ok?r.json():null).catch(()=>null);
  const put=(p,b)=>fetch(API+p,{method:'PUT',headers:H,body:JSON.stringify(b)}).then(r=>{if(!r.ok) throw new Error(r.status); return r.json();});
  const [pulse,onb,gs]=await Promise.all([get('/pulse?weeks=8'),get('/onboarding'),get('/games/settings')]);
  const SV=(d,c1,c2)=>`<span class="hr-ic" style="--c1:${c1};--c2:${c2}"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></span>`;
  const headr=(ic,t,sub)=>`<div class="hr-h">${ic}<div><h5>${t}</h5><p>${sub}</p></div></div>`;
  const fmtD=k=>{const [y,m,d]=String(k).slice(0,10).split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('uk-UA',{day:'numeric',month:'short'});};
  const pulseCard=pulse?`<section class="an-card hr-c">${headr(SV('M3 12h4l3-7 4 14 3-7h4','#8EA2F5','#4A5FD6'),'Пульс тижня',`Анонімне питання щотижня · середнє видно лише для груп від ${pulse.minGroup} людей`)}
      <label class="hr-l" for="hrPulseQ">Питання цього тижня · ${esc(pulse.current.week)}</label>
      <div class="hr-row"><input class="hr-in" id="hrPulseQ" maxlength="200" value="${esc(pulse.current.question)}"><button class="an-btn pri" id="hrPulseSave">Зберегти</button></div>
      <div class="hr-l">Останні тижні</div>
      ${pulse.weeks.length?hbars(pulse.weeks.map(w=>({label:w.week,v:w.avg,sub:`${w.n} відп. · ${w.question}${w.depts.length?' · '+w.depts.map(d=>d.dept+' '+d.avg.toFixed(1)).join(', '):''}`})),{max:5,d:2}):'<p class="an-empty">Ще немає відповідей.</p>'}</section>`:'';
  const onbCard=onb?`<section class="an-card hr-c">${headr(SV('M9 4h6v2.5H9zM8 5H5v15h14V5h-3M8.5 13l2.2 2.2L15 11','#4FE0BC','#16917A'),'Онбординг новачків',`Чек-лист на перші ${onb.days} днів після дати найму`)}
      <div class="hr-l">Пункти чек-листа</div>
      <div id="hrOnbList">${onb.items.map(i=>`<div class="hr-item" data-id="${esc(i.id)}"><span class="hr-num"></span><input class="hr-in" value="${esc(i.text)}" maxlength="160" aria-label="Пункт"><button type="button" class="hr-x" aria-label="Видалити пункт">×</button></div>`).join('')}</div>
      <button type="button" class="hr-add" id="hrOnbAdd">+ Додати пункт</button>
      <div class="hr-l">Новачки зараз</div>
      ${onb.people.length?onb.people.map(p=>`<div class="hr-np"><span><b>${esc(p.name)}</b><small>${esc(p.dept||'')}${p.hiredOn?' · з '+fmtD(p.hiredOn):''}</small></span><span class="an-prog"><i style="width:${p.total?p.done/p.total*100:0}%"></i></span><b>${p.done}/${p.total}</b></div>`).join(''):'<p class="an-empty">Новачків немає — вкажіть «Дату найму» в картці співробітника.</p>'}
      <div class="hr-foot"><button class="an-btn pri" id="hrOnbSave">Зберегти чек-лист</button></div></section>`:'';
  const gamesCard=gs?`<section class="an-card hr-c">${headr(SV('M6 9h12a4 4 0 0 1 3.9 4.9l-.6 2.6a2.6 2.6 0 0 1-4.5 1.1L15 15.5H9l-1.8 2.1a2.6 2.6 0 0 1-4.5-1.1l-.6-2.6A4 4 0 0 1 6 9Z','#FFB04A','#FF5E3A'),'Ігри в телефоні','Коли співробітникам доступні міні-ігри та вікторина')}
      <label class="hr-swrow"><span><b>Ігри дозволені</b><small>Вимкніть, щоб сховати ігри для всіх</small></span><input type="checkbox" class="hr-sw" id="hrGamesOn" ${gs.enabled?'checked':''}></label>
      <label class="hr-l" for="hrGamesWin">Години для ігор</label>
      <input class="hr-in" id="hrGamesWin" placeholder="Будь-коли · або 12:00-14:00, 18:00-21:00" value="${esc(gs.windows.map(w=>w.from+'-'+w.to).join(', '))}">
      <p class="hr-hint">Порожньо — будь-коли. Кілька проміжків — через кому.</p>
      <label class="hr-l" for="hrQuiz">Питання вікторини · ${gs.quiz.length}</label>
      <textarea class="hr-in" id="hrQuiz" rows="6">${esc(gs.quiz.map(q=>[q.q,q.options[q.answer],...q.options.filter((_,i)=>i!==q.answer)].join(' | ')).join('\n'))}</textarea>
      <p class="hr-hint">По рядку: <b>Питання | правильна відповідь | варіант | варіант</b></p>
      <div class="hr-foot"><button class="an-btn pri" id="hrGamesSave">Зберегти налаштування ігор</button></div></section>`:'';
  el.className='an an-hr';
  el.innerHTML=`<div class="an-grid">${pulseCard}${onbCard}${gamesCard}</div>`;
  const grid=el.querySelector('.an-grid'), lay=()=>{if(grid.isConnected&&grid.clientWidth) layoutCards(grid);};
  lay(); const det=$('#hrToolsWrap'); if(det) det.ontoggle=lay;
  if(!el._ro&&typeof ResizeObserver==='function'){let t=0; el._ro=new ResizeObserver(()=>{clearTimeout(t); t=setTimeout(()=>{const g=el.querySelector('.an-grid'); if(g&&g.clientWidth&&Math.max(1,Math.min(3,Math.floor((g.clientWidth+14)/344)))!==+g.dataset.cols) layoutCards(g);},80);}); el._ro.observe(el);}
  // onboarding list editor
  const list=$('#hrOnbList'), renum=()=>list&&list.querySelectorAll('.hr-num').forEach((n,i)=>n.textContent=i+1);
  if(list){renum(); list.onclick=e=>{const x=e.target.closest('.hr-x'); if(x){x.parentElement.remove(); renum();}};
    $('#hrOnbAdd').onclick=()=>{list.insertAdjacentHTML('beforeend','<div class="hr-item"><span class="hr-num"></span><input class="hr-in" maxlength="160" placeholder="Новий пункт" aria-label="Пункт"><button type="button" class="hr-x" aria-label="Видалити пункт">×</button></div>'); renum(); list.lastElementChild.querySelector('input').focus();};}
  const busy=async(b,fn)=>{b.disabled=true; try{await fn();}finally{b.disabled=false;}};
  const ps=$('#hrPulseSave'); if(ps) ps.onclick=()=>busy(ps,async()=>{try{await put('/pulse/question',{question:$('#hrPulseQ').value}); toast('Питання тижня збережено');}catch(e){toast('Не вдалося зберегти');}});
  const os=$('#hrOnbSave'); if(os) os.onclick=()=>busy(os,async()=>{const items=[...list.querySelectorAll('.hr-item')].map(r=>({id:r.dataset.id,text:r.querySelector('input').value.trim()})).filter(i=>i.text);
    try{await put('/onboarding/template',{items}); toast('Чек-лист збережено'); renderHrTools();}catch(e){toast('Не вдалося зберегти');}});
  const gsv=$('#hrGamesSave'); if(gsv) gsv.onclick=()=>busy(gsv,async()=>{
    const windows=$('#hrGamesWin').value.split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const m=/^(\d{1,2}:\d\d)\s*[-–]\s*(\d{1,2}:\d\d)$/.exec(x); return m?{from:m[1].padStart(5,'0'),to:m[2].padStart(5,'0')}:null;});
    if(windows.some(w=>!w)){toast('Години у форматі 12:00-14:00'); return;}
    const quiz=$('#hrQuiz').value.split('\n').map(l=>l.split('|').map(x=>x.trim()).filter(Boolean)).filter(p=>p.length>=3).map(p=>({q:p[0],options:p.slice(1,5),answer:0}));
    try{await put('/games/settings',{enabled:$('#hrGamesOn').checked,windows,quiz}); toast('Налаштування ігор збережено');}catch(e){toast('Не вдалося зберегти');}});}
$('#tabs [data-tab="stats"]').addEventListener('click',()=>renderStats().then(renderHrTools));
return {exitFull(){if(anView) anView.exitFull();}};
}
