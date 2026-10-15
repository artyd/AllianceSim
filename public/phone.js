// AllianceOS — the phone (personal Mini App + office demo), split out of index.html (spec 005 F).
// Office internals come in through `O` (see the initPhone(...) call in index.html):
// constants/functions by value, `state` through a getter because the office reassigns it.
export function initPhone(O){
  const {$, API, DEPT_COLORS, MOODS, ROOMS, STATUS, TG, ZONES, apiEmpWrite, app, applySettings, avHTML, empUpsert, esc, focusEmployee, getToken, params, refreshLive, renderLabels, renderPeople, roomAt, roomName, settings, statusOf, syncAvatars, toast}=O;
  const PHONE={}; // hooks for the office init: personalStart (and future deep links)
  const phone=$('#phone'), body=$('#pbody');
  const scr=id=>body.querySelector(`[data-scr="${id}"]`);
  const emp=id=>O.state.employees.find(e=>e.id===id);
  // Fire-and-forget: tell the backend to notify this colleague on Telegram (if linked).
  const notify=(id,kind,text)=>{try{const h={'content-type':'application/json'}; if(TG.active) h['X-Telegram-Init-Data']=TG.initData; fetch(API+'/notifications',{method:'POST',headers:h,body:JSON.stringify({employeeId:id,kind,text:text||null})}).catch(()=>{});}catch(e){}};
  let stack=[];
  const IC={
    phone:'<svg viewBox="0 0 24 24"><path d="M6.5 3h3l1.6 4-2 1.4a12 12 0 0 0 5 5l1.4-2 4 1.6v3a2 2 0 0 1-2.1 2A16 16 0 0 1 4 5.1 2 2 0 0 1 6.5 3Z"/></svg>',
    chat:'<svg viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4V5Z"/></svg>',
    send:'<svg viewBox="0 0 24 24"><path d="M3 11l17-7-7 17-2.6-6.6L3 11Z"/></svg>',
    back:'<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    pin:'<svg viewBox="0 0 24 24"><path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z"/><circle cx="12" cy="9" r="2.4"/></svg>',
    coffee:'<svg viewBox="0 0 24 24"><path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M17 9h2.2a2.5 2.5 0 0 1 0 5H17"/><path d="M7.5 3v2M11 3v2"/></svg>'
  };
  const load=(k,f)=>{try{const v=JSON.parse(localStorage.getItem(k)); return v==null?f:v;}catch(e){return f;}};
  const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}};
  const setBadge=(el,n)=>{el.style.display=n?'grid':'none'; el.textContent=n>99?'99+':n;};
  function badges(){const n=personal()?unreadTotal():0, t=personal()?tasksDue():0, v=personal()?PM.invites||0:0; setBadge($('#phoneDot'),n+t+v); setBadge($('#calBadge'),v); setBadge($('#chatBadge'),n); setBadge($('#taskBadge'),t);}

  function tick(){const d=new Date(); $('#pclock').textContent=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    $('#pdate').textContent=d.toLocaleDateString('uk-UA',{weekday:'long',day:'numeric',month:'long'});}
  const wire=s=>s.querySelectorAll('[data-back]').forEach(b=>b.onclick=back);
  const head=t=>`<div class="phead"><button class="bk" data-back>${IC.back}</button><div class="ti">${t}</div><div class="sp"></div></div>`;
  const rowHTML=(e,sub)=>`<div class="prow" data-id="${e.id}">${avHTML(e)}<div class="tx"><div class="nm">${esc(e.name)}</div><div class="sub">${esc(sub||e.position||e.dept)}</div></div><div class="meta">${STATUS[statusOf(e)].icon}</div></div>`;
  const empty=(b,s)=>`<div class="pempty"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.4"/><path d="M3 19a6 6 0 0 1 12 0M17 5a3.4 3.4 0 0 1 0 6.8M22 19a6 6 0 0 0-4.5-5.8"/></svg><b>${b}</b><span>${s}</span></div>`;
  const fld=(k,v)=>`<div class="pfield"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`;

  // "Подзвонити": open the colleague in Telegram (call from there), else dial the phone.
  function callPerson(id){const e=emp(id), u=PM&&PM.contacts&&PM.contacts.get(id);
    if(u){const l='https://t.me/'+u; try{Telegram.WebApp.openTelegramLink(l);}catch(err){window.open(l,'_blank');} return;}
    if(e&&e.phone){location.href='tel:'+e.phone.replace(/[^\d+]/g,''); return;}
    toast('Немає контакту для дзвінка');}

  // ── personal mode (spec 004): real per-user data via /me/*, only inside Telegram ──
  // Identity = the verified Telegram user's linked character (TG.me). Nothing here goes
  // into `state` or the layout blob; the office renderers are untouched.
  const personal=()=>TG.active&&!!TG.me;
  const PM={token:null,exp:0,tasks:null,ev:new Map(),contacts:new Map(),prefs:null};
  async function meApi(method,path,body){
    const h={'content-type':'application/json','X-Telegram-Init-Data':TG.initData};
    if(PM.token&&PM.exp*1000>Date.now()+60000) h['X-Me-Token']=PM.token;
    const r=await fetch(API+path,{method,headers:h,body:body!==undefined?JSON.stringify(body):undefined});
    if(r.status===401){toast('Сесія застаріла — закрийте й відкрийте застосунок знову'); throw Object.assign(new Error('stale'),{code:401});}
    if(!r.ok){const j=await r.json().catch(()=>({})); throw Object.assign(new Error(j.error||('http '+r.status)),{code:r.status});}
    return r.json().catch(()=>null);
  }
  const fail=e=>{if(!e||e.code!==401) toast('Не вдалося зберегти — перевірте зв’язок');};
  async function session(tries=1){for(let i=0;i<tries;i++){try{const s=await meApi('POST','/me/session'); PM.token=s.token; PM.exp=s.exp; return true;}catch(e){if(e.code===401) return false; await new Promise(r=>setTimeout(r,2000));}} return false;}
  const pad=n=>String(n).padStart(2,'0');
  const dKey=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const hm=d=>pad(d.getHours())+':'+pad(d.getMinutes());
  const fromInputs=(date,time)=>{const [y,m,dd]=date.split('-').map(Number), [hh,mi]=(time||'00:00').split(':').map(Number); return new Date(y,m-1,dd,hh||0,mi||0);};
  const dayLabel=d=>d.toLocaleDateString('uk-UA',{weekday:'short',day:'numeric',month:'long'});
  const nameOf=id=>{const e=emp(id); return e?e.name:'Колега';};
  const first=id=>nameOf(id).split(' ')[0];
  const headP=(t,act)=>`<div class="phead"><button class="bk" data-back>${IC.back}</button><div class="ti">${t}</div><div class="sp"></div>${act||''}</div>`;
  const redraw=id=>{const s=scr(id); if(s&&s._redraw&&stack.includes(id)) s._redraw();};
  const PALETTE=['#E2001A','#F28C28','#F2C036','#5DBE7C','#3EA8C9','#5B76E6','#A36BE0','#E06CA6'];
  const REMIND=[[null,'Без нагадування'],[10,'За 10 хв'],[30,'За 30 хв'],[60,'За 1 год']];
  const REPEAT=[[null,'Не повторювати'],['daily','Щодня'],['weekdays','По буднях'],['weekly','Щотижня'],['monthly','Щомісяця']];
  const REPEAT_TXT={daily:'щодня',weekdays:'по буднях',weekly:'щотижня',monthly:'щомісяця'};
  // Bookable rooms = plan rooms / drawn zones that HR typed as «Переговорна».
  const meetingRooms=()=>[...ROOMS.filter(r=>(O.state.zones[r.id]||{}).type==='meeting').map(r=>({key:r.id,name:roomName(r.id)})),
    ...O.state.rects.filter(rz=>rz.type==='meeting').map(rz=>({key:'rz:'+rz.uid,name:rz.name||ZONES.meeting.n}))];
  const chipsHTML=(attr,opts,cur)=>`<div class="pchips" ${attr}>${opts.map(([v,l])=>`<button type="button" class="pchip" data-v="${v??''}" aria-pressed="${String(v??'')===String(cur??'')}">${l}</button>`).join('')}</div>`;
  const pickChip=(box,fn)=>box.querySelectorAll('.pchip').forEach(b=>b.onclick=()=>{box.querySelectorAll('.pchip').forEach(x=>x.setAttribute('aria-pressed',x===b)); fn(b.dataset.v);});
  // Two-tap confirm (browser confirm() dialogs would freeze the Mini App WebView).
  const confirm2=(btn,label,fn)=>{btn.onclick=()=>{if(btn.dataset.armed){fn();return;} btn.dataset.armed='1'; const t=btn.textContent; btn.textContent=label; setTimeout(()=>{delete btn.dataset.armed; btn.textContent=t;},3000);};};
  function locked(s,title){
    s.innerHTML=head(title)+`<div class="plocked"><div class="e">🔒</div><b>${TG.active?'Спочатку створіть персонажа':'Доступно в Telegram'}</b><span>${TG.active?'Напишіть боту /start — і тут з’являться ваші особисті чати, календар і задачі.':'Особисті чати, календар і задачі працюють у застосунку офісу всередині Telegram-бота.'}</span></div>`; wire(s);}
  async function loadInvites(){try{PM.invites=(await meApi('GET','/me/invites')).length; badges();}catch(e){}}
  async function loadTasks(){try{PM.tasks=await meApi('GET','/me/tasks'); badges(); redraw('tasks');}catch(e){}}
  // ── chats: cache + live stream (SSE). Server is the source of truth; this is a view. ──
  PM.chats=null; PM.typing=new Map(); // chatId → {id, until}
  const chatById=id=>(PM.chats||[]).find(c=>c.id===String(id));
  function upsertChat(c){if(!PM.chats) PM.chats=[]; const i=PM.chats.findIndex(x=>x.id===c.id); if(i>=0) PM.chats[i]=c; else PM.chats.push(c); PM.chats.sort((a,b)=>new Date(b.lastAt)-new Date(a.lastAt));}
  // A live update landing while the list request is in flight wins: refetch instead of clobbering it.
  async function loadChats(){const seq=PM.seq=(PM.seq||0)+1, live=PM.live||0; try{const l=await meApi('GET','/me/chats'); if(seq!==PM.seq) return; if((PM.live||0)!==live){loadChats(); return;} PM.chats=l; badges(); redraw('chatlist');}catch(e){}}
  const unreadTotal=()=>(PM.chats||[]).reduce((n,c)=>n+(c.muted?0:c.unread),0);
  const otherOf=c=>c.kind==='direct'?(c.members.find(m=>m.id!==TG.me.id)||{}).id:null;
  const chatTitle=c=>c.kind==='direct'?nameOf(otherOf(c)):c.kind==='office'?'Весь офіс':c.kind==='dept'?(c.dept||'Відділ'):(c.title||'Група');
  const chatAv=c=>{if(c.kind==='direct'){const e=emp(otherOf(c)); if(e) return avHTML(e);} return `<div class="av gav">${c.kind==='office'?'🏢':c.kind==='dept'?'🏷️':'👥'}</div>`;};
  const REACT=['👍','❤️','😂','😮','😢','🙏'];
  const senderName=id=>id?nameOf(id):'HR'; // HR web announcements have no sender
  const typingIn=id=>{const t=PM.typing.get(String(id)); return t&&t.until>Date.now()?t.id:null;};
  const shortTime=iso=>{const d=new Date(iso), now=new Date(); if(d.toDateString()===now.toDateString()) return hm(d); if(now-d<6*864e5) return d.toLocaleDateString('uk-UA',{weekday:'short'}); return pad(d.getDate())+'.'+pad(d.getMonth()+1);};
  const linkify=h=>h.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>');
  const convOpen=id=>{const s=scr('conv'); return stack.includes('conv')&&s._chat===String(id)?s:null;};
  PM.presQ=Promise.resolve();
  const presence=chatId=>{PM.presQ=PM.presQ.then(()=>meApi('POST','/me/presence',{chatId}).catch(()=>{})); return PM.presQ;};
  function openChat(id,focusId){while(stack.includes('conv')) pop(); go('conv',x=>P.conv(x,String(id),focusId||null));}
  async function openDirect(empId){
    const e=emp(empId); if(e&&!e.tg_linked){toast('Колега ще не підключив Telegram-бота'); return;}
    try{const c=await meApi('POST','/me/chats/direct',{employeeId:empId}); upsertChat(c); if(!stack.includes('chatlist')) go('chatlist',P.chatlist); openChat(c.id);}
    catch(e){if(e.code===404) toast('Колега ще не підключив Telegram-бота'); else fail(e);}}
  function connect(){
    if(PM.es) PM.es.close();
    if(!PM.token){setTimeout(()=>session().then(connect),5000); return;}
    const es=PM.es=new EventSource(API+'/me/stream?t='+encodeURIComponent(PM.token));
    const on=(t,f)=>es.addEventListener(t,ev=>{let d; try{d=JSON.parse(ev.data);}catch(e){return;} f(d);});
    es.onopen=()=>{if(PM.down){PM.down=false; loadChats(); const c=scr('conv'); if(stack.includes('conv')&&c._catchup) c._catchup();}};
    // Network blips: EventSource retries by itself. A 401 (expired token) closes it — re-mint.
    es.onerror=()=>{PM.down=true; if(es.readyState===2){PM.backoff=Math.min(60000,(PM.backoff||1500)*2); setTimeout(async()=>{await session(); connect();},PM.backoff);}};
    es.addEventListener('open',()=>{PM.backoff=0;});
    on('message',m=>{PM.live=(PM.live||0)+1; const c=chatById(m.chatId), cv=convOpen(m.chatId);
      PM.typing.delete(m.chatId);
      if(!c){loadChats(); return;}
      c.last=m; c.lastAt=m.createdAt; if(m.senderId!==TG.me.id&&!(cv&&!document.hidden)) c.unread++;
      upsertChat(c); if(cv&&cv._onMsg) cv._onMsg(m); badges(); redraw('chatlist');});
    on('message_update',m=>{const c=chatById(m.chatId); if(c&&c.last&&c.last.id===m.id) c.last=m; const cv=convOpen(m.chatId); if(cv&&cv._onUpd) cv._onUpd(m); redraw('chatlist');});
    on('read',r=>{const c=chatById(r.chatId); if(!c) return; const mm=c.members.find(x=>x.id===r.employeeId); if(mm) mm.lastRead=r.lastRead;
      if(r.employeeId===TG.me.id&&c.last&&+r.lastRead>=+c.last.id){c.unread=0; badges(); redraw('chatlist');}
      const cv=convOpen(r.chatId); if(cv&&cv._draw) cv._draw();});
    on('typing',t=>{PM.typing.set(t.chatId,{id:t.employeeId,until:Date.now()+4500}); const cv=convOpen(t.chatId); if(cv&&cv._head) cv._head(); redraw('chatlist');
      setTimeout(()=>{const cv2=convOpen(t.chatId); if(cv2&&cv2._head) cv2._head(); redraw('chatlist');},4700);});
    on('chat',c=>{PM.live=(PM.live||0)+1; upsertChat(c); badges(); redraw('chatlist'); const cv=convOpen(c.id); if(cv&&cv._draw){cv._head(); cv._draw();} redraw('chatinfo');});
    on('event',e=>{PM.ev.set(e.id,e); redraw('calendar'); const es=scr('event'); if(stack.includes('event')&&es._id===e.id) P.event(es,e.id); loadInvites();});
    on('event_removed',d=>{PM.ev.delete(d.id); redraw('calendar'); const es=scr('event'); if(stack.includes('event')&&es._id===d.id){while(stack.includes('event')) pop(); toast('Подію скасовано');} loadInvites();});
    on('task',t=>{if(!PM.tasks) return; const i=PM.tasks.findIndex(x=>x.id===t.id); if(i>=0) PM.tasks[i]=t; else PM.tasks.unshift(t); redraw('tasks'); badges();});
    on('task_removed',d=>{if(!PM.tasks) return; PM.tasks=PM.tasks.filter(x=>x.id!==d.id); redraw('tasks'); badges();});
    on('chat_removed',d=>{PM.chats=(PM.chats||[]).filter(c=>c.id!==d.chatId); badges(); redraw('chatlist');
      if(convOpen(d.chatId)){while(stack.length&&stack[stack.length-1]!=='chatlist') pop(); toast('Вас більше немає в цьому чаті');}});
  }
  document.addEventListener('visibilitychange',()=>{const s=scr('conv'); if(!personal()||!stack.includes('conv')||!s._chat) return;
    presence(document.hidden?null:s._chat); if(!document.hidden&&s._readLast) s._readLast();});
  const tasksDue=()=>{if(!PM.tasks) return 0; const end=new Date(); end.setHours(23,59,59,999); return PM.tasks.filter(t=>!t.done&&t.assigneeId===TG.me.id&&t.dueAt&&new Date(t.dueAt)<=end).length;};

  function setZ(){scr('home').style.zIndex=0; stack.forEach((id,i)=>scr(id).style.zIndex=i+1);}
  function go(id,build){if(build)build(scr(id)); if(!stack.includes(id))stack.push(id); setZ(); const s=scr(id); void s.offsetWidth; s.classList.add('show');}
  function pop(){const id=stack.pop(); const s=scr(id); if(s._stop){s._stop();s._stop=null;} s.classList.remove('show'); setZ(); return id;}
  function back(){if(!stack.length){close();return;} pop();}
  function home(){while(stack.length)pop();}
  function popIf(id){if(stack[stack.length-1]===id) pop();}
  function open(){app.dataset.phone='1'; phone.setAttribute('aria-hidden','false'); tick(); badges();}
  function close(){delete app.dataset.phone; phone.setAttribute('aria-hidden','true');}

  const R={
    contacts(s){const es=O.state.employees;
      s.innerHTML=head('Контакти')+`<div class="psearch"><input placeholder="Пошук колеги" data-q></div><div class="pscroll" data-list></div>`;
      const box=s.querySelector('[data-list]');
      function draw(q){if(!es.length){box.innerHTML=empty('Ще немає колег','Додайте співробітників у режимі будівника — вкладка «Люди».');return;}
        const r=es.filter(e=>!q||(e.name+' '+e.dept+' '+(e.position||'')).toLowerCase().includes(q));
        box.innerHTML=r.length?r.map(e=>rowHTML(e)).join(''):empty('Нічого не знайшли','Спробуйте інше ім\'я або відділ.');
        box.querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>go('contact',x=>R.contact(x,el.dataset.id)));}
      draw(''); s.querySelector('[data-q]').oninput=e=>draw(e.target.value.trim().toLowerCase()); wire(s);}
,
    contact(s,id){const e=emp(id),st=STATUS[statusOf(e)];
      s.innerHTML=head('')+`<div class="pdetail">${avHTML(e,'av big')}<div class="nm">${esc(e.name)}</div><div class="dp">${esc(e.dept)}${e.position?' · '+esc(e.position):''}</div><div class="status" style="color:${st.c}">${st.icon} ${st.n}</div>
        <div class="pactions"><button class="pact" data-call>${IC.phone}Подзвонити</button><button class="pact" data-msg>${IC.chat}Написати</button><button class="pact" data-loc>${IC.pin}Знайти</button></div>
        <div class="pfields">${e.email?fld('Email',e.email):''}${e.phone?fld('Телефон',e.phone):''}${e.ext?fld('Робочий №',e.ext):''}${fld('Відділ',e.dept)}</div></div>`;
      s.querySelector('[data-call]').onclick=()=>callPerson(id);
      s.querySelector('[data-msg]').onclick=()=>personal()?openDirect(id):go('chatlist',appFor('chatlist'));
      s.querySelector('[data-loc]').onclick=()=>{notify(id,'mark'); close(); focusEmployee(id,true);}; wire(s);}
,
    calls(s){
      const es=O.state.employees.filter(e=>!TG.me||e.id!==TG.me.id).sort((x,y)=>x.name.localeCompare(y.name,'uk'));
      s.innerHTML=head('Дзвінки')+'<div class="psearch"><input placeholder="Кому подзвонити?" data-q></div><div class="pscroll" data-list></div>';
      const box=s.querySelector('[data-list]');
      const how=e=>PM.contacts.get(e.id)?'Telegram · @'+PM.contacts.get(e.id):e.phone?'Телефон · '+e.phone:'Немає контакту';
      const draw=q=>{const r=es.filter(e=>!q||(e.name+' '+(e.dept||'')).toLowerCase().includes(q));
        box.innerHTML=r.length?r.map(e=>rowHTML(e,how(e))).join(''):empty(es.length?'Нікого не знайшли':'Немає колег','');
        box.querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>callPerson(el.dataset.id));};
      draw(''); s.querySelector('[data-q]').oninput=e=>draw(e.target.value.trim().toLowerCase()); wire(s);}
,
    coffee(s){
      const drinks=[['Еспресо','☕'],['Американо','☕'],['Капучино','🥛'],['Лате','🥛'],['Раф','🥛'],['Чай','🍵']];
      let pick='Капучино', size='M';
      // Server keeps an allow-list (COFFEE_ALLOWED); known-refused Mini App users get a locked screen.
      if(TG.active&&TG.canCoffee===false){ s.innerHTML=head('Кава')+`<div class="pscroll" style="padding:28px 18px;text-align:center"><div style="font-size:40px;margin-bottom:10px">☕🔒</div><div style="font-weight:800;margin-bottom:6px">Замовлення кави недоступне</div><div style="font-size:13px;color:var(--muted);font-weight:600">Ця функція доступна лише керівництву.</div></div>`; wire(s); return; }
      s.innerHTML=head('Кава')+`<div class="pscroll" style="padding:16px">
        <div style="font-size:12px;font-weight:800;color:var(--muted);margin-bottom:9px;text-transform:uppercase;letter-spacing:.04em">Напій</div>
        <div class="pchips" data-drink style="margin-bottom:18px">${drinks.map(d=>`<button class="pchip" data-v="${d[0]}" aria-pressed="${d[0]===pick}">${d[1]} ${d[0]}</button>`).join('')}</div>
        <div style="font-size:12px;font-weight:800;color:var(--muted);margin-bottom:9px;text-transform:uppercase;letter-spacing:.04em">Розмір</div>
        <div class="pchips" data-size style="margin-bottom:22px">${['S','M','L'].map(z=>`<button class="pchip" data-v="${z}" aria-pressed="${z===size}">${z}</button>`).join('')}</div>
        <button class="pbtn" data-order>${IC.coffee}Замовити на кухню</button>
        <div style="text-align:center;font-size:11.5px;color:var(--muted);font-weight:700;margin-top:12px">Принесуть до вашого столу ☕</div></div>`;
      s.querySelectorAll('[data-drink] .pchip').forEach(b=>b.onclick=()=>{pick=b.dataset.v; b.parentElement.querySelectorAll('.pchip').forEach(x=>x.setAttribute('aria-pressed',x===b));});
      s.querySelectorAll('[data-size] .pchip').forEach(b=>b.onclick=()=>{size=b.dataset.v; b.parentElement.querySelectorAll('.pchip').forEach(x=>x.setAttribute('aria-pressed',x===b));});
      s.querySelector('[data-order]').onclick=()=>{
        try{const h={'content-type':'application/json'}; if(TG.active) h['X-Telegram-Init-Data']=TG.initData; fetch(API+'/coffee',{method:'POST',headers:h,body:JSON.stringify({drink:pick,size})}).then(r=>{ if(r.status===403) toast('Замовлення кави доступне лише керівництву 🔒'); }).catch(()=>{});}catch(e){}
        toast(`Замовлено: ${pick} (${size}) ☕`); home(); close();}; wire(s);}
,
    // Announcements (spec 005): in Telegram → office or my department chat; on the web → HR
    // with the access code, to the office or any department. Delivered as a 📢 chat post +
    // a Telegram push to everyone (muted chats too).
    broadcast(s){
      const tg=personal(), depts=tg?[TG.me.dept||(emp(TG.me.id)||{}).dept].filter(Boolean):[...new Set(O.state.employees.map(e=>(e.dept||'').trim()).filter(Boolean))];
      let aud='office';
      s.innerHTML=head('Оголошення')+`<div class="pbroad"><div style="font-size:12px;font-weight:800;color:var(--muted)">Кому</div><div class="pchips" data-aud><button class="pchip" data-a="office" aria-pressed="true">🏢 Весь офіс</button>${depts.map(d=>`<button class="pchip" data-a="${esc(d)}">🏷️ ${esc(d)}</button>`).join('')}</div><textarea placeholder="Напишіть оголошення для команди…" data-txt maxlength="4000"></textarea><div style="font-size:11.5px;color:var(--muted);font-weight:600">Прийде всім у чат і сповіщенням у Telegram.</div><button class="pbtn" data-send>${IC.send}Надіслати</button></div>`;
      s.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{aud=b.dataset.a; s.querySelectorAll('[data-a]').forEach(x=>x.setAttribute('aria-pressed',x===b));});
      s.querySelector('[data-send]').onclick=async()=>{const v=s.querySelector('[data-txt]').value.trim(); if(!v){toast('Напишіть текст оголошення'); return;}
        try{
          if(tg) await meApi('POST','/me/announce',{target:aud==='office'?'office':'dept',text:v});
          else{const tok=getToken(); if(!tok){toast('Оголошення надсилає HR — увійдіть з кодом доступу'); return;}
            const r=await fetch(API+'/announce',{method:'POST',headers:{'content-type':'application/json','X-Edit-Token':tok},body:JSON.stringify({target:aud,text:v})});
            if(r.status===401||r.status===503){toast('Невірний код доступу'); return;} if(r.status===404){toast('У цьому відділі ще ніхто не підключив бота'); return;} if(!r.ok) throw new Error('http '+r.status);}
          toast('📢 Оголошення надіслано'); home();}
        catch(e){if(e.code===403) toast('Оголошення можуть надсилати лише відповідальні особи'); else fail(e);}}; wire(s);}
,
    profile(s){
      const me=TG.me?(emp(TG.me.id)||TG.me):null;
      if(!me){ s.innerHTML=head('Мій профіль')+empty('Профіль недоступний','Відкрий офіс через Telegram-бота, щоб керувати своїм профілем.'); wire(s); return; }
      const e=me;
      const chip=(v,label,on)=>`<button class="pchip" data-v="${v}" aria-pressed="${on}">${label}</button>`;
      const ttl=t=>`<div style="font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:16px 2px 8px">${t}</div>`;
      s.innerHTML=head('Мій профіль')+`<div class="pscroll">
        <div class="pdetail" style="padding-bottom:6px">${avHTML(e,'av big')}<div class="nm">${esc(e.name)}</div><div class="dp">${esc(e.dept)}${e.position?' · '+esc(e.position):''}</div>
          <label class="pbtn" style="cursor:pointer;margin-top:14px;width:100%">📷 Змінити фото<input type="file" accept="image/*" data-photo style="display:none"></label></div>
        <div style="padding:0 16px 18px">
          ${ttl('Статус')}<div class="pchips" data-status>${Object.keys(STATUS).map(k=>chip(k,`${STATUS[k].icon} ${STATUS[k].n}`,statusOf(e)===k)).join('')}</div>
          ${ttl('Настрій')}<div class="pchips" data-mood>${Object.keys(MOODS).map(k=>chip(k,`${MOODS[k].e} ${MOODS[k].n}`,(e.mood||'good')===k)).join('')}</div>
          ${ttl('Колір аватара')}<div class="pchips" data-color>${DEPT_COLORS.map(c=>`<button class="pchip" data-c="${c}" title="колір" style="background:${c};width:32px;height:32px;padding:0;border-radius:50%;border:none${(e.color===c&&!e.photo)?';outline:3px solid var(--ink);outline-offset:2px':''}"></button>`).join('')}</div>
          ${TG.active?`${ttl('День народження')}<div class="row2" style="display:flex;gap:8px"><input class="field" data-bday placeholder="ДД.ММ" inputmode="numeric" maxlength="5" value="${TG.me&&TG.me.birthday?TG.me.birthday.slice(3)+'.'+TG.me.birthday.slice(0,2):''}" style="flex:1;height:40px;border-radius:12px;border:1.5px solid var(--line);padding:0 12px;font:inherit;font-weight:700;background:var(--panel-solid);color:var(--ink)"><button class="pbtn sm" data-bdsave style="padding:0 16px">Зберегти</button></div><div style="font-size:11.5px;color:var(--muted);font-weight:600;margin-top:6px">Привітаємо в чаті офісу 🎂 Рік не потрібен і нікому не показується.</div>`:''}
        </div></div>`;
      const bs=s.querySelector('[data-bdsave]'); if(bs) bs.onclick=async()=>{const v=s.querySelector('[data-bday]').value.trim();
        try{const u=await apiEmpWrite('PUT','/employees/'+e.id,{birthday:v||null}); if(TG.me) TG.me.birthday=u&&u.birthday||null;
          toast(v&&!(u&&u.birthday)?'Не схоже на дату — формат ДД.ММ':v?'Збережено 🎂':'День народження прибрано'); R.profile(s);}catch(err){toast('Не вдалося зберегти');}};
      const save=()=>{ empUpsert(e); syncAvatars(); renderPeople(); renderLabels(); };
      s.querySelectorAll('[data-status] .pchip').forEach(b=>b.onclick=()=>{ e.status=b.dataset.v; save(); R.profile(s); });
      s.querySelectorAll('[data-mood] .pchip').forEach(b=>b.onclick=()=>{ e.mood=b.dataset.v; save(); R.profile(s); });
      s.querySelectorAll('[data-color] [data-c]').forEach(b=>b.onclick=()=>{ e.color=b.dataset.c; e.photo=null; save(); R.profile(s); });
      s.querySelector('[data-photo]').onchange=ev=>{ const f=ev.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ e.photo=rd.result; save(); toast('Фото оновлено'); R.profile(s); }; rd.readAsDataURL(f); };
      wire(s);}
,
    settings(s){
      const dark=settings.theme==='dark';
      let sound=load('alliancesim.phone.sound',true), notif=load('alliancesim.phone.notif',true);
      s.innerHTML=head('Налаштування')+`<div class="pscroll">
        <div class="psetrow"><div><div class="lb">Темна тема</div><div class="sub">Змінює вигляд офісу й телефону</div></div><div class="ptog" data-set="dark" aria-pressed="${dark}"></div></div>
        <div class="psetrow"><div><div class="lb">Звук дзвінка</div></div><div class="ptog" data-set="sound" aria-pressed="${sound}"></div></div>
        <div class="psetrow"><div><div class="lb">Сповіщення</div></div><div class="ptog" data-set="notif" aria-pressed="${notif}"></div></div>
        <div class="psetrow"><div class="lb">Версія</div><div class="sub">AllianceOS 1.0</div></div></div>`;
      s.querySelectorAll('.ptog').forEach(t=>t.onclick=()=>{const on=t.getAttribute('aria-pressed')!=='true'; t.setAttribute('aria-pressed',on);
        const k=t.dataset.set;
        if(k==='dark'){settings.theme=on?'dark':'pastel'; applySettings();}
        else if(k==='sound') save('alliancesim.phone.sound',on);
        else save('alliancesim.phone.notif',on);}); wire(s);}
  };

  // ── personal apps (Telegram user with a linked character) ──
  const P={
    calendar(s){
      const DOW=['Пн','Вт','Ср','Чт','Пт','Сб','Нд'], MON=['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
      const today=new Date(); today.setHours(0,0,0,0);
      const wd=d=>(d.getDay()+6)%7, same=(a,b)=>a.toDateString()===b.toDateString();
      if(!s._view){s._view=new Date(today.getFullYear(),today.getMonth(),1); s._sel=new Date(today);}
      let evs=[];
      const evOn=d=>{const d1=new Date(d); d1.setDate(d1.getDate()+1); return evs.filter(e=>{const a=new Date(e.startsAt), b=e.endsAt?new Date(e.endsAt):a; return a<d1&&b>=d;});};
      async function load(){const v=s._view, from=new Date(v); from.setDate(1-wd(v)); const to=new Date(from); to.setDate(to.getDate()+43);
        try{const want=s._view; const got=await meApi('GET',`/me/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`); got.forEach(e=>PM.ev.set(e.id,e)); if(s._view!==want) return; evs=got; draw();}catch(e){}}
      function draw(){
        const view=s._view, sel=s._sel, y=view.getFullYear(), m=view.getMonth(), lead=wd(new Date(y,m,1)), dim=new Date(y,m+1,0).getDate();
        let cells=''; for(let i=0;i<lead;i++) cells+='<div></div>';
        for(let dn=1;dn<=dim;dn++){const d=new Date(y,m,dn);
          cells+=`<button class="pcell${same(d,sel)?' sel':''}${same(d,today)?' tod':''}" data-d="${dn}"><span>${dn}</span>${evOn(d).length?'<i></i>':''}</button>`;}
        const list=evOn(sel);
        const row=(e,i)=>{const a=new Date(e.startsAt), b=e.endsAt?new Date(e.endsAt):null;
          const tm=(e.allDay?'Весь день':hm(a)+(b?'–'+hm(b):''))+(e.repeat?' 🔁':'');
          const tag=e.myStatus==='pending'?'<span class="ptag">очікує відповіді</span>':(e.organizerId!==TG.me.id?`<span class="ptag muted">від ${esc(first(e.organizerId))}</span>`:'');
          return `<div class="pev ${e.myStatus==='declined'?'declined':''}" data-ev="${e.id}" data-i="${i}"><div class="bar" style="background:${esc(e.color||'#5B76E6')}"></div><div style="flex:1;min-width:0"><div class="tm">${tm}${tag}</div><div class="tt">${esc(e.title)}</div>${e.place?`<div class="pl">📍 ${esc(e.place)}</div>`:''}</div></div>`;};
        s.innerHTML=headP('Календар','<button class="act" data-new aria-label="Нова подія">+</button>')+
          `<div class="pcalbar"><button class="bk" data-prev>${IC.back}</button><div class="ti">${MON[m]} ${y}</div><button class="bk" data-next style="transform:scaleX(-1)">${IC.back}</button></div>
           <div class="pcalgrid">${DOW.map(x=>`<div class="pdowc">${x}</div>`).join('')}</div>
           <div class="pcalgrid" style="padding-bottom:6px">${cells}</div>
           <div class="pscroll" style="border-top:1px solid var(--line);padding:4px 0">
             <div style="padding:9px 16px 4px;font-size:13px;font-weight:900">${esc(dayLabel(sel))}${same(sel,today)?' · сьогодні':''}</div>
             ${list.length?list.map(row).join(''):'<div style="padding:26px 16px;text-align:center;color:var(--muted);font-weight:700;font-size:13px">Немає запланованих справ<br><span style="font-weight:600;font-size:12px">Натисніть «+», щоб додати подію чи нотатку</span></div>'}
           </div>`;
        s.querySelector('[data-prev]').onclick=()=>{s._view=new Date(y,m-1,1); draw(); load();};
        s.querySelector('[data-next]').onclick=()=>{s._view=new Date(y,m+1,1); draw(); load();};
        s.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>{s._sel=new Date(y,m,+b.dataset.d); draw();});
        s.querySelectorAll('[data-ev]').forEach(b=>b.onclick=()=>{const o=list[+b.dataset.i]; if(o) PM.ev.set(o.id,o); go('event',x=>P.event(x,b.dataset.ev));});
        s.querySelector('[data-new]').onclick=()=>go('evform',x=>P.evform(x,null,s._sel));
        wire(s);
      }
      s._redraw=load; draw(); load();}
,
    event(s,id){
      const e=PM.ev.get(id);
      if(!e){s.innerHTML=head('Подія')+empty('Подію не знайдено','Можливо, її скасували.'); wire(s); return;}
      const a=new Date(e.startsAt), b=e.endsAt?new Date(e.endsAt):null, mineOrg=e.organizerId===TG.me.id;
      const when=dayLabel(a)+(e.allDay?' · весь день':', '+hm(a)+(b?'–'+hm(b):''));
      s.innerHTML=head('Подія')+`<div class="pscroll"><div class="pinfo">
        <div style="height:5px;width:44px;border-radius:3px;background:${esc(e.color||'#5B76E6')};margin-top:8px"></div>
        <div class="h">${esc(e.title)}</div>
        <div class="r"><span class="k">Коли</span><span>${esc(when)}</span></div>
        ${e.place?`<div class="r"><span class="k">Де</span><span>${e.room?'🚪 ':''}${esc(e.place)}</span></div>`:''}
        ${e.repeat?`<div class="r"><span class="k">Повтор</span><span>🔁 ${REPEAT_TXT[e.repeat]||''}${e.repeatUntil?' до '+esc(dayLabel(new Date(e.repeatUntil))):''}</span></div>`:''}
        ${e.note?`<div class="r"><span class="k">Нотатка</span><span style="white-space:pre-wrap">${esc(e.note)}</span></div>`:''}
        ${mineOrg?'':`<div class="r"><span class="k">Організатор</span><span>${esc(nameOf(e.organizerId))}</span></div>`}
        <div data-extra></div>
        ${e.allDay?'':`<div style="font-size:11.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:16px 0 8px">Нагадування в Telegram</div>
        ${chipsHTML('data-remind',REMIND,e.remindMin)}`}
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:20px">
          ${mineOrg?`<button class="pbtn ghost sm" data-edit>Редагувати</button><button class="pbtn danger sm" data-del>Видалити подію</button>`:''}
        </div></div></div>`;
      s._id=id;
      const rmb=s.querySelector('[data-remind]'); if(rmb) pickChip(rmb,async v=>{try{const u=await meApi('PATCH','/me/events/'+id,{remindMin:v?+v:null}); PM.ev.set(id,u); toast(v?'Нагадаю в Telegram':'Нагадування вимкнено');}catch(err){fail(err);}});
      const ed=s.querySelector('[data-edit]'); if(ed) ed.onclick=()=>go('evform',x=>P.evform(x,id));
      const del=s.querySelector('[data-del]'); if(del) confirm2(del,'Точно видалити?',async()=>{try{await meApi('DELETE','/me/events/'+id); PM.ev.delete(id); popIf('event'); redraw('calendar'); toast('Подію видалено');}catch(err){fail(err);}});
      if(P._eventExtra) P._eventExtra(s,e);
      wire(s);}
,
    evform(s,id,day){
      const e=id?PM.ev.get(id):null;
      // Editing a repeating event edits the series → start from the series' first date.
      const st=e?new Date(e.seriesStart||e.startsAt):(()=>{const d=new Date(day||Date.now()); d.setHours(10,0,0,0); return d;})();
      const en=e?(e.endsAt?new Date(st.getTime()+(new Date(e.endsAt)-new Date(e.startsAt))):null):new Date(st.getTime()+3600e3);
      let allDay=e?e.allDay:false, color=e?(e.color||PALETTE[5]):PALETTE[5], rem=e?e.remindMin:30, room=e?e.room:null, repeat=e?e.repeat:null;
      const rooms=meetingRooms(), busy={day:null,list:[]};
      s.innerHTML=head(e?'Редагувати подію':'Нова подія')+`<div class="pscroll"><form class="pform" data-f>
        <label class="k">Назва</label><input type="text" data-title maxlength="200" placeholder="Зустріч, нотатка, нагадування…" value="${esc(e?e.title:'')}">
        <div class="psetrow" style="padding:4px 2px;border:0"><div class="lb">Весь день / нотатка</div><div class="ptog" data-allday aria-pressed="${allDay}"></div></div>
        <label class="k">${e&&e.repeat?'Дата початку серії':'Дата'}</label><input type="date" data-date value="${dKey(st)}">
        <div class="row2" data-times><div><label class="k">Початок</label><input type="time" data-st value="${hm(st)}" style="margin-top:10px"></div><div><label class="k">Кінець</label><input type="time" data-en value="${en?hm(en):''}" style="margin-top:10px"></div></div>
        <label class="k">Повторювати</label>${chipsHTML('data-repeat',REPEAT,repeat)}
        <div data-untilw style="display:none;flex-direction:column;gap:12px"><label class="k">До дати (необов’язково)</label><input type="date" data-until value="${e&&e.repeatUntil?dKey(new Date(e.repeatUntil)):''}"></div>
        <label class="k">Де</label>
        ${rooms.length?`<div class="pchips" data-rooms>${rooms.map(r=>`<button type="button" class="pchip" data-room="${esc(r.key)}" aria-pressed="${r.key===room}">🚪 ${esc(r.name)}</button>`).join('')}</div><div data-roominfo style="font-size:12px;font-weight:700;margin-top:-4px"></div>`:''}
        <input type="text" data-place maxlength="200" placeholder="${rooms.length?'…або інше місце':'Переговорна, кабінет…'}" value="${esc(e&&e.place||'')}">
        <label class="k">Нотатка</label><textarea data-note maxlength="2000" placeholder="Необов’язково">${esc(e&&e.note||'')}</textarea>
        <label class="k">Колір</label><div class="pchips" data-color>${PALETTE.map(c=>`<button type="button" class="pchip" data-c="${c}" style="background:${c};width:30px;height:30px;padding:0;border-radius:50%;border:none${c===color?';outline:3px solid var(--ink);outline-offset:2px':''}"></button>`).join('')}</div>
        ${e?'':`<div data-remwrap style="display:flex;flex-direction:column;gap:12px"><label class="k">Нагадування</label>${chipsHTML('data-remind',REMIND,rem)}</div>`}
        <div data-invite></div>
        <button class="pbtn" type="submit">${e?'Зберегти':'Створити'}</button>
      </form></div>`;
      const f=s.querySelector('[data-f]'), times=s.querySelector('[data-times]'), tog=s.querySelector('[data-allday]'), placeIn=s.querySelector('[data-place]');
      const val=sel=>s.querySelector(sel).value;
      // The chosen slot as Dates (null when all-day / incomplete).
      const slot=()=>{const d=val('[data-date]'); if(!d||allDay) return null; const a=fromInputs(d,val('[data-st]')||'09:00'), b=val('[data-en]')?fromInputs(d,val('[data-en]')):new Date(a.getTime()+3600e3); return {a,b};};
      const clash=key=>{const sl=slot(); return sl?busy.list.find(x=>x.room===key&&x.eventId!==id&&new Date(x.start)<sl.b&&new Date(x.end)>sl.a):null;};
      function drawRooms(){const box=s.querySelector('[data-rooms]'); if(!box) return;
        box.querySelectorAll('[data-room]').forEach(b=>{const c=clash(b.dataset.room); b.setAttribute('aria-pressed',b.dataset.room===room); b.classList.toggle('busy',!!c);});
        const info=s.querySelector('[data-roominfo]'), c=room?clash(room):null;
        info.innerHTML=!room?'':c?`<span style="color:var(--red)">🔴 Зайнято ${hm(new Date(c.start))}–${hm(new Date(c.end))}${c.organizer?' · '+esc(c.organizer):''} — оберіть інший час або кімнату</span>`:(slot()?'<span style="color:#2e9b57">🟢 Вільна на цей час</span>':'');}
      async function loadBusy(){const d=val('[data-date]'); if(!rooms.length||!d||busy.day===d){drawRooms(); return;}
        busy.day=d; const a=fromInputs(d,'00:00'), b=new Date(a.getTime()+864e5);
        try{busy.list=await meApi('GET',`/me/rooms?from=${encodeURIComponent(a.toISOString())}&to=${encodeURIComponent(b.toISOString())}`);}catch(err){busy.list=[];} drawRooms();}
      s.querySelectorAll('[data-rooms] [data-room]').forEach(b=>b.onclick=()=>{if(room===b.dataset.room){room=null;} else {room=b.dataset.room; placeIn.value=(rooms.find(r=>r.key===room)||{}).name||placeIn.value;} drawRooms();});
      placeIn.oninput=()=>{const r=rooms.find(x=>x.name===placeIn.value.trim()); room=r?r.key:null; drawRooms();};
      ['[data-date]','[data-st]','[data-en]'].forEach(q=>s.querySelector(q).addEventListener('change',loadBusy));
      const syncAD=()=>{tog.setAttribute('aria-pressed',allDay); times.style.display=allDay?'none':''; const rw=s.querySelector('[data-remwrap]'); if(rw) rw.style.display=allDay?'none':''; drawRooms();}; syncAD();
      tog.onclick=()=>{allDay=!allDay; syncAD();};
      const untilW=s.querySelector('[data-untilw]'), syncRep=()=>{untilW.style.display=repeat?'flex':'none';}; syncRep();
      pickChip(s.querySelector('[data-repeat]'),v=>{repeat=v||null; syncRep();});
      s.querySelectorAll('[data-color] [data-c]').forEach(b=>b.onclick=()=>{color=b.dataset.c; s.querySelectorAll('[data-color] [data-c]').forEach(x=>x.style.outline=x===b?'3px solid var(--ink)':'none'); b.style.outlineOffset='2px';});
      const rb=s.querySelector('[data-remind]'); if(rb) pickChip(rb,v=>{rem=v?+v:null;});
      const inv=P._inviteField?P._inviteField(s.querySelector('[data-invite]'),e):null;
      loadBusy();
      f.onsubmit=async ev=>{ev.preventDefault();
        const title=val('[data-title]').trim(), date=val('[data-date]');
        if(!title){toast('Вкажіть назву'); return;} if(!date){toast('Вкажіть дату'); return;}
        let startsAt, endsAt=null;
        if(allDay) startsAt=fromInputs(date,'00:00');
        else {const sv=val('[data-st]')||'09:00', evv=val('[data-en]'); startsAt=fromInputs(date,sv); if(evv){endsAt=fromInputs(date,evv); if(endsAt<=startsAt){toast('Кінець має бути пізніше початку'); return;}}}
        const until=val('[data-until]');
        const body={title,startsAt:startsAt.toISOString(),endsAt:endsAt?endsAt.toISOString():null,allDay,place:placeIn.value,note:val('[data-note]'),color,
          room:allDay?null:room,repeat,repeatUntil:repeat&&until?fromInputs(until,'00:00').toISOString():null};
        if(!e) body.remindMin=allDay?null:rem;
        if(inv) body.attendeeIds=inv();
        try{const u=e?await meApi('PATCH','/me/events/'+id,body):await meApi('POST','/me/events',body); PM.ev.set(u.id,u);
          const c=scr('calendar'); c._sel=new Date(startsAt); c._sel.setHours(0,0,0,0); c._view=new Date(c._sel.getFullYear(),c._sel.getMonth(),1);
          popIf('evform'); if(e){const es=scr('event'); if(stack.includes('event')) P.event(es,u.id);} redraw('calendar'); toast(e?'Збережено':'Подію створено');
          refreshLive();
        }catch(err){fail(err);}};
      wire(s);}
,
    chatlist(s){
      s.innerHTML=headP('Чати','<button class="act" data-new aria-label="Новий чат">+</button>')+`<div class="psearch"><input placeholder="Пошук чатів і повідомлень" data-q></div><div class="pscroll" data-list></div>`;
      const box=s.querySelector('[data-list]'); let q='', found=[], st=null;
      const preview=(c,l)=>{if(!l) return 'Немає повідомлень'; if(l.deleted) return 'Повідомлення видалено';
        const txt=esc(l.text||(l.attachment?(/^audio\//.test(l.attachment.mime)?'🎤 Голосове':'📎 '+l.attachment.name):'…'));
        if(l.kind==='announce') return '📢 '+txt; if(l.kind==='system') return txt;
        return (l.senderId===TG.me.id?'Ви: ':(c.kind!=='direct'&&l.senderId?esc(first(l.senderId))+': ':''))+txt;};
      function draw(){
        if(!PM.chats){box.innerHTML=empty('Завантаження…',''); return;}
        const list=PM.chats.filter(c=>!q||chatTitle(c).toLowerCase().includes(q));
        let h=list.map(c=>{const l=c.last, ty=typingIn(c.id);
          const prev=ty?`<i>${esc(first(ty))} друкує…</i>`:preview(c,l);
          return `<div class="prow" data-c="${c.id}">${chatAv(c)}<div class="tx"><div class="nm">${esc(chatTitle(c))}${c.muted?' 🔕':''}</div><div class="sub">${prev}</div></div><div class="meta pcm"><span>${l?shortTime(l.createdAt):''}</span>${c.unread?`<b class="pun${c.muted?' m':''}">${c.unread}</b>`:''}</div></div>`;}).join('');
        // Message hits (server search) under the chat matches.
        const hits=found.map(m=>{const c=chatById(m.chatId); return c?`<div class="prow" data-c="${c.id}" data-f="${m.id}">${chatAv(c)}<div class="tx"><div class="nm">${esc(chatTitle(c))}</div><div class="sub">${m.senderId===TG.me.id?'Ви: ':esc(first(m.senderId||''))+': '}${esc(m.text)}</div></div><div class="meta pcm"><span>${shortTime(m.createdAt)}</span></div></div>`:'';}).join('');
        if(q&&hits) h+=`<div class="psec">Повідомлення</div>`+hits;
        box.innerHTML=h||empty(q?'Нічого не знайшли':'Ще немає чатів',q?'':'Натисніть «+», щоб написати колезі.');
        box.querySelectorAll('[data-c]').forEach(el=>el.onclick=()=>openChat(el.dataset.c,el.dataset.f));}
      s.querySelector('[data-q]').oninput=e=>{q=e.target.value.trim().toLowerCase(); found=[]; draw(); clearTimeout(st);
        if(q.length>=2){const want=q; st=setTimeout(async()=>{try{const r=await meApi('GET','/me/search?q='+encodeURIComponent(want)); if(want===q){found=r; draw();}}catch(err){}},300);}};
      s.querySelector('[data-new]').onclick=()=>go('chatnew',P.chatnew);
      s._redraw=draw; draw(); loadChats(); wire(s);}
,
    chatnew(s){
      const es=O.state.employees.filter(e=>e.tg_linked&&e.id!==TG.me.id).sort((a,b)=>a.name.localeCompare(b.name,'uk'));
      s.innerHTML=head('Новий чат')+`<div data-grp></div><div class="psearch"><input placeholder="Пошук колеги" data-q></div><div class="pscroll" data-list></div>`;
      if(P._groupEntry) P._groupEntry(s.querySelector('[data-grp]'));
      const box=s.querySelector('[data-list]');
      const draw=q=>{const r=es.filter(e=>!q||(e.name+' '+(e.dept||'')).toLowerCase().includes(q));
        box.innerHTML=r.length?r.map(e=>rowHTML(e)).join(''):empty(es.length?'Нікого не знайшли':'Поки нікого немає',es.length?'':'Колеги з’являться тут, щойно підключать Telegram-бота.');
        box.querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>{pop(); openDirect(el.dataset.id);});};
      draw(''); s.querySelector('[data-q]').oninput=e=>draw(e.target.value.trim().toLowerCase()); wire(s);}
,
    conv(s,chatId,focusId){
      const C=()=>chatById(chatId);
      if(!C()){s.innerHTML=head('Чат')+empty('Чат недоступний',''); wire(s); return;}
      s._chat=chatId; let msgs=[], hasMore=false, editing=null, replying=null, loaded=false, lastTyping=0;
      s.innerHTML=`<div class="phead"><button class="bk" data-back>${IC.back}</button><span data-hav></span><div style="min-width:0;flex:1;cursor:pointer" data-info><div class="ti" style="font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" data-title></div><div class="sub" style="font-size:11px;color:var(--muted);font-weight:700" data-sub></div></div><span data-hact></span></div>
        <div class="pconv" data-conv></div><div class="pactbar" data-actbar style="display:none"></div>
        <div class="pinput" data-inbar><span data-attw></span><input placeholder="Повідомлення…" data-in maxlength="4000" enterkeyhint="send"><span data-voice></span><button class="send" data-send>${IC.send}</button></div>`;
      const box=s.querySelector('[data-conv]'), inp=s.querySelector('[data-in]'), bar=s.querySelector('[data-actbar]');
      s._head=()=>{const c=C(); if(!c) return; s.querySelector('[data-hav]').innerHTML=chatAv(c); s.querySelector('[data-title]').textContent=chatTitle(c)+(c.muted?' 🔕':'');
        const ty=typingIn(chatId), e=c.kind==='direct'?emp(otherOf(c)):null;
        s.querySelector('[data-sub]').textContent=ty?(c.kind==='direct'?'друкує…':first(ty)+' друкує…'):(e?STATUS[statusOf(e)].n:`${c.members.length} учасників`);
        s.querySelector('[data-hact]').innerHTML=c.kind==='direct'&&P._call?`<button class="bk" data-call>${IC.phone}</button>`:'';
        const cb=s.querySelector('[data-call]'); if(cb) cb.onclick=()=>P._call(otherOf(c));};
      const tick=m=>{const c=C(); if(!c) return ''; const others=c.members.filter(x=>x.id!==TG.me.id), n=others.filter(x=>+x.lastRead>=+m.id).length;
        return n?(c.kind==='direct'||others.length<2?' ✓✓':` ✓✓ ${n}`):' ✓';};
      const quoteHTML=q=>`<div class="pquote" data-jump="${q.id}"><b>${esc(senderName(q.senderId))}</b>${q.deleted?'<i>Повідомлення видалено</i>':esc(q.text||(q.attachment?'📎 '+q.attachment:'…'))}</div>`;
      const rxHTML=m=>m.reactions&&m.reactions.length?`<div class="prxs ${m.senderId===TG.me.id?'me':''}">${m.reactions.map(r=>`<span class="prx${r.ids.includes(TG.me.id)?' on':''}" data-rx="${r.emoji}" data-m="${m.id}" title="${esc(r.ids.map(id=>first(id)).join(', '))}">${r.emoji} ${r.ids.length}</span>`).join('')}</div>`:'';
      const bubble=(m,prev)=>{const mine=!!m.senderId&&m.senderId===TG.me.id, c=C()||{kind:'direct',members:[]};
        const day=!prev||new Date(prev.createdAt).toDateString()!==new Date(m.createdAt).toDateString()?`<div class="pday">${esc(dayLabel(new Date(m.createdAt)))}</div>`:'';
        if(m.kind==='system') return day+`<div class="psys" data-m="${m.id}">${linkify(esc(m.text||''))}</div>`;
        const ann=m.kind==='announce';
        const who=ann?`<b class="who">📢 Оголошення · ${esc(senderName(m.senderId))}</b>`:(!mine&&c.kind!=='direct'&&(!prev||prev.senderId!==m.senderId||day||prev.kind)?`<b class="who">${esc(senderName(m.senderId))}</b>`:'');
        const body=m.deleted?'<i class="pdel">Повідомлення видалено</i>':((m.quote?quoteHTML(m.quote):'')+(m.attachment&&P._att?P._att(m):'')+(m.text?linkify(esc(m.text)):''));
        const sel=(editing&&editing.id===m.id)||(replying&&replying.id===m.id);
        return day+`<div class="pbub ${mine?'me':'them'}${ann?' ann':''}${m.deleted?' del':''}${sel?' sel':''}" data-m="${m.id}">${who}${body}<span class="tm">${m.editedAt&&!m.deleted?'ред. · ':''}${hm(new Date(m.createdAt))}${mine&&!m.deleted?tick(m):''}</span></div>${m.deleted?'':rxHTML(m)}`;};
      const nearBottom=()=>box.scrollHeight-box.scrollTop-box.clientHeight<80;
      s._draw=(keep)=>{const stick=keep===undefined?nearBottom():false, h0=box.scrollHeight, t0=box.scrollTop;
        box.innerHTML=!loaded?empty('Завантаження…',''):(hasMore?'<button class="pmore" data-more>Попередні повідомлення</button>':'')+(msgs.length?msgs.map((m,i)=>bubble(m,msgs[i-1])).join(''):empty('Почніть розмову','Повідомлення бачите лише ви та учасники чату.'));
        if(keep==='top') box.scrollTop=box.scrollHeight-h0+t0; else if(stick||keep==='bottom') box.scrollTop=box.scrollHeight; else box.scrollTop=t0;
        // Lazy images grow the list after layout — keep the view pinned to the bottom if it was.
        box.querySelectorAll('img.pimg').forEach(i=>{if(!i.complete) i.onload=()=>{if(box.scrollHeight-box.scrollTop-box.clientHeight<i.clientHeight+120) box.scrollTop=box.scrollHeight;};});};
      const jump=id=>{const el=box.querySelector(`.pbub[data-m="${id}"],.psys[data-m="${id}"]`); if(!el){toast('Повідомлення далеко в історії'); return false;}
        // Scroll only the message list (scrollIntoView would also shift the overflow:hidden phone frame).
        box.scrollTop+=el.getBoundingClientRect().top-box.getBoundingClientRect().top-(box.clientHeight-el.offsetHeight)/2; el.classList.remove('phl'); void el.offsetWidth; el.classList.add('phl'); return true;};
      const readUpTo=id=>{const c=C(); if(c){c.unread=0; badges(); redraw('chatlist');} meApi('POST',`/me/chats/${chatId}/read`,{upTo:id}).catch(()=>{});};
      s._readLast=()=>{const m=msgs[msgs.length-1]; if(m) readUpTo(m.id);};
      const merge=m=>{const i=msgs.findIndex(x=>x.id===m.id); if(i>=0) msgs[i]=m; else {msgs.push(m); msgs.sort((a,b)=>a.id-b.id);}};
      s._onMsg=m=>{const bottom=nearBottom()||m.senderId===TG.me.id; merge(m); s._draw(bottom?'bottom':null); if(m.senderId!==TG.me.id&&!document.hidden) readUpTo(m.id); s._head();};
      s._onUpd=m=>{merge(m); if(editing&&editing.id===m.id&&m.deleted) endMode(); s._draw(null);};
      s._catchup=async()=>{const last=msgs[msgs.length-1]; try{const r=await meApi('GET',`/me/chats/${chatId}/messages${last?'?after='+last.id:''}`); r.messages.forEach(merge); s._draw(); s._readLast();}catch(e){}};
      async function loadOlder(){try{const r=await meApi('GET',`/me/chats/${chatId}/messages?before=${msgs[0].id}`); r.messages.forEach(merge); hasMore=r.hasMore; s._draw('top');}catch(e){fail(e);}}
      function endMode(){editing=null; replying=null; bar.style.display='none'; inp.value=''; s._draw(null);}
      function showReply(m){replying=m; editing=null; bar.style.display='flex';
        bar.innerHTML=`<span class="lbl">↩️ ${esc(senderName(m.senderId))}: ${esc((m.text||(m.attachment?'📎 '+m.attachment.name:'')).slice(0,60))}</span><button data-a="x">✕</button>`;
        bar.querySelector('[data-a=x]').onclick=endMode; inp.focus(); s._draw(null);}
      function select(m){
        if(editing||replying) endMode();
        const mine=m.senderId===TG.me.id;
        bar.style.display='flex';
        bar.innerHTML=`<span class="prxpick">${REACT.map(e=>`<button data-r="${e}">${e}</button>`).join('')}</span><button data-a="reply" title="Відповісти">↩️</button>${mine&&m.text?'<button data-a="edit" title="Змінити">✏️</button>':''}${mine?'<button data-a="del" title="Видалити">🗑</button>':''}<button data-a="x">✕</button>`;
        bar.querySelector('[data-a=x]').onclick=()=>{bar.style.display='none';};
        bar.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{bar.style.display='none'; react(m.id,b.dataset.r);});
        bar.querySelector('[data-a=reply]').onclick=()=>showReply(m);
        const eb=bar.querySelector('[data-a=edit]'); if(eb) eb.onclick=()=>{editing=m; inp.value=m.text; inp.focus(); bar.innerHTML='<span class="lbl">✏️ Редагування</span><button data-a="x">✕</button>'; bar.querySelector('[data-a=x]').onclick=endMode; s._draw(null);};
        const db=bar.querySelector('[data-a=del]'); if(db) confirm2(db,'Точно?',async()=>{bar.style.display='none'; try{s._onUpd(await meApi('DELETE','/me/messages/'+m.id));}catch(e){fail(e);}});}
      async function react(id,emoji){try{s._onUpd(await meApi('POST',`/me/messages/${id}/react`,{emoji}));}catch(e){fail(e);}}
      box.onclick=ev=>{const im=ev.target.closest('img.pimg'); if(im){openExt(im.src); return;}
        const a=ev.target.closest('a'); if(a){ev.preventDefault(); openExt(a.href); return;}
        if(ev.target.closest('audio')) return;
        if(ev.target.closest('[data-more]')){loadOlder(); return;}
        const rx=ev.target.closest('[data-rx]'); if(rx){react(rx.dataset.m,rx.dataset.rx); return;}
        const q=ev.target.closest('[data-jump]'); if(q){jump(q.dataset.jump); return;}
        const b=ev.target.closest('.pbub:not(.del)'); if(b){const m=msgs.find(x=>x.id===b.dataset.m); if(m) select(m);}};
      async function send(){const v=inp.value.trim(); if(!v) return;
        if(editing){const m=editing; endMode(); try{s._onUpd(await meApi('PATCH','/me/messages/'+m.id,{text:v}));}catch(e){inp.value=v; fail(e);} return;}
        const rep=replying; inp.value=''; if(rep){replying=null; bar.style.display='none';}
        try{s._onMsg(await meApi('POST',`/me/chats/${chatId}/messages`,{text:v,replyTo:rep?rep.id:null}));}catch(e){inp.value=v; if(rep) showReply(rep); fail(e);}}
      s.querySelector('[data-send]').onclick=send;
      inp.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault(); send();}};
      inp.oninput=()=>{if(Date.now()-lastTyping>3000&&inp.value){lastTyping=Date.now(); meApi('POST',`/me/chats/${chatId}/typing`).catch(()=>{});}};
      s.querySelector('[data-info]').onclick=()=>{const c=C(); if(c.kind==='direct'){const id=otherOf(c); if(emp(id)) go('contact',x=>R.contact(x,id));} else if(P.chatinfo) go('chatinfo',x=>P.chatinfo(x,chatId));};
      if(P._attach) P._attach(s.querySelector('[data-attw]'),chatId,m=>s._onMsg(m));
      if(P._voice) P._voice(s.querySelector('[data-voice]'),s.querySelector('[data-inbar]'),chatId,m=>s._onMsg(m));
      presence(chatId);
      s._stop=()=>{s._chat=null; presence(null);};
      s._head(); s._draw();
      // From search: the page ending at the found message + everything after it, then jump there.
      const initial=focusId
        ?meApi('GET',`/me/chats/${chatId}/messages?before=${+focusId+1}`).then(async r=>{r.messages.forEach(merge); hasMore=r.hasMore; (await meApi('GET',`/me/chats/${chatId}/messages?after=${focusId}`)).messages.forEach(merge);})
        :meApi('GET',`/me/chats/${chatId}/messages`).then(r=>{r.messages.forEach(merge); hasMore=r.hasMore;});
      initial.then(()=>{loaded=true; s._draw('bottom'); s._readLast(); if(focusId) setTimeout(()=>jump(focusId),50);}).catch(e=>{loaded=true; s._draw(); fail(e);});
      wire(s);}
,
    tasks(s){
      if(!s._tab) s._tab='mine';
      s.innerHTML=headP('Задачі','<button class="act" data-new aria-label="Нова задача">+</button>')+
        `<div class="ptabs" data-tabs></div><div class="pscroll" data-list></div><div class="pinput"><input placeholder="Швидка задача для себе…" data-in maxlength="500"><button class="send" data-add>${IC.send}</button></div>`;
      const box=s.querySelector('[data-list]'), inp=s.querySelector('[data-in]'), tabs=s.querySelector('[data-tabs]');
      const due=t=>{if(!t.dueAt) return ''; const d=new Date(t.dueAt), late=!t.done&&d<new Date(); return `<span class="meta${late?' late':''}">⏰ ${esc(dayLabel(d))}, ${hm(d)}${late?' · прострочено':''}</span>`;};
      const who=t=>t.authorId!==TG.me.id?`<span class="meta">від ${esc(nameOf(t.authorId))}</span>`:(t.assigneeId!==TG.me.id?`<span class="meta">→ ${esc(nameOf(t.assigneeId))}</span>`:'');
      function draw(){
        if(!PM.tasks){box.innerHTML=empty('Завантаження…',''); return;}
        const mine=PM.tasks.filter(t=>t.assigneeId===TG.me.id), byMe=PM.tasks.filter(t=>t.authorId===TG.me.id&&t.assigneeId!==TG.me.id);
        tabs.style.display=byMe.length||s._tab==='byme'?'':'none';
        tabs.innerHTML=[['mine',`Мої · ${mine.filter(t=>!t.done).length}`],['byme',`Поставлені мною · ${byMe.filter(t=>!t.done).length}`]].map(([k,l])=>`<button class="pchip" data-tab="${k}" aria-pressed="${s._tab===k}">${l}</button>`).join('');
        tabs.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{s._tab=b.dataset.tab; draw();});
        const arr=s._tab==='mine'?mine:byMe;
        box.innerHTML=arr.length?arr.map(t=>`<div class="ptask ${t.done?'done':''}" data-id="${t.id}"><span class="cb"><svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg></span><span class="t">${esc(t.text)}${due(t)}${who(t)}</span></div>`).join('')
          :`<div class="pempty"><b>${s._tab==='mine'?'Задач немає 🎉':'Ви ще нікому не ставили задач'}</b><span>${s._tab==='mine'?'Додайте задачу внизу або натисніть «+».':''}</span></div>`;
        box.querySelectorAll('.ptask').forEach(el=>{const t=PM.tasks.find(x=>x.id===el.dataset.id);
          el.querySelector('.cb').onclick=async()=>{if(t._busy) return; t._busy=true; const was=t.done; t.done=!was; draw(); badges();
            try{Object.assign(t,await meApi('PATCH','/me/tasks/'+t.id,{done:!was}));}catch(err){t.done=was; fail(err);} t._busy=false; draw(); badges();};
          el.querySelector('.t').onclick=()=>go('taskform',x=>P.taskform(x,t.id));});
      }
      const add=async()=>{const v=inp.value.trim(); if(!v) return; inp.value='';
        try{const t=await meApi('POST','/me/tasks',{text:v}); (PM.tasks=PM.tasks||[]).unshift(t); s._tab='mine'; draw(); badges();}catch(err){inp.value=v; fail(err);}};
      s.querySelector('[data-add]').onclick=add; inp.onkeydown=ev=>{if(ev.key==='Enter') add();};
      s.querySelector('[data-new]').onclick=()=>go('taskform',x=>P.taskform(x,null));
      s._redraw=draw; draw(); loadTasks(); wire(s);}
,
    taskform(s,id){
      const t=id?(PM.tasks||[]).find(x=>x.id===id):null, author=!t||t.authorId===TG.me.id, ro=author?'':'readonly disabled';
      const d=t&&t.dueAt?new Date(t.dueAt):null;
      s.innerHTML=head(t?'Задача':'Нова задача')+`<div class="pscroll"><form class="pform" data-f>
        <label class="k">Що зробити</label><textarea data-text maxlength="500" placeholder="Опишіть задачу" ${ro}>${esc(t?t.text:'')}</textarea>
        <label class="k">Дедлайн</label><div class="row2"><input type="date" data-dd value="${d?dKey(d):''}" ${ro}><input type="time" data-dt value="${d?hm(d):''}" ${ro}></div>
        <div data-assign></div>
        ${t&&!author?`<div class="pnote" style="margin:0">Задачу поставив(ла) ${esc(nameOf(t.authorId))}. Ви можете позначити її виконаною.</div>`:''}
        ${author?`<button class="pbtn" type="submit">${t?'Зберегти':'Створити'}</button>`:''}
        ${t?`<button class="pbtn ghost" type="button" data-done>${t.done?'Повернути в роботу':'Позначити виконаною ✓'}</button>`:''}
        ${t&&author?'<button class="pbtn danger" type="button" data-del>Видалити</button>':''}
      </form></div>`;
      const asg=author&&P._assignField?P._assignField(s.querySelector('[data-assign]'),t):null;
      const upd=u=>{const i=PM.tasks.findIndex(x=>x.id===u.id); if(i>=0) PM.tasks[i]=u; else PM.tasks.unshift(u);};
      s.querySelector('[data-f]').onsubmit=async ev=>{ev.preventDefault(); if(!author) return;
        const text=s.querySelector('[data-text]').value.trim(), dd=s.querySelector('[data-dd]').value, dt=s.querySelector('[data-dt]').value;
        if(!text){toast('Опишіть задачу'); return;}
        const body={text,dueAt:dd?fromInputs(dd,dt||'18:00').toISOString():null};
        if(asg&&!t) body.assigneeId=asg();
        try{const u=t?await meApi('PATCH','/me/tasks/'+t.id,body):await meApi('POST','/me/tasks',body); PM.tasks=PM.tasks||[]; upd(u);
          if(!t&&u.assigneeId!==TG.me.id){scr('tasks')._tab='byme'; toast('Задачу поставлено: '+first(u.assigneeId));} else toast(t?'Збережено':'Задачу додано');
          popIf('taskform'); redraw('tasks'); badges();}catch(err){fail(err);}};
      const dn=s.querySelector('[data-done]'); if(dn) dn.onclick=async()=>{try{upd(await meApi('PATCH','/me/tasks/'+t.id,{done:!t.done})); popIf('taskform'); redraw('tasks'); badges();}catch(err){fail(err);}};
      const del=s.querySelector('[data-del]'); if(del) confirm2(del,'Точно видалити?',async()=>{try{await meApi('DELETE','/me/tasks/'+t.id); PM.tasks=PM.tasks.filter(x=>x.id!==t.id); popIf('taskform'); redraw('tasks'); badges(); toast('Задачу видалено');}catch(err){fail(err);}});
      wire(s);}
,
    settings(s){
      const dark=settings.theme==='dark', p=PM.prefs;
      const row=(k,l,sub)=>`<div class="psetrow"><div><div class="lb">${l}</div><div class="sub">${sub}</div></div><div class="ptog" data-pref="${k}" aria-pressed="${p?p[k]:true}"></div></div>`;
      s.innerHTML=head('Налаштування')+`<div class="pscroll">
        <div class="psetrow"><div><div class="lb">Темна тема</div><div class="sub">Змінює вигляд офісу й телефону</div></div><div class="ptog" data-dark aria-pressed="${dark}"></div></div>
        <div style="padding:16px 18px 4px;font-size:11.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">Сповіщення в Telegram</div>
        ${row('messages','Повідомлення','Нові повідомлення в чатах')}
        ${row('events','Календар','Запрошення та нагадування про події')}
        ${row('tasks','Задачі','Нові задачі, виконання, дедлайни')}
        ${row('digest','Ранковий дайджест','Події та задачі на день — у будні зранку')}
        <div class="pnote">🔒 Ваші чати, календар і задачі бачите лише ви та учасники. HR-доступ до них не відкриває. Дані зберігаються на сервері компанії; вкладення з чатів видаляються через 90 днів.</div>
        <div class="psetrow"><div class="lb">Версія</div><div class="sub">AllianceOS 2.0</div></div></div>`;
      s.querySelector('[data-dark]').onclick=e=>{const on=e.currentTarget.getAttribute('aria-pressed')!=='true'; e.currentTarget.setAttribute('aria-pressed',on); settings.theme=on?'dark':'pastel'; applySettings();};
      s.querySelectorAll('[data-pref]').forEach(t=>t.onclick=async()=>{const k=t.dataset.pref, on=t.getAttribute('aria-pressed')!=='true'; t.setAttribute('aria-pressed',on);
        try{PM.prefs=await meApi('PUT','/me/prefs',{[k]:on});}catch(err){t.setAttribute('aria-pressed',!on); fail(err);}});
      if(!p) meApi('GET','/me/prefs').then(v=>{PM.prefs=v; if(stack.includes('settings')) P.settings(s);}).catch(()=>{});
      wire(s);}
  };
  // ── groups, chat info, people picker, attachments ──
  const linkedColleagues=()=>O.state.employees.filter(e=>e.tg_linked&&e.id!==TG.me.id).sort((a,b)=>a.name.localeCompare(b.name,'uk'));
  const fsize=n=>n<1024?n+' Б':n<1048576?Math.round(n/1024)+' КБ':(n/1048576).toFixed(1)+' МБ';
  const attUrl=(a,dl)=>`${API}/me/attachments/${a.id}?t=${encodeURIComponent(PM.token||'')}${dl?'&dl=1':''}`;
  const openExt=url=>{const u=new URL(url,location.href).href; try{Telegram.WebApp.openLink(u);}catch(e){window.open(u,'_blank');}};
  const FILE_MAX=20*1024*1024;
  // Big photos are downscaled on the device before upload (max 1600px, JPEG).
  async function prepFile(f){
    if(/^image\/(jpeg|png|webp)$/.test(f.type)&&f.size>400*1024){try{
      const bmp=await createImageBitmap(f), k=Math.min(1,1600/Math.max(bmp.width,bmp.height)), c=document.createElement('canvas');
      c.width=Math.round(bmp.width*k); c.height=Math.round(bmp.height*k); c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
      const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.82));
      if(b&&b.size<f.size) return {blob:b,name:f.name.replace(/\.\w+$/,'')+'.jpg',type:'image/jpeg'};}catch(e){}}
    return {blob:f,name:f.name||'file',type:f.type||'application/octet-stream'};}
  // Upload a blob as a chat attachment and post it as a message (photos, files, voice).
  async function sendBlob(chatId,blob,name,type){
    if(PM.exp*1000-Date.now()<120e3) await session();
    const r=await fetch(`${API}/me/attachments?chatId=${chatId}&name=${encodeURIComponent(name)}&mime=${encodeURIComponent(type)}`,{method:'POST',headers:Object.assign({'content-type':'application/octet-stream','X-Telegram-Init-Data':TG.initData},PM.token&&PM.exp*1000>Date.now()+60000?{'X-Me-Token':PM.token}:{}),body:blob});
    if(r.status===401){toast('Сесія застаріла — закрийте й відкрийте застосунок знову'); return null;}
    if(r.status===413){toast('Файл більший за 20 МБ'); return null;}
    if(!r.ok) throw Object.assign(new Error('upload '+r.status),{code:r.status});
    const up=await r.json();
    return meApi('POST',`/me/chats/${chatId}/messages`,{attachmentId:up.id});
  }
  // First run in the Mini App: a 3-step tour of the phone (spec 005 D), once per device.
  function showTour(){
    try{if(localStorage.getItem('alliancesim.tour.v1')) return;}catch(e){return;}
    const steps=[['👋','Вітаємо в AllianceOS!','Це ваш особистий телефон офісу: тут листування з колегами, календар, задачі та ваше місце.'],
      ['💬','Чати й оголошення','Пишіть колегам, у чат відділу чи всього офісу. Відповідати можна й прямо з Telegram — на сповіщення бота.'],
      ['📅','Календар і переговорні','Створюйте зустрічі, бронюйте переговорні та запрошуйте колег. Бот нагадає заздалегідь.'],
      ['🪑','Ваш профіль і місце','У «Мій профіль» — статус, настрій і день народження. «Моє місце» — стіл на сьогодні.']];
    let k=0; const el=document.createElement('div'); el.className='ptour';
    const draw=()=>{const [ic,t,d]=steps[k]; el.innerHTML=`<div class="card"><div class="ic">${ic}</div><b>${t}</b><span>${d}</span><div class="dots">${steps.map((_,i)=>`<i${i===k?' class="on"':''}></i>`).join('')}</div><button class="pbtn" data-next>${k<steps.length-1?'Далі':'Почати'}</button>${k<steps.length-1?'<button class="skip" data-skip>Пропустити</button>':''}</div>`;
      const done=()=>{try{localStorage.setItem('alliancesim.tour.v1','1');}catch(e){} el.remove();};
      el.querySelector('[data-next]').onclick=()=>{if(++k>=steps.length) done(); else draw();};
      const sk=el.querySelector('[data-skip]'); if(sk) sk.onclick=done;};
    draw(); $('#pbody').appendChild(el);}
  Object.assign(P,{
    desk(s){
      s.innerHTML=head('Моє місце')+'<div class="pscroll" data-list></div>';
      const box=s.querySelector('[data-list]'); box.innerHTML=empty('Завантаження…','');
      const me=emp(TG.me.id)||TG.me;
      async function load(){let d; try{d=await meApi('GET','/me/desks');}catch(err){box.innerHTML=empty('Не вдалося завантажити',''); return;}
        if(me.seat){box.innerHTML='<div class="pnote">🪑 У вас є постійне робоче місце — бронювати стіл на день не потрібно.</div>'; return;}
        if(!d.desks.length){box.innerHTML=empty('Немає столів для бронювання','HR ще не розставив столи на плані офісу.'); return;}
        const rows=d.desks.map((x,k)=>{const room=roomName(roomAt(x.x,x.z))||'Офіс', mine=!!d.mine&&d.mine.f===x.f&&d.mine.i===x.i, owner=x.owner&&!mine?x.owner:null;
          return `<div class="prow" data-f="${esc(x.f)}" data-i="${x.i}"><div class="av gav">🪑</div><div class="tx"><div class="nm">Стіл ${k+1}${x.i?' · місце '+(x.i+1):''}</div><div class="sub">${esc(room)} · ${mine?'<b style="color:#2e9b57">ваше на сьогодні</b>':owner?esc(owner.name)+(owner.permanent?' (постійне)':''):'вільний'}</div></div>${mine?'<button class="rm" data-rel>Звільнити</button>':owner?'':'<button class="rm" data-book style="color:#2e9b57">Сісти тут</button>'}</div>`;}).join('');
        box.innerHTML='<div class="pnote">Оберіть стіл на сьогодні — в офісі ви з’явитесь саме там. Бронь діє до кінця дня.</div>'+rows;
        box.querySelectorAll('[data-book]').forEach(b=>b.onclick=async()=>{const row=b.closest('[data-f]');
          try{await meApi('POST','/me/desk',{f:row.dataset.f,i:+row.dataset.i}); toast('🪑 Місце на сьогодні ваше'); refreshLive(); load();}
          catch(err){if(err.code===409){toast('Це місце вже зайняте'); load();} else fail(err);}});
        box.querySelectorAll('[data-rel]').forEach(b=>b.onclick=async()=>{try{await meApi('DELETE','/me/desk'); toast('Місце звільнено'); refreshLive(); load();}catch(err){fail(err);}});}
      load(); wire(s);},
    _call:id=>callPerson(id),
    _inviteField(el,e){
      let ids=e?e.attendees.map(a=>a.id).filter(id=>id!==TG.me.id):[];
      const draw=()=>{el.innerHTML=`<div style="display:flex;flex-direction:column;gap:8px"><label class="k" style="margin:0">Запросити колег</label><div class="pchips">${ids.map(id=>`<button type="button" class="pchip" data-rm="${id}" aria-pressed="true">${esc(first(id))} ✕</button>`).join('')}<button type="button" class="pchip" data-addp>+ Запросити</button></div></div>`;
        el.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ids=ids.filter(x=>x!==b.dataset.rm); draw();});
        el.querySelector('[data-addp]').onclick=()=>go('pick',x=>P.pick(x,{title:'Запросити на подію',exclude:new Set(ids),cta:'Запросити',done:sel=>{ids=[...new Set(ids.concat(sel))]; back(); draw();}}));};
      draw(); return ()=>ids;},
    _eventExtra(s,e){
      const box=s.querySelector('[data-extra]'), guests=e.attendees.filter(a=>a.id!==e.organizerId);
      const ST={accepted:'✅ буде',declined:'❌ не буде',pending:'⏳ ще не відповів(ла)'};
      let h='';
      if(guests.length) h+=`<div class="r" style="flex-direction:column;gap:7px"><span class="k">Учасники · ${guests.length+1}</span>${[{id:e.organizerId,status:'org'},...guests].map(a=>`<div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(nameOf(a.id))}${a.id===TG.me.id?' (ви)':''}</span><span style="color:var(--muted);white-space:nowrap">${a.status==='org'?'організатор':ST[a.status]||''}</span></div>`).join('')}</div>`;
      if(e.organizerId!==TG.me.id) h+=`<div style="font-size:11.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:16px 0 8px">Ваша відповідь</div><div style="display:flex;gap:8px"><button class="pbtn sm ${e.myStatus==='accepted'?'':'ghost'}" style="flex:1" data-resp="accepted">✅ Буду</button><button class="pbtn sm ${e.myStatus==='declined'?'':'ghost'}" style="flex:1" data-resp="declined">❌ Не буду</button></div>`;
      box.innerHTML=h;
      box.querySelectorAll('[data-resp]').forEach(b=>b.onclick=async()=>{try{const u=await meApi('POST',`/me/events/${e.id}/respond`,{status:b.dataset.resp}); PM.ev.set(u.id,u); P.event(s,u.id); redraw('calendar'); loadInvites(); toast(u.myStatus==='accepted'?'Ви підтвердили участь':'Ви відмовилися');}catch(err){fail(err);}});},
    _assignField(el,t){
      if(t){if(t.assigneeId!==TG.me.id) el.innerHTML=`<div style="display:flex;flex-direction:column;gap:8px"><label class="k" style="margin:0">Виконавець</label><div style="font-weight:800;font-size:14px">${esc(nameOf(t.assigneeId))}${t.done?' · виконано ✅':''}</div></div>`; return null;}
      let who=null;
      const draw=()=>{el.innerHTML=`<div style="display:flex;flex-direction:column;gap:8px"><label class="k" style="margin:0">Кому</label><div class="pchips"><button type="button" class="pchip" data-self aria-pressed="${!who}">Собі</button><button type="button" class="pchip" data-other aria-pressed="${!!who}">${who?esc(nameOf(who))+' ✎':'Колезі…'}</button></div></div>`;
        el.querySelector('[data-self]').onclick=()=>{who=null; draw();};
        el.querySelector('[data-other]').onclick=()=>go('pick',x=>P.pick(x,{title:'Кому поставити задачу',cta:'Обрати',single:true,done:sel=>{who=sel[0]; back(); draw();}}));};
      draw(); return ()=>who;},
    _groupEntry(el){
      el.innerHTML='<div class="prow" data-g><div class="av gav">👥</div><div class="tx"><div class="nm">Нова група</div><div class="sub">Чат для кількох колег</div></div></div>';
      el.querySelector('[data-g]').onclick=()=>go('groupnew',P.groupnew);},
    pick(s,{title,exclude=new Set(),done,cta='Готово',single=false}){
      const es=linkedColleagues().filter(e=>!exclude.has(e.id)), sel=new Set();
      s.innerHTML=head(title)+`<div class="psearch"><input placeholder="Пошук колеги" data-q></div><div class="pscroll" data-list></div><div class="pform" style="padding:8px 16px 12px"><button class="pbtn" data-ok>${cta}</button></div>`;
      const box=s.querySelector('[data-list]'), okb=s.querySelector('[data-ok]');
      const label=()=>{okb.textContent=sel.size?`${cta} · ${sel.size}`:cta;};
      const draw=q=>{const r=es.filter(e=>!q||(e.name+' '+(e.dept||'')).toLowerCase().includes(q));
        box.innerHTML=r.length?r.map(e=>`<div class="prow" data-id="${e.id}" aria-checked="${sel.has(e.id)}">${avHTML(e)}<div class="tx"><div class="nm">${esc(e.name)}</div><div class="sub">${esc(e.dept||'')}</div></div><span class="chk">✓</span></div>`).join('')
          :empty(es.length?'Нікого не знайшли':'Більше нікого додати','Колеги з’являться тут, щойно підключать Telegram-бота.');
        box.querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>{const id=el.dataset.id; if(single&&!sel.has(id)){sel.clear(); box.querySelectorAll('[data-id]').forEach(x=>x.setAttribute('aria-checked','false'));} sel.has(id)?sel.delete(id):sel.add(id); el.setAttribute('aria-checked',sel.has(id)); label();});};
      okb.onclick=()=>{if(!sel.size){toast('Оберіть хоча б одного колегу'); return;} done([...sel]);};
      draw(''); s.querySelector('[data-q]').oninput=e=>draw(e.target.value.trim().toLowerCase()); wire(s);},
    groupnew(s){
      let ids=[];
      s.innerHTML=head('Нова група')+`<div class="pscroll"><div class="pform"><label class="k">Назва</label><input type="text" data-title maxlength="80" placeholder="Напр. «Корпоратив»"><label class="k">Учасники</label><div data-mem></div><button class="pbtn ghost sm" type="button" data-add>+ Додати учасників</button><button class="pbtn" type="button" data-create>Створити групу</button></div></div>`;
      const mem=s.querySelector('[data-mem]');
      const drawMem=()=>{mem.innerHTML=ids.length?ids.map(id=>{const e=emp(id); return e?`<div class="prow" style="padding:6px 0">${avHTML(e)}<div class="tx"><div class="nm">${esc(e.name)}</div></div><button class="rm" type="button" data-rm="${id}">Прибрати</button></div>`:'';}).join(''):'<div style="font-size:12.5px;color:var(--muted);font-weight:600">Поки нікого не додано</div>';
        mem.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{ids=ids.filter(x=>x!==b.dataset.rm); drawMem();});};
      drawMem();
      s.querySelector('[data-add]').onclick=()=>go('pick',x=>P.pick(x,{title:'Учасники групи',exclude:new Set(ids),cta:'Додати',done:sel=>{ids=[...new Set(ids.concat(sel))]; back(); drawMem();}}));
      s.querySelector('[data-create]').onclick=async()=>{const title=s.querySelector('[data-title]').value.trim();
        if(!title){toast('Вкажіть назву групи'); return;} if(!ids.length){toast('Додайте учасників'); return;}
        try{const c=await meApi('POST','/me/chats',{title,memberIds:ids}); upsertChat(c); while(stack.length&&stack[stack.length-1]!=='chatlist') pop(); redraw('chatlist'); openChat(c.id); toast('Групу створено');}catch(e){fail(e);}};
      wire(s);},
    chatinfo(s,chatId){
      const c=chatById(chatId); if(!c){s.innerHTML=head('Чат')+empty('Чат недоступний',''); wire(s); return;}
      const admin=c.kind==='group'&&c.createdBy===TG.me.id;
      const kindTxt=c.kind==='group'?`Група · створив(ла) ${esc(c.createdBy===TG.me.id?'ви':nameOf(c.createdBy))}`:c.kind==='dept'?'Чат відділу — учасники оновлюються автоматично':'Чат усього офісу — для всіх, хто підключив бота';
      const ms=c.members.map(m=>emp(m.id)).filter(Boolean).sort((a,b)=>a.id===TG.me.id?-1:b.id===TG.me.id?1:a.name.localeCompare(b.name,'uk'));
      s.innerHTML=head('Про чат')+`<div class="pscroll"><div class="pinfo">
        <div style="display:flex;align-items:center;gap:12px;margin-top:10px">${chatAv(c)}<div><div class="h" style="margin:0">${esc(chatTitle(c))}</div><div style="font-size:12px;color:var(--muted);font-weight:700">${kindTxt}</div></div></div>
        ${admin?`<div class="pform" style="padding:14px 0 0"><label class="k">Назва групи</label><div class="row2"><input type="text" data-title maxlength="80" value="${esc(c.title||'')}"><button class="pbtn sm" type="button" data-rename style="flex:0 0 auto;width:auto;padding:0 16px">Зберегти</button></div></div>`:''}
        <div class="psetrow" style="padding:14px 0"><div><div class="lb">Без звуку</div><div class="sub">Не надсилати сповіщення з цього чату в Telegram</div></div><div class="ptog" data-mute aria-pressed="${c.muted}"></div></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 4px"><div style="font-size:11.5px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">Учасники · ${c.members.length}</div>${admin?'<button class="rm" data-add style="color:var(--ink)">+ Додати</button>':''}</div>
        <div class="members">${ms.map(e=>`<div class="prow" data-id="${e.id}">${avHTML(e)}<div class="tx"><div class="nm">${esc(e.name)}${e.id===TG.me.id?' (ви)':''}</div><div class="sub">${e.id===c.createdBy&&c.kind==='group'?'адмін':esc(e.dept||'')}</div></div>${admin&&e.id!==TG.me.id?`<button class="rm" data-rm="${e.id}">Прибрати</button>`:''}</div>`).join('')}</div>
        ${c.kind==='group'?'<button class="pbtn danger sm" data-leave style="width:100%;margin-top:18px">Вийти з групи</button>':''}
      </div></div>`;
      const patch=async(body,msg)=>{try{const u=await meApi('PATCH','/me/chats/'+chatId,body); upsertChat(u); P.chatinfo(s,chatId); const cv=convOpen(chatId); if(cv) cv._head(); redraw('chatlist'); if(msg) toast(msg);}catch(e){fail(e);}};
      s.querySelector('[data-mute]').onclick=()=>patch({muted:!c.muted},c.muted?'Сповіщення увімкнено':'Чат без звуку 🔕');
      const rn=s.querySelector('[data-rename]'); if(rn) rn.onclick=()=>{const t=s.querySelector('[data-title]').value.trim(); if(!t){toast('Вкажіть назву'); return;} patch({title:t},'Назву змінено');};
      const ad=s.querySelector('[data-add]'); if(ad) ad.onclick=()=>go('pick',x=>P.pick(x,{title:'Додати учасників',exclude:new Set(c.members.map(m=>m.id)),cta:'Додати',done:sel=>{back(); patch({add:sel},'Учасників додано');}}));
      s.querySelectorAll('[data-rm]').forEach(b=>{confirm2(b,'Точно?',()=>patch({remove:[b.dataset.rm]},'Учасника прибрано')); const f=b.onclick; b.onclick=ev=>{ev.stopPropagation(); f(ev);};});
      s.querySelectorAll('.members [data-id]').forEach(el=>el.onclick=()=>{if(el.dataset.id!==TG.me.id) go('contact',x=>R.contact(x,el.dataset.id));});
      const lv=s.querySelector('[data-leave]'); if(lv) confirm2(lv,'Точно вийти?',async()=>{try{await meApi('POST',`/me/chats/${chatId}/leave`); PM.chats=PM.chats.filter(x=>x.id!==chatId); while(stack.length&&stack[stack.length-1]!=='chatlist') pop(); redraw('chatlist'); badges(); toast('Ви вийшли з групи');}catch(e){fail(e);}});
      s._redraw=()=>{if(chatById(chatId)) P.chatinfo(s,chatId);};
      wire(s);},
    _att(m){const a=m.attachment;
      if(a.expired) return `<div class="pgone">📎 ${esc(a.name)} — файл більше недоступний</div>`;
      if(/^image\/(jpeg|png|gif|webp)$/.test(a.mime)) return `<img class="pimg" src="${attUrl(a)}" alt="${esc(a.name)}" loading="lazy">`;
      if(/^audio\//.test(a.mime)) return `<div class="pvoice">🎤 <audio controls preload="none" src="${attUrl(a)}"></audio></div>`;
      return `<a class="pfile" href="${attUrl(a,1)}"><span class="ic">📄</span><span><span class="fn">${esc(a.name)}</span><br><span class="fs">${fsize(a.size)}</span></span></a>`;},
    _attach(el,chatId,onSent){
      el.innerHTML='<label class="att" title="Надіслати фото чи файл">📎<input type="file" style="display:none"></label>';
      const fi=el.querySelector('input');
      fi.onchange=async()=>{const f=fi.files[0]; fi.value=''; if(!f) return;
        if(f.size>FILE_MAX){toast('Файл більший за 20 МБ'); return;}
        toast('Надсилаю…');
        try{const p=await prepFile(f); const m=await sendBlob(chatId,p.blob,p.name,p.type); if(m) onSent(m);}catch(e){fail(e);}};},
    // Voice notes: tap 🎤 → recording bar (timer, ✕ cancel, ➤ send). Max 5 minutes.
    _voice(el,inbar,chatId,onSent){
      if(!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder)){el.innerHTML=''; return;}
      el.innerHTML='<button class="att" type="button" data-mic title="Голосове повідомлення">🎤</button>';
      el.querySelector('[data-mic]').onclick=async()=>{
        let stream;
        try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}catch(e){toast('Мікрофон недоступний — дозвольте доступ у налаштуваннях'); return;}
        const type=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(t=>MediaRecorder.isTypeSupported(t))||'';
        const rec=new MediaRecorder(stream,type?{mimeType:type}:undefined), parts=[]; let cancel=false;
        const bar=document.createElement('div'); bar.className='prec';
        bar.innerHTML='<span class="dot"></span><span data-t>0:00</span><span style="flex:1"></span><button type="button" data-c title="Скасувати">✕</button><button type="button" class="send" data-ok title="Надіслати">➤</button>';
        inbar.style.display='none'; inbar.after(bar);
        const t0=Date.now(), tick=setInterval(()=>{const sec=Math.floor((Date.now()-t0)/1000); bar.querySelector('[data-t]').textContent=Math.floor(sec/60)+':'+pad(sec%60); if(sec>=300) rec.stop();},250);
        const done=()=>{clearInterval(tick); stream.getTracks().forEach(t=>t.stop()); bar.remove(); inbar.style.display='';};
        rec.ondataavailable=e=>{if(e.data&&e.data.size) parts.push(e.data);};
        rec.onstop=async()=>{done(); if(cancel||!parts.length) return;
          const mime=(rec.mimeType||type||'audio/webm').split(';')[0], ext=mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm';
          try{const m=await sendBlob(chatId,new Blob(parts,{type:mime}),`голосове-${dKey(new Date())}.${ext}`,mime); if(m) onSent(m);}catch(e){fail(e);}};
        bar.querySelector('[data-c]').onclick=()=>{cancel=true; rec.stop();};
        bar.querySelector('[data-ok]').onclick=()=>rec.stop();
        rec.start();};},
  });

  // Personal-only apps show a lock screen outside Telegram / before the character exists.
  const PERSONAL_ONLY={calendar:'Календар',tasks:'Задачі',chatlist:'Чати',desk:'Моє місце'};
  const appFor=id=>personal()&&P[id]?P[id]:(PERSONAL_ONLY[id]?(s=>locked(s,PERSONAL_ONLY[id])):R[id]);

  async function personalStart(){
    if(!personal()||PM.started) return;
    PM.started=true;
    try{localStorage.removeItem('alliancesim.phone.tasks');}catch(e){}
    await session(5);
    setInterval(()=>{if(PM.exp*1000-Date.now()<3600e3) session();},10*60e3);
    meApi('GET','/me/contacts').then(l=>{PM.contacts=new Map(l.map(c=>[c.id,c.username]));}).catch(()=>{});
    loadTasks(); loadInvites();
    await loadChats();
    connect();
    showTour();
    // Deep link from a bot notification: ?open=chat_12 | event_5 | task_3 (or Telegram start_param).
    let deep=params.get('open'); try{deep=deep||(Telegram.WebApp.initDataUnsafe||{}).start_param;}catch(e){}
    const m=/^(chat|event|task)_(\d+)$/.exec(deep||'');
    if(m) setTimeout(()=>openDeep(m[1],m[2]),400);
  }
  async function openDeep(kind,id){
    if(kind==='chat'){if(!chatById(id)) await loadChats(); if(!chatById(id)){toast('Чат недоступний'); return;} go('chatlist',P.chatlist); openChat(id);}
    else if(kind==='event'){try{const e=await meApi('GET','/me/events/'+id); PM.ev.set(e.id,e); go('calendar',P.calendar); go('event',x=>P.event(x,e.id));}catch(e){toast('Подію не знайдено');}}
    else if(kind==='task'){go('tasks',P.tasks); await loadTasks(); if((PM.tasks||[]).some(t=>t.id===id)) go('taskform',x=>P.taskform(x,id));}
  }
  PHONE.personalStart=personalStart;

  $('#phoneFab').onclick=open;
  $('#phoneClose').onclick=close;
  $('#pbar').onclick=()=>{if(stack.length)home(); else close();};
  scr('home').querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go,appFor(b.dataset.go)));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&app.dataset.phone){if(stack.length)back(); else close();}});
  tick(); setInterval(tick,20000); badges();
  return PHONE;
}
