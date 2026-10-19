// Office site (AllianceSim): plan state, 2D/3D renderers, roaming, builder/viewer UI, sync.
// Invariants: CLAUDE.md + docs/adr/0002, 0003.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {initPhone} from '../phone/phone.js';
import * as CATALOG from './catalog.js';
import {initHr} from './hr.js';

/* ---------- data: js/office/catalog.js ---------- */
const {S, CS, OW, OD, WALL_H, sc, ROOMS, WALLS, ZONES, THEMES, DEPT_COLORS, STATUS, MOODS, CATS, DEPTS, ZONE_DEPT_PRESETS, ZONE_PALETTE, FURN} = CATALOG;
function fillDeptList(){const seen=new Set(), out=[]; for(const d of [...DEPTS,...Object.keys(state.depts)]){if(d&&!seen.has(d)){seen.add(d); out.push(d);}} const dl=$('#deptList'); if(dl) dl.innerHTML=out.map(d=>`<option value="${esc(d)}">`).join('');}

/* ---------- state ---------- */
const LS_LAYOUT='alliancesim.layout.v3', LS_SET='alliancesim.settings';
let state={furniture:[],zones:{},rects:[],employees:[],depts:{}};
let settings=Object.assign({theme:'pastel',avatar:'blocky',layout:'dock',zoning:'click',hl:'both',move:'off',view:'2d'},JSON.parse(localStorage.getItem(LS_SET)||'{}'));
let mode='builder', tab='furniture', dirty=false, undoStack=[], uidc=1;
let view='2d', dirty2d=true; // 2D top-down (Canvas) is the default light renderer; 3D is opt-in

/* ---------- backend sync (MVP: localStorage -> API з офлайн-фолбеком) ---------- */
const API=(location.protocol==='file:')?'http://localhost:8011/api':'/api';
const LS_TOKEN='alliancesim.edit_token', LS_PENDING='alliancesim.pending';
const getToken=()=>localStorage.getItem(LS_TOKEN)||'';
/* ---------- Telegram Mini App identity ---------- */
// When opened inside Telegram, WebApp.initData is a signed string identifying the user.
// The backend verifies it (HMAC with the bot token); writes then authenticate as this
// user (scoped to their own character) instead of the HR token.
const TG={active:false,initData:'',tgId:null,me:null,canCoffee:null};
(function(){const w=window.Telegram&&window.Telegram.WebApp; if(w&&w.initData&&w.initData.length){TG.active=true; TG.initData=w.initData; try{w.ready();w.expand();}catch(e){} try{document.getElementById('app').dataset.tgapp='1';}catch(e){}}})();
const isMe=(e)=>!!(TG.active&&TG.me&&e&&e.id===TG.me.id);
async function tgVerify(){ if(!TG.active){TG.diag='no-tg'; return;} try{ const r=await fetch(API+'/tg/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:TG.initData})}); if(r.ok){const j=await r.json(); TG.tgId=j.tgId||null; TG.me=j.employee||null; TG.canCoffee=j.canCoffee!==false; TG.diag=TG.me?'ok':(TG.tgId?'no-emp':'no-user');} else {TG.diag='http'+r.status;} }catch(e){TG.diag='neterr';} }
function setSyncStatus(txt,saved){const s=document.querySelector('#status'); if(!s) return; s.classList.toggle('saved',!!saved); const sp=s.querySelector('span'); if(sp) sp.textContent=txt;}
async function apiLayoutGet(){const r=await fetch(API+'/layout',{headers:{'accept':'application/json'}}); if(!r.ok) throw new Error('http '+r.status); const j=await r.json(); return (j&&j.data)?j.data:null;}
async function apiLayoutPut(data){const {employees,...layout}=data; const r=await fetch(API+'/layout',{method:'PUT',headers:{'content-type':'application/json','X-Edit-Token':getToken()},body:JSON.stringify({data:layout})}); if(r.status===401){const e=new Error('unauthorized');e.code=401;throw e;} if(!r.ok) throw new Error('http '+r.status); return true;}
/* ---------- employees: DB-backed source of truth, with offline (localStorage) fallback ---------- */
async function apiEmpList(){const r=await fetch(API+'/employees',{headers:{'accept':'application/json'}}); if(!r.ok) throw new Error('http '+r.status); return r.json();}
async function apiEmpWrite(method,path,body){const headers={'content-type':'application/json','X-Edit-Token':getToken()}; if(TG.active) headers['X-Telegram-Init-Data']=TG.initData; const r=await fetch(API+path,{method,headers,body:body?JSON.stringify(body):undefined}); if(r.status===401||r.status===503){const e=new Error('unauthorized');e.code=401;throw e;} if(r.status===403){const e=new Error('forbidden');e.code=403;throw e;} if(!r.ok) throw new Error('http '+r.status); return r.status===204?null:r.json().catch(()=>null);}
// Optimistic writes with a retry queue (mirrors the layout LS_PENDING model, so a
// failed/offline write is NOT silently reverted by the 12 s poll). pendingEmp keys an
// employee id → intended state; the poll overlays it on server truth, and flushEmp
// keeps retrying until the server confirms. Employee writes are builder-only.
const pendingEmp=new Map(); // id -> {op:'upsert', emp} | {op:'delete'}
function promptTokenOnce(){const w=document.querySelector('#asTokenModal'); if(!getToken()&&(!w||w.style.display!=='flex')) openTokenModal();}
// Can we persist employee writes? HR with a token, or a Telegram Mini App user.
const canWriteEmp=()=>(mode==='builder'&&!!getToken())||TG.active;
async function flushEmp(){
  if(!((mode==='builder'&&getToken())||TG.active)) return;   // nothing to sync without rights
  for(const [id,w] of [...pendingEmp]){
    try{
      if(w.op==='delete') await apiEmpWrite('DELETE','/employees/'+encodeURIComponent(id));
      else await apiEmpWrite('POST','/employees',w.emp);     // POST upserts by id
      pendingEmp.delete(id);
    }catch(e){ if(e.code===403){pendingEmp.delete(id); continue;} /* not allowed (e.g. not your character) → drop */
      if(e.code===401){ if(!TG.active) promptTokenOnce(); return;} return; /* keep for next retry */ }
  }
}
// Write guards. HR (builder) writes anything. A Mini App user may write only their own
// character (or create one when they have none yet). Viewers on the public link never write.
function empUpsert(e){ if(!(mode==='builder'||(TG.active&&(!TG.me||isMe(e))))) return; pendingEmp.set(e.id,{op:'upsert',emp:JSON.parse(JSON.stringify(e))}); flushEmp(); }
function empDelete(id){ if(mode!=='builder') return; pendingEmp.set(id,{op:'delete'}); flushEmp(); }
let empPollT=null;
async function refreshEmployees(){
  const busy=()=>{const bd=document.querySelector('#backdrop'); return (bd&&bd.classList.contains('open'))||(typeof drag!=='undefined'&&drag);};
  if(busy()) return;                                          // mid-edit / mid-drag
  await flushEmp();                                           // retry any queued writes first
  let emps; try{emps=await apiEmpList();}catch(e){return;}
  if(busy()) return;                                          // re-check after the round-trip
  // Overlay un-synced local changes so the poll never reverts them.
  if(pendingEmp.size){const byId=new Map(emps.map(e=>[e.id,e])); for(const [id,w] of pendingEmp){ if(w.op==='delete') byId.delete(id); else byId.set(id,w.emp);} emps=[...byId.values()];}
  if(JSON.stringify(emps)===JSON.stringify(state.employees)) return;
  state.employees=emps;
  try{localStorage.setItem(LS_LAYOUT,JSON.stringify(state));}catch(e){}
  syncAvatars(); renderPeople(); renderLabels(); dirty2d=true;
  if(mode==='viewer') renderFilters();
}
function startEmpPolling(){ if(!empPollT){ empPollT=setInterval(refreshEmployees,12000); refreshLive(); setInterval(refreshLive,30000); } }
async function saveLayout(){
  try{localStorage.setItem(LS_LAYOUT,JSON.stringify(state));}catch(e){}
  if(!getToken()){openTokenModal(); return;}
  try{
    await apiLayoutPut(state);
    localStorage.removeItem(LS_PENDING); dirty=false;
    setSyncStatus('Збережено '+new Date().toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'}),true);
    if(window.toast) toast('Планування збережено на сервері');
  }catch(e){
    if(e.code===401){localStorage.removeItem(LS_TOKEN); if(window.toast) toast('Невірний код доступу'); openTokenModal(); return;}
    localStorage.setItem(LS_PENDING,'1'); dirty=false;
    setSyncStatus('Збережено локально (сервер недоступний)',true);
    if(window.toast) toast('Сервер недоступний — збережено локально');
  }
}
async function initLoad(){
  let data=null, okServer=false;
  try{data=await apiLayoutGet(); okServer=true;}catch(e){okServer=false;}
  const base={furniture:[],zones:{},rects:[],employees:[],depts:{}};
  if(okServer){
    if(data) state=Object.assign(base,data);
    // Employees are their own source of truth now (bot-owned); the layout blob no
    // longer carries them. Pull the live list; keep the LS copy for offline reloads.
    try{const emps=await apiEmpList(); state.employees=Array.isArray(emps)?emps:[];}catch(e){}
    try{localStorage.setItem(LS_LAYOUT,JSON.stringify(state));}catch(e){}
    if(localStorage.getItem(LS_PENDING)&&getToken()){try{await apiLayoutPut(state); localStorage.removeItem(LS_PENDING);}catch(e){}}
  }else{
    try{const saved=localStorage.getItem(LS_LAYOUT); if(saved) state=Object.assign(base,JSON.parse(saved));}catch(e){}
  }
  return okServer;
}
/* token modal (будується в JS, щоб не чіпати розмітку дизайну) */
function ensureTokenModal(){
  if(document.querySelector('#asTokenModal')) return;
  const wrap=document.createElement('div'); wrap.id='asTokenModal';
  wrap.style.cssText='position:fixed;inset:0;background:rgba(20,10,15,.55);display:none;align-items:center;justify-content:center;z-index:99999';
  wrap.innerHTML='<div style="background:var(--panel-solid,#fff);color:var(--ink,#2B2530);width:360px;max-width:92vw;border-radius:16px;padding:22px;font-family:Nunito,system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.3)">'
    +'<div style="font-weight:800;font-size:18px;margin-bottom:6px">Код доступу HR</div>'
    +'<div style="color:var(--muted,#8A7F86);font-size:14px;line-height:1.5;margin-bottom:14px">Щоб зберегти планування, введіть простий код HR (його встановлює адміністратор у налаштуваннях сервера). Код спитають лише раз — він збережеться у цьому браузері.</div>'
    +'<input id="asTokenInput" type="password" placeholder="Код доступу" style="width:100%;padding:10px;border:1px solid var(--line,#ddd);border-radius:10px;font:inherit;box-sizing:border-box">'
    +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">'
    +'<button id="asTokenCancel" style="padding:9px 14px;border:1px solid var(--line,#ddd);background:transparent;border-radius:10px;font:inherit;cursor:pointer">Скасувати</button>'
    +'<button id="asTokenSave" style="padding:9px 14px;border:none;background:var(--red,#E2001A);color:#fff;border-radius:10px;font:inherit;cursor:pointer">Зберегти код</button>'
    +'</div></div>';
  document.body.appendChild(wrap);
  wrap.querySelector('#asTokenCancel').onclick=()=>{wrap.style.display='none';};
  wrap.querySelector('#asTokenSave').onclick=()=>{const v=wrap.querySelector('#asTokenInput').value.trim(); if(!v){if(window.toast)toast('Введіть код');return;} localStorage.setItem(LS_TOKEN,v); wrap.style.display='none'; if(window.toast)toast('Код збережено'); saveLayout();};
  wrap.querySelector('#asTokenInput').addEventListener('keydown',e=>{if(e.key==='Enter') wrap.querySelector('#asTokenSave').click();});
}
function openTokenModal(){ensureTokenModal(); const w=document.querySelector('#asTokenModal'); w.querySelector('#asTokenInput').value=getToken(); w.style.display='flex'; setTimeout(()=>w.querySelector('#asTokenInput').focus(),30);}
const uid=()=> 'u'+(uidc++)+'_'+Date.now().toString(36);
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const app=$('#app');

/* ---------- three setup ---------- */
const canvas=$('#c');
/* ---------- 2D top-down camera (light Canvas renderer, пункт 1) ---------- */
const c2=$('#c2'); const ctx2=c2.getContext('2d');
// rot ∈ {0,1,2,3} → 0/90/180/270°; flip mirrors the plan. Default rot=1 → office reads landscape.
const ROTC=[1,0,-1,0], ROTS=[0,1,0,-1];
// default 2D orientation: entrance (by Кімната 1) sits in the TOP-RIGHT corner — the real floor-plan look
const view2={ox:OW/2,oz:OD/2,scale:20,rot:1,flip:1};
const activeCanvas=()=>view==='2d'?c2:canvas;
function w2s(x,z){const vx=(x-view2.ox)*view2.scale*view2.flip, vz=(z-view2.oz)*view2.scale; const c=ROTC[view2.rot], s=ROTS[view2.rot]; return {x:innerWidth/2+vx*c-vz*s, y:innerHeight/2+vx*s+vz*c};}
function s2w(px,py){const ax=px-innerWidth/2, ay=py-innerHeight/2; const c=ROTC[view2.rot], s=ROTS[view2.rot]; const vx=ax*c+ay*s, vz=-ax*s+ay*c; return {x:view2.ox+vx/(view2.scale*view2.flip), z:view2.oz+vz/view2.scale};}
function fit2d(){const padX=140,padY=200; const horiz=view2.rot%2===1; const sX=horiz?OD:OW, sY=horiz?OW:OD; view2.scale=Math.max(4,Math.min((innerWidth-padX)/sX,(innerHeight-padY)/sY)); view2.ox=OW/2; view2.oz=OD/2; dirty2d=true;}
function rotateView(dir){view2.rot=((view2.rot+dir)%4+4)%4; fit2d(); dirty2d=true;}
function flipView(){view2.flip*=-1; dirty2d=true;}
// pan in SCREEN space (keys stay intuitive after rotation): convert screen delta → world via inverse rotation
function pan2FromKeys(dt){if(!panKeys.size) return; const px=520*dt; let sx=0,sy=0; if(panKeys.has('f'))sy-=px; if(panKeys.has('b'))sy+=px; if(panKeys.has('l'))sx-=px; if(panKeys.has('r'))sx+=px; const c=ROTC[view2.rot], s=ROTS[view2.rot]; view2.ox+=(sx*c+sy*s)/(view2.scale*view2.flip); view2.oz+=(-sx*s+sy*c)/view2.scale; dirty2d=true;}
function resize2(){const dpr=Math.min(2,devicePixelRatio||1); c2.width=Math.round(innerWidth*dpr); c2.height=Math.round(innerHeight*dpr); c2.style.width=innerWidth+'px'; c2.style.height=innerHeight+'px'; ctx2.setTransform(dpr,0,0,dpr,0,0); dirty2d=true;}
// No WebGL (hardware acceleration off, RDP/VM, old GPU driver): never let the 3D engine crash the
// whole app — hand out a no-op renderer, stay in the 2D plan and keep the phone etc. working.
const GL_OK=(()=>{try{const c=document.createElement('canvas'); return !!c.getContext('webgl2');}catch(e){return false;}})();
function glRenderer(o){
  if(GL_OK){try{return new THREE.WebGLRenderer(o);}catch(e){console.warn('WebGL unavailable — 3D view off:',e.message);}}
  const noop=()=>{}, cv=o.canvas||document.createElement('canvas');
  return {domElement:cv,shadowMap:{},capabilities:{getMaxAnisotropy:()=>1},toneMapping:0,toneMappingExposure:1,stub:true,
    setPixelRatio:noop,setSize:noop,setClearColor:noop,render:noop,dispose:noop,forceContextLoss:noop};}
const renderer=glRenderer({canvas,antialias:true});
const NO_GL=!!renderer.stub;
renderer.setPixelRatio(Math.min(3,devicePixelRatio*1.5));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.NoToneMapping; renderer.toneMappingExposure=1;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(32,1,.1,300);
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true; controls.dampingFactor=.08; controls.maxPolarAngle=1.3; controls.minDistance=5; controls.maxDistance=170; controls.screenSpacePanning=false; controls.enablePan=true; controls.panSpeed=1.1;
const CENTER=new THREE.Vector3(OW/2,0,OD/2);
const hemi=new THREE.HemisphereLight(0xffffff,0xc9b8a8,.55); scene.add(hemi);
scene.add(new THREE.AmbientLight(0xffffff,.22));
const sun=new THREE.DirectionalLight(0xfff3e4,1.0); sun.position.set(OW/2+18,30,OD/2+8); sun.target.position.copy(CENTER); scene.add(sun,sun.target);
sun.castShadow=true; sun.shadow.mapSize.set(4096,4096); sun.shadow.bias=-.0015; sun.shadow.normalBias=.08; sun.shadow.radius=3;
Object.assign(sun.shadow.camera,{left:-26,right:26,top:26,bottom:-26,near:5,far:120});

scene.environment=null;
const matCache={};
const mat=(c,o={})=>{const k=c+JSON.stringify(o); return matCache[k]||(matCache[k]=new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:.85,metalness:0},o)));};
function rshape(w,d,r){const s=new THREE.Shape(),x=-w/2,y=-d/2;r=Math.max(.001,Math.min(r,w/2-.001,d/2-.001));
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+d-r);s.quadraticCurveTo(x+w,y+d,x+w-r,y+d);s.lineTo(x+r,y+d);s.quadraticCurveTo(x,y+d,x,y+d-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
function rbox(w,h,d,r,m,bev=.025){const b=Math.min(bev,h/3,w/4,d/4);
  const g=new THREE.ExtrudeGeometry(rshape(w-2*b,d-2*b,Math.max(.001,r-b)),{depth:Math.max(.001,h-2*b),bevelEnabled:true,bevelThickness:b,bevelSize:b,bevelSegments:3,curveSegments:5});
  g.rotateX(-Math.PI/2); g.translate(0,b,0); const me=new THREE.Mesh(g,m); me.castShadow=true; me.receiveShadow=true; return me;}
const P=(o,x,y,z)=>{o.position.set(x,y,z);return o;};

/* office */
const office=new THREE.Group(); scene.add(office);
const baseMat=new THREE.MeshBasicMaterial({color:'#E5D9C8',toneMapped:false});
const wallMat=mat('#EDE7DF',{roughness:1});
for(const [x0,z0,x1,z1] of WALLS){const len=Math.hypot(x1-x0,z1-z0)+.18; const w=rbox(len,WALL_H,.18,.07,wallMat,.03); w.rotation.y=-Math.atan2(z1-z0,x1-x0); w.position.set((x0+x1)/2,0,(z0+z1)/2); office.add(w);}
// floor grid as mipmapped texture (no line shimmer at grazing angles)
const gridTex=(()=>{const c=document.createElement('canvas'); c.width=c.height=256; const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,256,256); x.fillStyle='rgba(0,0,0,.10)'; x.fillRect(0,0,256,3); x.fillRect(0,0,3,256); const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=renderer.capabilities.getMaxAnisotropy(); t.minFilter=THREE.LinearMipmapLinearFilter; t.colorSpace=THREE.SRGBColorSpace; return t;})();
const floorMats={}; const floorMeshes=[];
for(const r of ROOMS){const m=new THREE.MeshBasicMaterial({color:'#F4EBE1',map:gridTex,toneMapped:false}); floorMats[r.id]=m;
  const polys=r.polys||r.rects.map(([x0,z0,x1,z1])=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]);
  for(const poly of polys){const sh=new THREE.Shape(poly.map(([x,z])=>new THREE.Vector2(x,-z))); const g=new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI/2); const f=new THREE.Mesh(g,m); f.receiveShadow=true; f.userData.room=r.id; office.add(f); floorMeshes.push(f);}}
// entrance mat
const doormat=rbox(1.6,.04,.8,.2,mat('#E2001A',{roughness:.8}),.01); doormat.position.set(3*S,0,.6); doormat.receiveShadow=false; office.add(doormat);
// transparent shadow catcher over the unlit floor (soft shadows without lighting the floor color)
const shadowCatcher=new THREE.Mesh(new THREE.PlaneGeometry(OW+2,OD+2).rotateX(-Math.PI/2),new THREE.ShadowMaterial({opacity:.22})); shadowCatcher.position.set(OW/2,.006,OD/2); shadowCatcher.receiveShadow=true; shadowCatcher.renderOrder=1; office.add(shadowCatcher);
const furnRoot=new THREE.Group(); scene.add(furnRoot);
const grid={set visible(v){for(const k in floorMats){floorMats[k].map=v?gridTex:null; floorMats[k].needsUpdate=true;}}}; const gridMat={color:{set(){}}};
const avRoot=new THREE.Group(); scene.add(avRoot);
const rectRoot=new THREE.Group(); scene.add(rectRoot);
const fxRoot=new THREE.Group(); scene.add(fxRoot);

/* ---------- furniture builders ---------- */
const C={wood:'#E9C79C',white:'#ECE8E3',dark:'#4B4652',red:'#E2001A',green:'#6FBF73',pot:'#D98F6C',coral:'#EF8A80',steel:'#C9CDD2',blue:'#7A8BA8',cream:'#F3EBDD',fridge:'#DFE7EE',book1:'#5B76E6',book2:'#F2C036',book3:'#5DBE7C',screen:'#2E2B36',fabric:'#B9C3D6'};
function mkChair(color=C.blue){const g=new THREE.Group();
  g.add(P(rbox(.46,.09,.46,.1,mat(color)),0,.42,0)); g.add(P(rbox(.46,.42,.07,.06,mat(color)),0,.5,-.2));
  g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,.4,10),mat(C.dark)),0,.22,0)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.23,.23,.04,20),mat(C.dark)),0,.02,0));
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}}); return g;}
const B={
  desk(){const g=new THREE.Group(); g.add(P(rbox(1.5,.07,.75,.05,mat(C.wood)),0,.7,-.25)); g.add(P(rbox(.08,.7,.7,.02,mat(C.white)),-.68,0,-.25)); g.add(P(rbox(.08,.7,.7,.02,mat(C.white)),.68,0,-.25));
    g.add(P(rbox(.5,.04,.35,.03,mat(C.white)),.3,.77,-.25)); const ch=mkChair(); ch.rotation.y=Math.PI; ch.position.set(0,0,.55); g.add(ch); return g;},
  doubleDesk(){const g=new THREE.Group(); for(const s of [-1,1]){g.add(P(rbox(1.5,.07,.75,.05,mat(C.wood)),0,.7,.4*s)); g.add(P(rbox(.08,.7,.7,.02,mat(C.white)),-.68,0,.4*s)); g.add(P(rbox(.08,.7,.7,.02,mat(C.white)),.68,0,.4*s)); const ch=mkChair(); ch.rotation.y=s>0?Math.PI:0; ch.position.set(0,0,1.1*s); g.add(ch);}
    g.add(P(rbox(1.5,.5,.06,.03,mat(C.fabric)),0,.72,0)); return g;},
  chair(){return mkChair(C.coral);},
  monitor(){const g=new THREE.Group(); g.add(P(rbox(.56,.35,.04,.03,mat(C.screen)),0,.14,0)); g.add(P(rbox(.06,.14,.06,.01,mat(C.dark)),0,.0,.03)); g.add(P(rbox(.3,.02,.18,.05,mat(C.dark)),0,0,.04)); return g;},
  partition(){const g=new THREE.Group(); g.add(P(rbox(1.6,1.3,.09,.07,mat(C.fabric)),0,.1,0)); g.add(P(rbox(1.66,.1,.18,.04,mat(C.steel)),0,0,0)); return g;},
  lockers(){const g=new THREE.Group(); g.add(P(rbox(1.2,1.8,.5,.04,mat('#8FA7C4')),0,0,0)); for(const x of [-.4,0,.4]){g.add(P(rbox(.34,1.7,.02,.02,mat('#A3B8D1')),x,.05,.25)); g.add(P(rbox(.04,.12,.03,.01,mat(C.steel)),x+.12,.9,.27));} return g;},
  meeting(){const g=new THREE.Group(); g.add(P(rbox(2.3,.07,1.15,.3,mat(C.wood)),0,.7,0)); for(const [x,z] of [[-.9,-.4],[.9,-.4],[-.9,.4],[.9,.4]]) g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.7,10),mat(C.dark)),x,.35,z));
    for(const s of FURN.meeting.seats){const ch=mkChair(); ch.rotation.y=s.ry; ch.position.set(s.x,0,s.z); g.add(ch);} return g;},
  roundTable(){const g=new THREE.Group(); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.7,.7,.06,32),mat(C.wood)),0,.72,0)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,.7,10),mat(C.dark)),0,.35,0)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.04,24),mat(C.dark)),0,.02,0));
    for(const s of FURN.roundTable.seats){const ch=mkChair(); ch.rotation.y=s.ry; ch.position.set(s.x,0,s.z); g.add(ch);} return g;},
  board(){const g=new THREE.Group(); g.add(P(rbox(1.6,1,.06,.05,mat(C.white)),0,.85,0)); g.add(P(rbox(1.66,.05,.1,.02,mat(C.steel)),0,.82,0)); for(const x of [-.7,.7]){g.add(P(rbox(.05,.85,.05,.01,mat(C.steel)),x,0,0)); g.add(P(rbox(.05,.04,.4,.02,mat(C.steel)),x,0,0));}
    g.add(P(rbox(.5,.05,.02,.01,mat(C.red)),-.3,1.5,.035)); g.add(P(rbox(.7,.05,.02,.01,mat(C.blue)),-.2,1.35,.035)); return g;},
  tv(){const g=new THREE.Group(); g.add(P(rbox(1.4,.8,.06,.03,mat(C.screen)),0,.9,0)); g.add(P(rbox(.08,.9,.08,.02,mat(C.dark)),0,0,-.05)); g.add(P(rbox(.7,.04,.4,.05,mat(C.dark)),0,0,-.05)); g.add(P(rbox(1.2,.55,.01,.01,mat('#5B76E6')),0,1.02,.035)); return g;},
  counter(){const g=new THREE.Group(); g.add(P(rbox(1.8,.86,.6,.05,mat(C.cream)),0,0,0)); g.add(P(rbox(1.86,.05,.66,.04,mat(C.steel)),0,.86,0)); g.add(P(rbox(.5,.02,.36,.06,mat('#9AA3AA')),-.45,.9,0));
    const f=new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,.25,8),mat(C.steel)); f.position.set(-.45,1.02,-.2); g.add(f); return g;},
  fridge(){const g=new THREE.Group(); g.add(P(rbox(.7,1.8,.7,.08,mat(C.fridge)),0,0,0)); g.add(P(rbox(.04,.5,.04,.01,mat(C.steel)),.25,1.0,.36)); g.add(P(rbox(.04,.4,.04,.01,mat(C.steel)),.25,.4,.36)); return g;},
  cooler(){const g=new THREE.Group(); g.add(P(rbox(.36,.95,.36,.06,mat(C.white)),0,0,0)); const b=new THREE.Mesh(new THREE.CylinderGeometry(.13,.15,.4,16),new THREE.MeshStandardMaterial({color:'#8FD3F4',transparent:true,opacity:.75,roughness:.2})); b.position.set(0,1.16,0); g.add(b); g.add(P(rbox(.16,.06,.06,.02,mat('#3EA8C9')),0,.6,.19)); return g;},
  barTable(){const g=new THREE.Group(); g.add(P(rbox(1.2,.06,.6,.1,mat(C.wood)),0,1.05,0)); g.add(P(rbox(.1,1.05,.1,.02,mat(C.dark)),0,0,0)); g.add(P(rbox(.7,.04,.4,.04,mat(C.dark)),0,0,0));
    for(const x of [-.3,.3]){g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.16,.16,.05,16),mat(C.coral)),x,.7,.55)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.7,8),mat(C.dark)),x,.35,.55)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,.03,16),mat(C.dark)),x,.015,.55));} return g;},
  reception(){const g=new THREE.Group(); g.add(P(rbox(2.2,1.05,.7,.12,mat(C.red)),0,0,.2)); g.add(P(rbox(2.3,.06,.8,.14,mat(C.white)),0,1.05,.2)); g.add(P(rbox(1.6,.72,.5,.04,mat(C.wood)),0,0,-.35));
    const ch=mkChair(); ch.position.set(0,0,-.6); g.add(ch); return g;},
  sofa(){const g=new THREE.Group(); g.add(P(rbox(1.8,.42,.8,.12,mat(C.coral)),0,0,0)); g.add(P(rbox(1.8,.42,.22,.09,mat(C.coral)),0,.4,-.3)); g.add(P(rbox(.22,.6,.8,.09,mat(C.coral)),-.8,0,0)); g.add(P(rbox(.22,.6,.8,.09,mat(C.coral)),.8,0,0)); return g;},
  armchair(){const g=new THREE.Group(); const m=mat('#7FB7A4'); g.add(P(rbox(.85,.42,.8,.12,m),0,0,0)); g.add(P(rbox(.85,.45,.22,.09,m),0,.4,-.3)); g.add(P(rbox(.2,.6,.8,.09,m),-.33,0,0)); g.add(P(rbox(.2,.6,.8,.09,m),.33,0,0)); return g;},
  bench(){const g=new THREE.Group(); g.add(P(rbox(1.8,.1,.5,.06,mat(C.fabric)),0,.38,0)); for(const x of [-.75,.75]) g.add(P(rbox(.06,.38,.44,.02,mat(C.steel)),x,0,0)); return g;},
  coffeeTable(){const g=new THREE.Group(); g.add(P(rbox(.9,.05,.5,.1,mat(C.wood)),0,.38,0)); for(const [x,z] of [[-.38,-.18],[.38,-.18],[-.38,.18],[.38,.18]]) g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,.38,8),mat(C.dark)),x,.19,z)); return g;},
  shelf(){const g=new THREE.Group(); g.add(P(rbox(1,1.8,.35,.04,mat(C.wood)),0,0,0)); for(const y of [.45,.9,1.35]) g.add(P(rbox(.9,.03,.3,.01,mat(C.cream)),0,y,.02));
    let x=-.38; for(const c of [C.book1,C.book2,C.book3,C.red,C.book1,C.book3]){g.add(P(rbox(.08,.28,.22,.01,mat(c)),x,.48,.03)); x+=.11;} x=-.38; for(const c of [C.book2,C.red,C.book3,C.book1]){g.add(P(rbox(.09,.24,.22,.01,mat(c)),x,.93,.03)); x+=.12;} return g;},
  rack(){const g=new THREE.Group(); for(const x of [-.85,.85]) for(const z of [-.27,.27]) g.add(P(rbox(.05,2,.05,.01,mat(C.steel)),x,0,z)); for(const y of [.05,.7,1.35]) g.add(P(rbox(1.75,.04,.6,.01,mat(C.steel)),0,y,0));
    for(const [x,y,w] of [[-.5,.09,.5],[.2,.09,.6],[-.4,.74,.7],[.45,.74,.4],[0,1.39,.55]]) g.add(P(rbox(w,.42,.45,.02,mat('#D8B98A')),x,y,0)); return g;},
  printer(){const g=new THREE.Group(); g.add(P(rbox(.7,.7,.55,.04,mat(C.cream)),0,0,0)); g.add(P(rbox(.6,.4,.5,.06,mat(C.white)),0,.7,0)); g.add(P(rbox(.3,.02,.2,.02,mat(C.screen)),.1,1.1,.1)); g.add(P(rbox(.45,.03,.3,.02,mat(C.steel)),-.02,1.1,-.1)); return g;},
  plant(){const g=new THREE.Group(); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.2,.15,.38,16),mat(C.pot)),0,.19,0)); for(const [x,y,z,r] of [[0,.7,0,.3],[-.18,.55,.1,.2],[.17,.6,-.1,.22]]){const s=new THREE.Mesh(new THREE.SphereGeometry(r,16,12),mat(C.green)); s.position.set(x,y,z); g.add(s);} return g;},
  lamp(){const g=new THREE.Group(); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.16,.16,.03,20),mat(C.dark)),0,.015,0)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,1.5,8),mat(C.dark)),0,.75,0)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.22,.16,.3,20,1,true),new THREE.MeshStandardMaterial({color:'#F6D389',side:THREE.DoubleSide,emissive:'#F6D389',emissiveIntensity:.35})),0,1.55,0)); return g;},
  deskPC(){const g=B.desk(); const mon=B.monitor(); mon.position.set(-.12,.77,-.3); g.add(mon); g.add(P(rbox(.45,.02,.16,.02,mat(C.dark)),.12,.775,-.05)); g.add(P(rbox(.16,.4,.42,.03,mat('#3a3742')),.62,.2,-.28)); return g;},
  pod4(){const g=new THREE.Group(); for(const sx of [-1,1]) for(const s of [-1,1]){const x=sx*.8; g.add(P(rbox(1.35,.07,.7,.05,mat(C.wood)),x,.7,s*.4)); const mon=B.monitor(); mon.position.set(x,.74,s*.18); mon.rotation.y=s>0?0:Math.PI; g.add(mon); const ch=mkChair(); ch.rotation.y=s>0?Math.PI:0; ch.position.set(x,0,s*1.05); g.add(ch);} g.add(P(rbox(3.0,.5,.06,.03,mat(C.fabric)),0,.72,0)); g.add(P(rbox(.06,.5,1.5,.03,mat(C.fabric)),0,.72,0)); return g;},
  standingDesk(){const g=new THREE.Group(); g.add(P(rbox(1.3,.06,.65,.05,mat(C.wood)),0,1.05,0)); for(const x of [-.55,.55]) g.add(P(rbox(.08,1.05,.5,.02,mat(C.steel)),x,0,0)); const mon=B.monitor(); mon.position.set(0,1.09,-.12); g.add(mon); return g;},
  drawerCab(){const g=new THREE.Group(); g.add(P(rbox(.55,.62,.5,.04,mat('#C9B79C')),0,0,0)); for(const y of [.14,.34,.54]){g.add(P(rbox(.5,.16,.02,.02,mat(C.cream)),0,y,.25)); g.add(P(rbox(.14,.03,.03,.01,mat(C.steel)),0,y,.27));} return g;},
  phoneBooth(){const g=new THREE.Group(); const w=mat('#6E7A8F'); g.add(P(rbox(1.2,2.0,.1,.05,w),0,0,-.55)); g.add(P(rbox(.1,2.0,1.1,.05,w),-.55,0,0)); g.add(P(rbox(.1,2.0,1.1,.05,w),.55,0,0)); g.add(P(rbox(1.2,.12,1.2,.05,w),0,1.95,0)); g.add(P(rbox(.9,.04,.35,.03,mat(C.wood)),0,.75,-.3)); const glass=new THREE.Mesh(new THREE.BoxGeometry(1.0,1.6,.04),new THREE.MeshStandardMaterial({color:'#CFE6F2',transparent:true,opacity:.28,roughness:.1})); glass.position.set(0,1.0,.55); g.add(glass); const ch=mkChair(); ch.rotation.y=Math.PI; ch.position.set(0,0,.1); g.add(ch); return g;},
  flipchart(){const g=new THREE.Group(); g.add(P(rbox(.8,1.1,.04,.03,mat(C.white)),0,1.2,0)); g.add(P(rbox(.86,.06,.06,.02,mat(C.steel)),0,1.75,0)); for(const x of [-.35,.35]) g.add(P(rbox(.05,1.2,.05,.01,mat(C.steel)),x,0,0)); g.add(P(rbox(.05,.05,.5,.02,mat(C.steel)),0,0,.1)); g.add(P(rbox(.45,.05,.02,.01,mat(C.red)),-.05,1.35,.03)); g.add(P(rbox(.3,.05,.02,.01,mat(C.blue)),0,1.2,.03)); return g;},
  diningTable(){const g=new THREE.Group(); g.add(P(rbox(1.8,.06,.9,.08,mat(C.wood)),0,.72,0)); for(const [x,z] of [[-.75,-.32],[.75,-.32],[-.75,.32],[.75,.32]]) g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.72,10),mat(C.dark)),x,.36,z)); for(const s of FURN.diningTable.seats){const ch=mkChair(); ch.rotation.y=s.ry; ch.position.set(s.x,0,s.z); g.add(ch);} return g;},
  stool(){const g=new THREE.Group(); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.06,16),mat(C.coral)),0,.5,0)); for(const a of [0,1,2]){const an=a/3*Math.PI*2; g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,.5,8),mat(C.dark)),Math.cos(an)*.15,.25,Math.sin(an)*.15));} return g;},
  coffeeMachine(){const g=new THREE.Group(); g.add(P(rbox(.5,.86,.45,.04,mat(C.cream)),0,0,0)); g.add(P(rbox(.44,.5,.4,.05,mat('#3a3742')),0,1.15,0)); g.add(P(rbox(.3,.02,.25,.02,mat(C.steel)),0,.88,.05)); g.add(P(rbox(.2,.14,.02,.02,mat('#5B76E6')),0,1.2,.21)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.1,10),mat(C.steel)),0,.98,.14)); return g;},
  microwave(){const g=new THREE.Group(); g.add(P(rbox(.55,.34,.42,.04,mat(C.white)),0,.17,0)); g.add(P(rbox(.36,.24,.02,.02,mat('#2E2B36')),-.06,.17,.22)); g.add(P(rbox(.1,.24,.03,.02,mat(C.steel)),.2,.17,.21)); g.add(P(rbox(.06,.06,.02,.01,mat('#5DBE7C')),.2,.24,.22)); return g;},
  vending(){const g=new THREE.Group(); g.add(P(rbox(.9,1.9,.7,.06,mat('#C0392B')),0,0,0)); g.add(P(rbox(.56,1.4,.03,.02,new THREE.MeshStandardMaterial({color:'#2E2B36',transparent:true,opacity:.5})),-.12,1.05,.35)); for(let r=0;r<4;r++)for(let c=0;c<3;c++) g.add(P(rbox(.12,.16,.02,.02,mat([C.book2,C.green,C.coral,C.blue][(r+c)%4])),-.28+c*.16,.6+r*.28,.36)); g.add(P(rbox(.26,.5,.05,.03,mat('#8a1f14')),.28,.55,.36)); return g;},
  beanbag(){const g=new THREE.Group(); const m=mat('#F2C036'); const b=new THREE.Mesh(new THREE.SphereGeometry(.5,20,16),m); b.scale.set(1,.7,1); b.position.y=.34; b.castShadow=true; g.add(b); const t=new THREE.Mesh(new THREE.SphereGeometry(.32,16,12),m); t.scale.set(1,.5,1); t.position.set(0,.55,-.16); t.castShadow=true; g.add(t); return g;},
  pouf(){const g=new THREE.Group(); const b=new THREE.Mesh(new THREE.CylinderGeometry(.35,.38,.4,20),mat('#7FB7A4')); b.position.y=.2; b.castShadow=true; g.add(b); return g;},
  coatRack(){const g=new THREE.Group(); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,1.8,10),mat(C.dark)),0,.9,0)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,.04,16),mat(C.dark)),0,.02,0)); for(const a of [0,1,2,3]){const an=a/4*Math.PI*2; g.add(P(new THREE.Mesh(new THREE.SphereGeometry(.04,8,8),mat(C.steel)),Math.cos(an)*.18,1.7,Math.sin(an)*.18));} g.add(P(rbox(.4,.6,.12,.06,mat(C.blue)),-.12,1.1,.08)); return g;},
  foosball(){const g=new THREE.Group(); g.add(P(rbox(1.4,.14,.8,.05,mat('#2f7d46')),0,.78,0)); g.add(P(rbox(1.44,.5,.84,.06,mat(C.wood)),0,.4,0)); for(const x of [-.6,-.2,.2,.6]) g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,1.0,8).rotateZ(Math.PI/2),mat(C.steel)),x,.95,0)); for(const [x,z] of [[-.65,-.42],[.65,-.42],[-.65,.42],[.65,.42]]) g.add(P(rbox(.1,.4,.1,.02,mat(C.dark)),x,0,z)); return g;},
  filingCab(){const g=new THREE.Group(); g.add(P(rbox(.6,1.3,.55,.04,mat('#9AA6B2')),0,0,0)); for(const y of [.28,.65,1.02]){g.add(P(rbox(.52,.32,.02,.02,mat('#AEB9C4')),0,y,.28)); g.add(P(rbox(.16,.03,.03,.01,mat(C.steel)),0,y,.3));} return g;},
  safe(){const g=new THREE.Group(); g.add(P(rbox(.6,.7,.6,.05,mat('#4B4652')),0,0,0)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.06,20).rotateX(Math.PI/2),mat(C.steel)),.12,.35,.31)); g.add(P(rbox(.22,.03,.03,.01,mat(C.steel)),.12,.35,.33)); g.add(P(rbox(.3,.1,.02,.02,mat(C.dark)),-.1,.5,.31)); return g;},
  serverRack(){const g=new THREE.Group(); g.add(P(rbox(.7,2.0,.9,.04,mat('#2b2933')),0,0,0)); for(let i=0;i<8;i++){g.add(P(rbox(.6,.16,.02,.01,mat('#3a3742')),0,.32+i*.2,.44)); g.add(P(new THREE.Mesh(new THREE.CircleGeometry(.02,8),new THREE.MeshStandardMaterial({color:i%2?'#5DBE7C':'#3EA8C9',emissive:i%2?'#5DBE7C':'#3EA8C9',emissiveIntensity:.6,toneMapped:false})),.22,.32+i*.2,.46));} return g;},
  bigPlant(){const g=new THREE.Group(); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.28,.22,.55,16),mat('#B5714E')),0,.27,0)); const lm=mat('#4FA167'); for(const [x,y,z,r] of [[0,1.05,0,.42],[-.28,.82,.12,.3],[.26,.92,-.1,.34],[.1,1.3,.1,.28]]){const s=new THREE.Mesh(new THREE.SphereGeometry(r,16,12),lm); s.position.set(x,y,z); s.castShadow=true; g.add(s);} return g;},
  wallClock(){const g=new THREE.Group(); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.3,.3,.06,24).rotateX(Math.PI/2),mat(C.white)),0,1.6,0)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.26,.26,.02,24).rotateX(Math.PI/2),mat('#EFE9E2')),0,1.6,.04)); g.add(P(rbox(.02,.18,.01,.005,mat(C.dark)),0,1.66,.06)); g.add(P(rbox(.13,.02,.01,.005,mat(C.red)),.05,1.6,.06)); return g;},
  picture(){const g=new THREE.Group(); g.add(P(rbox(.7,.5,.04,.02,mat('#C9B79C')),0,1.5,0)); g.add(P(rbox(.58,.38,.02,.01,mat('#7FB7D6')),0,1.5,.03)); g.add(P(rbox(.3,.2,.02,.005,mat('#F2C036')),-.1,1.45,.04)); return g;},
  fan(){const g=new THREE.Group(); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.16,.2,.04,16),mat(C.dark)),0,.02,0)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,1.0,8),mat(C.steel)),0,.5,0)); const head=new THREE.Mesh(new THREE.CylinderGeometry(.25,.25,.1,20).rotateX(Math.PI/2),new THREE.MeshStandardMaterial({color:'#DDE3EA',transparent:true,opacity:.7})); head.position.set(0,1.0,0); g.add(head); g.add(P(new THREE.Mesh(new THREE.SphereGeometry(.06,10,10),mat(C.blue)),0,1.0,.03)); return g;},
  trashBin(){const g=new THREE.Group(); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.16,.13,.45,16),mat('#9AA6B2')),0,.22,0)); g.add(P(new THREE.Mesh(new THREE.CylinderGeometry(.17,.17,.03,16),mat('#7E8A96')),0,.45,0)); return g;},
  rug(){const g=new THREE.Group(); g.add(P(rbox(2.4,.02,1.6,.3,mat('#F1B7BC'),.005),0,0,0)); g.add(P(rbox(1.9,.021,1.1,.2,mat('#F7D2D5'),.005),0,0,0)); return g;}
};
// measure each model once: footprint = exact bbox rounded up to .25m, re-centered on bbox center
(function measure(){for(const t in FURN){const g=B[t](); const b=new THREE.Box3().setFromObject(g); const s=b.getSize(new THREE.Vector3()), c=b.getCenter(new THREE.Vector3()); const d=FURN[t]; d.w=Math.max(.25,Math.round(s.x*CS*4)/4); d.d=Math.max(.25,Math.round(s.z*CS*4)/4); d.off={x:c.x*CS,z:c.z*CS}; if(d.seats) d.seats=d.seats.map(q=>({...q,x:(q.x-c.x)*CS,z:(q.z-c.z)*CS}));}})();
function buildFurn(type){const g=new THREE.Group(); const inner=B[type](); inner.scale.setScalar(CS); inner.position.set(-FURN[type].off.x,0,-FURN[type].off.z); g.add(inner); g.userData.type=type; return g;}

/* ---------- avatars (GLB stickman) ---------- */
const MODELS={sit:'assets/models/sit.glb',stand:'assets/models/stand.glb',walk:'assets/models/walk.glb'}; const modelBuf={}; const gltfLoader=new GLTFLoader(); const MODEL_H=1.7, AV_SCALE=.88*CS; const mixers=new Set();
const modelsReady=Promise.all(Object.keys(MODELS).map(async k=>{modelBuf[k]=await (await fetch(MODELS[k])).arrayBuffer();})).catch(()=>{});
function loadPose(g,pose){const key=pose===true?'sit':pose===false?'stand':pose; if(g.userData.poseKey===key) return; g.userData.poseKey=key; g.userData.tagY=(key==='sit'?1.15:MODEL_H)*AV_SCALE;
  if(g.userData.inner){g.remove(g.userData.inner); g.userData.inner.traverse(o=>{if(o.isMesh){o.geometry.dispose(); o.material.dispose();}}); g.userData.inner=null;}
  if(g.userData.mixer){g.userData.mixer.stopAllAction(); mixers.delete(g.userData.mixer); g.userData.mixer=null;}
  const shirt=g.userData.shirt, op=g.userData.opacity??1;
  modelsReady.then(()=>{if(!modelBuf[key]||g.userData.disposed||g.userData.poseKey!==key) return; gltfLoader.parse(modelBuf[key].slice(0),'',gltf=>{if(g.userData.disposed||g.userData.poseKey!==key) return; const m=gltf.scene; m.scale.setScalar(AV_SCALE);
    m.traverse(o=>{if(o.isMesh){o.castShadow=true; o.receiveShadow=false; o.frustumCulled=false; o.material=new THREE.MeshStandardMaterial({color:shirt,roughness:.75}); if(op<1){o.material.transparent=true;o.material.opacity=op;o.material.depthWrite=false;}}});
    g.add(m); g.userData.inner=m; if(gltf.animations.length){const mx=new THREE.AnimationMixer(m); const a=mx.clipAction(gltf.animations[0]); a.time=Math.random()*a.getClip().duration; a.play(); g.userData.mixer=mx; mixers.add(mx);}});});}
function buildAvatar(style,shirt,seated,withGem){const g=new THREE.Group(); g.userData.shirt=shirt; g.userData.opacity=1; loadPose(g,seated);
  if(withGem){const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.14,0),new THREE.MeshStandardMaterial({color:'#4CAF6E',emissive:'#4CAF6E',emissiveIntensity:1.2,roughness:.2,metalness:.1,toneMapped:false})); gem.scale.set(.9,1.7,.9); g.userData.gem=gem; g.add(gem);}
  return g;}
function disposeAvatar(g){g.userData.disposed=true; if(g.userData.mixer){g.userData.mixer.stopAllAction(); mixers.delete(g.userData.mixer);} if(g.userData.moodSprite) g.userData.moodSprite.material.dispose(); if(g.userData.badgeSprite) g.userData.badgeSprite.material.dispose(); if(g.userData.photoSprite){g.userData.photoSprite.material.map.dispose(); g.userData.photoSprite.material.dispose();}}
/* ---- mood emoji above the head (пункт 5): a billboard sprite, always visible ---- */
const _moodTex={};
function moodTex(emoji){if(_moodTex[emoji]) return _moodTex[emoji]; const cv=document.createElement('canvas'); cv.width=cv.height=128; const x=cv.getContext('2d');
  x.beginPath(); x.arc(64,60,52,0,Math.PI*2); x.fillStyle='rgba(255,255,255,.92)'; x.fill(); x.lineWidth=4; x.strokeStyle='rgba(70,45,30,.18)'; x.stroke();
  x.font='72px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; x.textAlign='center'; x.textBaseline='middle'; x.fillText(emoji,64,64);
  const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=8; _moodTex[emoji]=t; return t;}
function makeMoodSprite(emoji){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:moodTex(emoji),transparent:true,depthWrite:false,depthTest:false,toneMapped:false})); sp.scale.set(.55,.55,.55); sp.renderOrder=10; return sp;}
function setAvatarMood(g,emoji){let ms=g.userData.moodSprite; if(!ms){ms=makeMoodSprite(emoji); g.userData.moodSprite=ms; g.userData.moodEmoji=emoji; g.add(ms);} else if(g.userData.moodEmoji!==emoji){ms.material.map=moodTex(emoji); ms.material.needsUpdate=true; g.userData.moodEmoji=emoji;}}
function updateAvatarMood(id){const g=avObjs[id], e=state.employees.find(x=>x.id===id); if(!g||!e) return; setAvatarMood(g,(MOODS[e.mood]||MOODS.good).e);}
/* ---- live office (spec 005): booked rooms, "in a meeting" people — from /office/now ----
   Side map only; never written into state/employees (keeps the poll diff + upserts clean). */
let LIVE={rooms:{},busy:{},at:0};
const liveUntil=x=>x&&new Date(x.until)>new Date()?new Date(x.until):null;
const hhmm=d=>String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
const busyOf=e=>liveUntil(LIVE.busy[e.id]);
const badgeOf=e=>busyOf(e)?'📅':(LIVE.birthdays||[]).includes(e.id)?'🎂':(LIVE.anniversaries||[]).some(a=>a.id===e.id)?'🏅':'';
// Seat for today: the permanent one wins; otherwise a hot desk booked in the Mini App (in office only).
const seatRef=e=>e.seat||(statusOf(e)==='office'&&LIVE.desks&&LIVE.desks[e.id])||null;
const roomBusy=key=>liveUntil(LIVE.rooms[key]);
async function refreshLive(){try{const r=await fetch(API+'/office/now'); if(!r.ok) return; LIVE=Object.assign(LIVE,await r.json()); applyLive();}catch(e){}}
function applyLive(){renderLabels(); syncAvatars(); dirty2d=true; if(LIVE.onUpdate) LIVE.onUpdate();}
function setAvatarBadge(g,emoji){let b=g.userData.badgeSprite;
  if(!emoji){if(b){g.remove(b); b.material.dispose(); g.userData.badgeSprite=null; g.userData.badge='';} return;}
  if(!b){b=makeMoodSprite(emoji); b.scale.set(.42,.42,.42); g.userData.badgeSprite=b; g.add(b);} else if(g.userData.badge!==emoji){b.material.map=moodTex(emoji); b.material.needsUpdate=true;}
  g.userData.badge=emoji;}
function setOpacity(g,a){g.userData.opacity=a; g.traverse(o=>{if(o.isMesh&&o!==g.userData.gem){o.material.transparent=a<1;o.material.opacity=a;o.material.depthWrite=a>=1;}});}
/* ---- profile photo on the figure (bot/web uploads): a circular billboard badge ---- */
const _photoImg={}; // employee id -> {src, img, ready}
function photoImage(e){ if(!e||!e.photo) return null;
  let rec=_photoImg[e.id];
  if(!rec||rec.src!==e.photo){ rec={src:e.photo,img:new Image(),ready:false}; _photoImg[e.id]=rec;
    rec.img.onload=()=>{rec.ready=true; dirty2d=true; const g=avObjs[e.id]; if(g&&g.userData.photoDraw) g.userData.photoDraw();};
    rec.img.onerror=()=>{rec.ready=false;}; rec.img.src=e.photo; }
  return rec.ready?rec.img:null; }
// Draws a circular photo (or colour+initials fallback) into a 128px canvas texture.
function drawPhotoCanvas(x,e){ x.clearRect(0,0,128,128); x.save(); x.beginPath(); x.arc(64,64,60,0,Math.PI*2); x.closePath(); x.clip();
  const img=photoImage(e);
  if(img){const s=Math.max(128/img.width,128/img.height),dw=img.width*s,dh=img.height*s; x.drawImage(img,64-dw/2,64-dh/2,dw,dh);}
  else {x.fillStyle=e.color||'#888'; x.fillRect(0,0,128,128); x.fillStyle='#fff'; x.font='700 52px Nunito'; x.textAlign='center'; x.textBaseline='middle'; x.fillText(initials(e.name),64,64);}
  x.restore(); x.beginPath(); x.arc(64,64,60,0,Math.PI*2); x.lineWidth=7; x.strokeStyle='#fff'; x.stroke(); }
function setAvatarPhoto(g,e){
  if(!e.photo){ if(g.userData.photoSprite){g.remove(g.userData.photoSprite); g.userData.photoSprite.material.map.dispose(); g.userData.photoSprite.material.dispose(); g.userData.photoSprite=null; g.userData.photoDraw=null; g.userData.photoKey=null;} return; }
  if(g.userData.photoSprite&&g.userData.photoKey===e.photo){ g.userData.photoDraw&&g.userData.photoDraw(); return; }
  if(g.userData.photoSprite){g.remove(g.userData.photoSprite); g.userData.photoSprite.material.map.dispose(); g.userData.photoSprite.material.dispose();}
  const cv=document.createElement('canvas'); cv.width=cv.height=128; const x=cv.getContext('2d');
  const tex=new THREE.CanvasTexture(cv); tex.colorSpace=THREE.SRGBColorSpace; tex.anisotropy=8;
  const draw=()=>{drawPhotoCanvas(x,e); tex.needsUpdate=true;};
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,depthTest:false,toneMapped:false})); sp.scale.set(.5,.5,.5); sp.renderOrder=11;
  g.userData.photoSprite=sp; g.userData.photoDraw=draw; g.userData.photoKey=e.photo; g.add(sp); draw(); }

/* ---------- geometry helpers ---------- */
const fp=(f)=>{const def=FURN[f.type]; const odd=f.rot%2; return {w:odd?def.d:def.w,d:odd?def.w:def.d};};
const roomRects=()=>ROOMS.flatMap(r=>r.rects.map(rc=>({rc,room:r.id})));
function roomAt(x,z){for(const {rc,room} of roomRects()){if(x>=rc[0]&&x<=rc[2]&&z>=rc[1]&&z<=rc[3]) return room;} return null;}
function fits(f){const {w,d}=fp(f); const x0=f.x-w/2,z0=f.z-d/2,x1=f.x+w/2,z1=f.z+d/2; const e=.01;
  const inRoom=roomRects().some(({rc})=>x0>=rc[0]-e&&z0>=rc[1]-e&&x1<=rc[2]+e&&z1<=rc[3]+e); if(!inRoom) return false;
  if(FURN[f.type].onDesk||FURN[f.type].underlay) return true;
  return !state.furniture.some(o=>{if(o.uid===f.uid||FURN[o.type].onDesk||FURN[o.type].underlay) return false; const p=fp(o); return Math.abs(o.x-f.x)<(p.w+w)/2-e&&Math.abs(o.z-f.z)<(p.d+d)/2-e;});}
function deskUnder(f){return state.furniture.find(o=>['desk','doubleDesk','meeting','roundTable','reception','counter','barTable'].includes(o.type)&&(()=>{const p=fp(o);return Math.abs(o.x-f.x)<p.w/2&&Math.abs(o.z-f.z)<p.d/2;})());}
// magnetic "smart-guide" snap: while dragging, snap the piece's near/far EDGE or its
// CENTRE to any nearby neighbour edge/centre or room wall within MAG metres. This gives
// both flush placement (edge→neighbour's opposite edge / wall) AND tidy alignment
// (edge→edge, centre→centre) on each axis independently, so pieces butt together in clean
// rows. An overlap guard stops the magnet from ever pulling a piece into another one.
const MAG=.5;
function magnetSnap(f){const D=FURN[f.type]; if(D.onDesk||D.underlay) return; const {w,d}=fp(f);
  const neigh=[]; for(const o of state.furniture){if(o.uid===f.uid||FURN[o.type].onDesk||FURN[o.type].underlay) continue; neigh.push({o,p:fp(o)});}
  // candidate CENTRE positions for f on each axis. From each neighbour edge/centre we
  // derive the three centres that make f's near edge / far edge / centre coincide with it
  // (→ flush butting AND edge/centre alignment). From the *current* room's walls we add
  // the two hug centres. Nearest candidate within MAG wins per axis.
  const cx=[],cz=[];
  for(const {o,p} of neigh){for(const L of [o.x-p.w/2,o.x+p.w/2,o.x]) cx.push(L-w/2,L+w/2,L); for(const L of [o.z-p.d/2,o.z+p.d/2,o.z]) cz.push(L-d/2,L+d/2,L);}
  for(const {rc} of roomRects()){if(f.x<rc[0]-MAG||f.x>rc[2]+MAG||f.z<rc[1]-MAG||f.z>rc[3]+MAG) continue; cx.push(rc[0]+w/2,rc[2]-w/2); cz.push(rc[1]+d/2,rc[3]-d/2);}
  const pick=(cur,cands)=>{let bv=cur,bd=MAG; for(const c of cands){const dd=Math.abs(c-cur); if(dd<bd){bd=dd;bv=c;}} return bv;};
  let nx=pick(f.x,cx), nz=pick(f.z,cz);
  const hits=(x,z)=>neigh.some(({o,p})=>Math.abs(o.x-x)<(p.w+w)/2-.02&&Math.abs(o.z-z)<(p.d+d)/2-.02);
  if(hits(nx,nz)){ if(!hits(f.x,nz)) nx=f.x; else if(!hits(nx,f.z)) nz=f.z; else {nx=f.x; nz=f.z;} } // never magnet into an overlap
  f.x=nx; f.z=nz;}
function seatWorld(f,i){const s=FURN[f.type].seats[i]; const a=f.rot*Math.PI/2; const c=Math.cos(a),sn=Math.sin(a); return {x:f.x+s.x*c+s.z*sn, z:f.z-s.x*sn+s.z*c, y:s.y, ry:a+s.ry};}
const seatTaken=(fu,i)=>state.employees.some(e=>{const s=seatRef(e); return s&&s.f===fu&&s.i===i;});
function roomName(id){const r=ROOMS.find(r=>r.id===id); if(!r) return ''; const z=state.zones[id]; return z?(z.name||ZONES[z.type].n):(r.label||('Кімната '+r.n));}
function liveRoomName(key){if(String(key).startsWith('rz:')){const rz=state.rects.find(x=>'rz:'+x.uid===key); return rz?(rz.name||ZONES[rz.type].n):'';} return roomName(key);}
function roomCenter(r){const rc=r.rects[0]; return new THREE.Vector3((rc[0]+rc[2])/2,0,(rc[1]+rc[3])/2);}

/* ---------- scene sync ---------- */
const furnObjs={}, avObjs={}, rectObjs={};
function syncFurniture(){dirty2d=true; if(view==='2d') return; const live=new Set();
  for(const f of state.furniture){live.add(f.uid); let g=furnObjs[f.uid]; if(!g){g=buildFurn(f.type); g.userData.uid=f.uid; furnRoot.add(g); furnObjs[f.uid]=g;}
    g.position.set(f.x,FURN[f.type].onDesk&&deskUnder(f)?(deskUnder(f).type==='counter'?.9*CS:.75*CS):0.02,f.z); g.rotation.y=f.rot*Math.PI/2;}
  for(const k in furnObjs) if(!live.has(k)){furnRoot.remove(furnObjs[k]); delete furnObjs[k];}}
function syncAvatars(){dirty2d=true; const live=new Set();
  for(const e of state.employees){ if(e.seat && !state.furniture.find(x=>x.uid===e.seat.f)) e.seat=null;
    // present in the office if seated OR simply in-office (unassigned people wander freely)
    if(!seatRef(e) && statusOf(e)!=='office') continue; live.add(e.id);
    if(view==='2d') continue; // light 2D mode: no 3D avatar objects (draw2D reads state directly)
    let g=avObjs[e.id]; const key=e.color; if(g&&g.userData.key!==key){avRoot.remove(g); disposeAvatar(g); g=null;}
    if(!g){g=buildAvatar(settings.avatar,e.color,!!seatRef(e),true); g.userData.key=key; g.userData.emp=e.id; avRoot.add(g); avObjs[e.id]=g;}
    setAvatarMood(g,(MOODS[e.mood]||MOODS.good).e);
    setAvatarPhoto(g,e);
    setAvatarBadge(g,badgeOf(e));
    const p=empPos(e); if(p){g.position.set(p.x,.02,p.z);} }
  for(const k in avObjs) if(!live.has(k)){avRoot.remove(avObjs[k]); disposeAvatar(avObjs[k]); delete avObjs[k];}
  if(view!=='2d') refreshAvatarLook();}
// a zone's fill colour: an explicit custom colour wins over the type's default palette colour
function zoneColor(z){return (z&&z.color)||(z&&ZONES[z.type]?ZONES[z.type].c:'#CFC2AD');}
function syncZones(){dirty2d=true; if(view==='2d') return; const th=THEMES[settings.theme];
  for(const r of ROOMS){const base=new THREE.Color(r.corridor?th.cor:th.floor); const z=state.zones[r.id]; if(z) base.lerp(new THREE.Color(zoneColor(z)),th.zone); floorMats[r.id].color.copy(base);}
  const live=new Set(); for(const rz of state.rects){live.add(rz.uid); let m=rectObjs[rz.uid]; if(!m){m=new THREE.Mesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({transparent:true,opacity:.6,roughness:1})); rectRoot.add(m); rectObjs[rz.uid]=m;}
    m.material.color.set(zoneColor(rz)); m.position.set((rz.x0+rz.x1)/2,.012,(rz.z0+rz.z1)/2); m.scale.set(Math.max(.01,rz.x1-rz.x0),1,Math.max(.01,rz.z1-rz.z0));}
  for(const k in rectObjs) if(!live.has(k)){rectRoot.remove(rectObjs[k]); delete rectObjs[k];}}
function applyTheme(){const th=THEMES[settings.theme]; app.dataset.ui=th.ui; app.style.background=th.bg; scene.background=new THREE.Color(th.bg); baseMat.color.set(th.base); wallMat.color.set(th.wall); gridMat.color.set(th.ui==='dark'?'#ffffff':'#000000');
  hemi.intensity=th.ui==='dark'?.35:.55; sun.intensity=th.ui==='dark'?.7:1.0; baseMat.color.set(th.ui==='dark'?'#26242E':'#E5D9C8'); syncZones();}
function syncAll(){syncFurniture(); syncAvatars(); syncZones(); renderPeople(); renderLabels(true);}

/* ---------- labels (HTML overlays) ---------- */
const labelsEl=$('#labels'); const roomLabelEls={}, tagEls={}; let hlEmp=null, filterDept=null, hoverEmp=null;
function renderLabels(rebuild){
  for(const r of ROOMS){let el=roomLabelEls[r.id]; if(!el){el=document.createElement('div'); el.className='rl'; el.dataset.room=r.id; el.addEventListener('click',()=>{if(mode==='builder'&&tab==='zones') openZonePop({room:r.id});}); labelsEl.appendChild(el); roomLabelEls[r.id]=el;}
    const z=state.zones[r.id], bz=roomBusy(r.id); el.classList.toggle('empty',!z); el.classList.toggle('busy',!!bz); el.innerHTML=(z?`<i style="background:${zoneColor(z)}"></i>`:'')+esc(roomName(r.id))+(bz?`<b class="bz">🔴 до ${hhmm(bz)}</b>`:''); el.style.display=(r.corridor&&!z)?'none':'';}
  const live=new Set(); for(const e of state.employees){if(!seatRef(e)) continue; live.add(e.id); let el=tagEls[e.id]; if(!el){el=document.createElement('div'); el.className='tag'; el.dataset.emp=e.id; el.addEventListener('click',ev=>{ev.stopPropagation(); if(mode==='viewer') focusEmployee(e.id,true);}); labelsEl.appendChild(el); tagEls[e.id]=el;}
    el.innerHTML=`<div class="b"><i style="background:${safeColor(e.color)}"></i><span class="n">${esc(e.name)}</span><span class="d">${esc(e.position||e.dept)}</span></div>`;}
  for(const k in tagEls) if(!live.has(k)){tagEls[k].remove(); delete tagEls[k];}
  for(const rz of state.rects){let el=roomLabelEls['rz'+rz.uid]; if(!el){el=document.createElement('div'); el.className='rl'; labelsEl.appendChild(el); roomLabelEls['rz'+rz.uid]=el; el.addEventListener('click',()=>{if(mode==='builder'&&tab==='zones') openZonePop({rect:rz.uid});});}
    const bz=roomBusy('rz:'+rz.uid); el.classList.toggle('busy',!!bz); el.innerHTML=`<i style="background:${zoneColor(rz)}"></i>${esc(rz.name||ZONES[rz.type].n)}${bz?`<b class="bz">🔴 до ${hhmm(bz)}</b>`:''}`;}
  for(const k in roomLabelEls) if(k.startsWith('rz')&&!state.rects.some(r=>'rz'+r.uid===k)){roomLabelEls[k].remove(); delete roomLabelEls[k];}}
const _v=new THREE.Vector3();
function project(x,y,z){if(view==='2d'){const s=w2s(x,z); return {x:s.x,y:s.y-(y||0)*view2.scale*.35,ok:true};} _v.set(x,y,z).project(camera); return {x:(_v.x+1)/2*innerWidth,y:(1-_v.y)/2*innerHeight,ok:_v.z<1};}
function updateLabels(){
  for(const r of ROOMS){const el=roomLabelEls[r.id]; if(!el) continue; const c=roomCenter(r); const p=project(c.x,.2,c.z); el.style.left=p.x+'px'; el.style.top=p.y+'px'; el.style.opacity=p.ok?1:0;}
  for(const rz of state.rects){const el=roomLabelEls['rz'+rz.uid]; if(!el) continue; const p=project((rz.x0+rz.x1)/2,.2,(rz.z0+rz.z1)/2); el.style.left=p.x+'px'; el.style.top=p.y+'px';}
  for(const e of state.employees){const el=tagEls[e.id]; if(!el) continue; const g=avObjs[e.id]; let wx,wy,wz,ty;
    if(g){wx=g.position.x;wy=g.position.y;wz=g.position.z;ty=g.userData.tagY;} else {const sw=empPos(e); if(!sw){el.style.opacity=0;continue;} wx=sw.x;wy=.02;wz=sw.z;ty=1.0;}
    const p=project(wx,wy+ty+.85,wz); el.style.left=p.x+'px'; el.style.top=p.y+'px'; const show=(hoverEmp===e.id||hlEmp===e.id); el.style.opacity=(p.ok&&show)?1:0; el.style.pointerEvents=show?'auto':'none';
    el.classList.toggle('hi',hlEmp===e.id); el.classList.toggle('dim',!!filterDept&&e.dept!==filterDept&&hlEmp!==e.id);}
  if(selected){const g=furnObjs[selected]; let px,pz; if(g){px=g.position.x;pz=g.position.z;} else {const f=state.furniture.find(x=>x.uid===selected); if(f){px=f.x;pz=f.z;}} if(px!=null){const p=project(px,1.3,pz); const ib=$('#itemBar'); ib.style.left=(p.x-ib.offsetWidth/2)+'px'; ib.style.top=(p.y-ib.offsetHeight-8)+'px';}}
}
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------- camera fly ---------- */
let fly=null;
function flyTo(target,offset,ms=1000){fly={t0:performance.now(),ms,p0:camera.position.clone(),t0v:controls.target.clone(),p1:target.clone().add(offset),t1:target.clone()};}
const OVERVIEW=new THREE.Vector3(.5,.72,.6).normalize().multiplyScalar(33*S);
camera.position.copy(CENTER).add(OVERVIEW); controls.target.copy(CENTER);
/* keyboard panning: WASD / arrows move the view across the floor (drag with right mouse also pans) */
const panKeys=new Set();
const PAN_MAP={arrowup:'f',w:'f','ц':'f',arrowdown:'b',s:'b','і':'b','ы':'b',arrowleft:'l',a:'l','ф':'l',arrowright:'r',d:'r','в':'r'};
addEventListener('keydown',e=>{if(e.target instanceof Element&&e.target.matches('input,textarea'))return; const m=PAN_MAP[e.key.toLowerCase()]; if(m){panKeys.add(m); if(e.key.startsWith('Arrow'))e.preventDefault();}});
addEventListener('keyup',e=>{const m=PAN_MAP[e.key.toLowerCase()]; if(m)panKeys.delete(m);});
addEventListener('blur',()=>panKeys.clear());
function panFromKeys(dt){if(fly||!panKeys.size)return; const fwd=new THREE.Vector3().subVectors(controls.target,camera.position); fwd.y=0; if(fwd.lengthSq()<1e-4)return; fwd.normalize(); const right=new THREE.Vector3().crossVectors(fwd,new THREE.Vector3(0,1,0)).normalize(); const mv=new THREE.Vector3(); if(panKeys.has('f'))mv.add(fwd); if(panKeys.has('b'))mv.sub(fwd); if(panKeys.has('r'))mv.add(right); if(panKeys.has('l'))mv.sub(right); if(mv.lengthSq()===0)return; const sp=Math.min(60,Math.max(6,camera.position.distanceTo(controls.target)*.9))*dt; mv.normalize().multiplyScalar(sp); camera.position.add(mv); controls.target.add(mv);}

/* ---------- interaction ---------- */
const ray=new THREE.Raycaster(); const ptr=new THREE.Vector2(); const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
let drag=null; // {kind:'furn'|'emp'|'rect', ...}
let selected=null; let ghost=null, plate=null; let downPos=null;
const snap=v=>Math.round(v*8)/8; // 0.125 m — matches furniture footprints (multiples of 0.25) and room edges (on the 0.125 grid) so objects tile flush and sit against walls
function setPtr(e){ptr.x=(e.clientX/innerWidth)*2-1; ptr.y=-(e.clientY/innerHeight)*2+1; ray.setFromCamera(ptr,camera);}
function floorHit(){const v=new THREE.Vector3(); return ray.ray.intersectPlane(plane,v)?v:null;}
function furnHit(){const h=ray.intersectObjects(furnRoot.children,true)[0]; if(!h) return null; let o=h.object; while(o.parent&&o.parent!==furnRoot) o=o.parent; return {uid:o.userData.uid,point:h.point};}
function avHit(){const h=ray.intersectObjects(avRoot.children,true)[0]; if(!h) return null; let o=h.object; while(o.parent&&o.parent!==avRoot) o=o.parent; return o.userData.emp;}
function mkPlate(w,d){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:'#4CAF6E',transparent:true,opacity:.35,depthWrite:false})); m.position.y=.03; return m;}
function startFurnDrag(type,existing){cancelDrag(); const f=existing||{uid:uid(),type,x:-99,z:-99,rot:0}; drag={kind:'furn',f,fromExisting:!!existing,over:false};
  if(view==='3d'){ghost=buildFurn(type); setOpacity(ghost,.65); ghost.visible=false; scene.add(ghost); const {w,d}=fp(f); plate=mkPlate(w,d); plate.visible=false; scene.add(plate); controls.enabled=false;} hideItemBar(); activeCanvas().style.cursor='grabbing'; dirty2d=true;}
function startEmpDrag(id){cancelDrag(); const e=state.employees.find(x=>x.id===id); drag={kind:'emp',id,seat:null};
  if(view==='3d'){ghost=buildAvatar(settings.avatar,e.color,false); setOpacity(ghost,.7); ghost.visible=false; scene.add(ghost); plate=mkPlate(.9,.9); plate.visible=false; scene.add(plate); controls.enabled=false;} activeCanvas().style.cursor='grabbing'; dirty2d=true;}
function cancelDrag(){if(ghost){scene.remove(ghost); disposeAvatar(ghost); ghost=null;} if(plate){scene.remove(plate); plate=null;} if(drag&&drag.kind==='rect'&&drag.mesh) scene.remove(drag.mesh); if(drag&&drag.kind==='furn'&&drag.fromExisting&&furnObjs[drag.f.uid]) furnObjs[drag.f.uid].visible=true; drag=null; controls.enabled=true; canvas.style.cursor=''; c2.style.cursor=''; dirty2d=true;}
function updateDrag(e){ if(view==='2d') return updateDrag2(e); setPtr(e); const hit=floorHit(); if(!hit) return;
  if(drag.kind==='furn'){const f=drag.f; f.x=snap(hit.x); f.z=snap(hit.z); magnetSnap(f); const ok=fits(f); ghost.visible=plate.visible=true; ghost.position.set(f.x,FURN[f.type].onDesk&&deskUnder(f)?.75*CS:.02,f.z); ghost.rotation.y=f.rot*Math.PI/2; const {w,d}=fp(f); plate.scale.set(w,1,d); plate.position.set(f.x,.03,f.z); plate.material.color.set(ok?'#4CAF6E':'#E2001A'); drag.ok=ok; drag.over=true;}
  else if(drag.kind==='emp'){const fh=furnHit(); drag.seat=null; ghost.visible=true; plate.visible=false;
    if(fh){const f=state.furniture.find(x=>x.uid===fh.uid); const seats=FURN[f.type].seats||[]; let best=null,bd=9;
      seats.forEach((s,i)=>{if(seatTaken(f.uid,i)) return; const sw=seatWorld(f,i); const dd=Math.hypot(sw.x-fh.point.x,sw.z-fh.point.z); if(dd<bd){bd=dd;best={f,i,sw};}});
      if(best){drag.seat={f:best.f.uid,i:best.i}; ghost.position.set(best.sw.x,.02,best.sw.z); ghost.rotation.y=best.sw.ry; plate.visible=true; plate.position.set(best.sw.x,.03,best.sw.z); plate.material.color.set('#4CAF6E'); return;}}
    ghost.position.set(hit.x,.02,hit.z); ghost.rotation.y=Math.atan2(camera.position.x-hit.x,camera.position.z-hit.z);}
  else if(drag.kind==='rect'){drag.x1=snap(hit.x); drag.z1=snap(hit.z); const x0=Math.min(drag.x0,drag.x1),x1=Math.max(drag.x0,drag.x1),z0=Math.min(drag.z0,drag.z1),z1=Math.max(drag.z0,drag.z1); drag.mesh.position.set((x0+x1)/2,.015,(z0+z1)/2); drag.mesh.scale.set(Math.max(.01,x1-x0),1,Math.max(.01,z1-z0));}}
// 2D drag update: compute world from screen, no THREE ghost — draw2D renders it from `drag`
function updateDrag2(e){const w=s2w(e.clientX,e.clientY); dirty2d=true;
  if(drag.kind==='furn'){const f=drag.f; f.x=snap(w.x); f.z=snap(w.z); magnetSnap(f); drag.ok=fits(f); drag.over=true;}
  else if(drag.kind==='emp'){drag.seat=null; drag.gx=w.x; drag.gz=w.z; const fu=furnHit2(w.x,w.z);
    if(fu){const f=state.furniture.find(x=>x.uid===fu); const seats=FURN[f.type].seats||[]; let best=null,bd=1e9;
      seats.forEach((s,i)=>{if(seatTaken(f.uid,i))return; const sw=seatWorld(f,i); const dd=Math.hypot(sw.x-w.x,sw.z-w.z); if(dd<bd){bd=dd;best={f,i,sw};}});
      if(best){drag.seat={f:best.f.uid,i:best.i}; drag.gx=best.sw.x; drag.gz=best.sw.z;}}}
  else if(drag.kind==='rect'){drag.x1=snap(w.x); drag.z1=snap(w.z);}}
function finishDrag(e){if(!drag) return; const d=drag;
  if(d.kind==='furn'){if(d.over&&d.ok){pushUndo(); if(d.fromExisting){const o=state.furniture.find(x=>x.uid===d.f.uid); Object.assign(o,{x:d.f.x,z:d.f.z,rot:d.f.rot});} else state.furniture.push(d.f); markDirty(); cancelDrag(); syncFurniture(); syncAvatars(); if(!d.fromExisting) hideWelcome();}
    else if(d.over||d.fromExisting){if(!d.over&&d.fromExisting){cancelDrag();return;} toast('Тут не поміститься — оберіть вільне місце в кімнаті'); /* keep dragging as sticky */ drag.sticky=true; activeCanvas().style.cursor='grabbing';}
    else {drag.sticky=true;} return;}
  if(d.kind==='emp'){if(d.seat){pushUndo(); const emp=state.employees.find(x=>x.id===d.id); emp.seat=d.seat; empUpsert(emp); markDirty(); cancelDrag(); syncAvatars(); renderPeople(); renderLabels(); toast(`${emp.name} — тепер за столом у «${roomName(roomAt(seatWorld(state.furniture.find(f=>f.uid===d.seat.f),d.seat.i).x,seatWorld(state.furniture.find(f=>f.uid===d.seat.f),d.seat.i).z))}»`);}
    else cancelDrag(); return;}
  if(d.kind==='rect'){const x0=Math.min(d.x0,d.x1),x1=Math.max(d.x0,d.x1),z0=Math.min(d.z0,d.z1),z1=Math.max(d.z0,d.z1); if(d.mesh) scene.remove(d.mesh); drag=null; controls.enabled=true; dirty2d=true;
    if(x1-x0>=.5&&z1-z0>=.5){pushUndo(); const rz={uid:uid(),x0,z0,x1,z1,type:'open',name:''}; state.rects.push(rz); markDirty(); syncZones(); renderLabels(); openZonePop({rect:rz.uid});}}}

canvas.addEventListener('pointerdown',e=>{if(e.button!==0) return; downPos={x:e.clientX,y:e.clientY}; setPtr(e);
  if(drag&&drag.kind==='furn'&&drag.sticky){updateDrag(e); drag.sticky=false; finishDrag(e); if(!drag) return; drag.sticky=true; return;}
  if(mode==='builder'&&tab==='zones'&&settings.zoning==='rect'&&!drag){const hit=floorHit(); if(hit&&roomAt(hit.x,hit.z)){const m=new THREE.Mesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:'#5B76E6',transparent:true,opacity:.35,depthWrite:false})); scene.add(m); drag={kind:'rect',x0:snap(hit.x),z0:snap(hit.z),x1:snap(hit.x),z1:snap(hit.z),mesh:m}; controls.enabled=false;}}});
canvas.addEventListener('pointermove',e=>{if(drag){updateDrag(e); return;} setPtr(e); const aid=avHit(); hoverEmp=aid; if(mode!=='builder'){canvas.style.cursor=aid?'pointer':''; return;} canvas.style.cursor=aid?'pointer':((tab==='furniture'&&furnHit())?'pointer':'');});
canvas.addEventListener('pointerleave',()=>{hoverEmp=null;});
canvas.addEventListener('pointerup',e=>{const moved=downPos&&Math.hypot(e.clientX-downPos.x,e.clientY-downPos.y)>5; downPos=null;
  if(drag&&drag.kind==='rect'){finishDrag(e); return;}
  if(drag&&drag.kind==='furn'&&drag.sticky) return;
  if(moved) return; setPtr(e); closePops();
  if(mode==='viewer'){const id=avHit(); if(id) focusEmployee(id,true); return;}
  const aid=avHit(); if(aid){const emp=state.employees.find(x=>x.id===aid); if(emp){showCard(emp); return;}}
  if(tab==='zones'&&settings.zoning==='click'){const h=ray.intersectObjects(floorMeshes)[0]; if(h) openZonePop({room:h.object.userData.room}); return;}
  const fh=furnHit(); if(fh&&tab!=='zones') select(fh.uid); else select(null);});
document.addEventListener('pointermove',e=>{if(drag&&(drag.kind==='furn'||drag.kind==='emp')&&!drag.sticky&&e.target!==activeCanvas()){/* over UI: hide ghost */ if(ghost){ghost.visible=false;} if(plate) plate.visible=false; if(drag.kind==='furn') drag.over=false; dirty2d=true;}});
document.addEventListener('pointerup',e=>{if(!drag) return; if(drag.kind==='rect') return; if(drag.sticky) return; if(e.target===activeCanvas()){updateDrag(e); finishDrag(e);} else {if(drag.kind==='furn'&&!drag.fromExisting){drag.sticky=true; activeCanvas().style.cursor='grabbing';} else finishDrag(e);}});
window.addEventListener('keydown',e=>{if(e.target instanceof Element&&e.target.matches('input,textarea')) return; const k=e.key.toLowerCase();
  if(k==='escape'){cancelDrag(); select(null); closePops(); return;}
  if(k==='r'||k==='к'){if(drag&&drag.kind==='furn'){drag.f.rot=(drag.f.rot+1)%4; dirty2d=true;} else if(selected) rotateSel(); return;}
  if((k==='delete'||k==='backspace')&&selected){delSel(); return;}
  if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault(); undo();}});

function select(id){selected=id; dirty2d=true; const ib=$('#itemBar'); ib.classList.toggle('open',!!id); for(const k in furnObjs) furnObjs[k].traverse(o=>{if(o.isMesh&&o.material.emissive) o.material.emissive.set(0);}); if(id&&furnObjs[id]) furnObjs[id].traverse(o=>{if(o.isMesh&&o.material.emissive){o.material=o.material.clone(); o.material.emissive.set('#E2001A'); o.material.emissiveIntensity=.12;}});}
function hideItemBar(){$('#itemBar').classList.remove('open');}
function rotateSel(){const f=state.furniture.find(x=>x.uid===selected); if(!f) return; pushUndo(); f.rot=(f.rot+1)%4; if(!fits(f)){f.rot=(f.rot+3)%4; undoStack.pop(); toast('Так не поміститься'); return;} markDirty(); syncFurniture(); syncAvatars();}
function delSel(){const f=state.furniture.find(x=>x.uid===selected); if(!f) return; pushUndo(); state.furniture=state.furniture.filter(x=>x!==f); state.employees.forEach(e=>{if(e.seat&&e.seat.f===f.uid){e.seat=null; empUpsert(e);}}); select(null); markDirty(); syncAll();}
$('#rotBtn').onclick=rotateSel; $('#delBtn').onclick=delSel;
$('#moveBtn').onclick=()=>{const f=state.furniture.find(x=>x.uid===selected); if(!f) return; select(null); if(furnObjs[f.uid]) furnObjs[f.uid].visible=false; startFurnDrag(f.type,{...f}); drag.sticky=true;};

/* dock drags */
function bindDrag(el,onStart){let sp=null; el.addEventListener('pointerdown',e=>{if(e.button!==0) return; sp={x:e.clientX,y:e.clientY,started:false}; const mv=ev=>{if(!sp.started&&Math.hypot(ev.clientX-sp.x,ev.clientY-sp.y)>6){sp.started=true; onStart('drag');} if(sp.started&&drag&&ev.target===activeCanvas()) updateDrag(ev);};
  const up=ev=>{document.removeEventListener('pointermove',mv); document.removeEventListener('pointerup',up); if(!sp.started) onStart('click'); sp=null;}; document.addEventListener('pointermove',mv); document.addEventListener('pointerup',up);});}

/* ---------- undo / save ---------- */
// Undo covers the HR-owned layout only; employees are DB-owned and restored live, so
// they are excluded from the snapshot (also avoids serializing base64 photos 60×).
function pushUndo(){const {employees,...layout}=state; undoStack.push(JSON.stringify(layout)); if(undoStack.length>60) undoStack.shift(); $('#undoBtn').disabled=false;}
// Employees are DB-owned; undo only rewinds the layout (furniture/zones/rects/depts),
// keeping the current people list so it stays in sync with the server.
function undo(){if(!undoStack.length) return; cancelDrag(); select(null); const emps=state.employees; state=JSON.parse(undoStack.pop()); state.employees=emps; $('#undoBtn').disabled=!undoStack.length; markDirty(); syncAll();}
function markDirty(){dirty=true; dirty2d=true; const s=$('#status'); s.classList.remove('saved'); s.querySelector('span').textContent='Є незбережені зміни';}
$('#saveBtn').onclick=()=>{ saveLayout(); };
let toastT; function toast(msg){const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2400);}

/* ---------- catalog ---------- */
function makeThumbs(){const r=glRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true}); r.setSize(168,168); r.setClearColor(0,0); r.toneMapping=THREE.NeutralToneMapping; const sc=new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff,0xc9b8a8,1.1)); const dl=new THREE.DirectionalLight(0xffffff,1.6); dl.position.set(3,5,4); sc.add(dl);
  const cam=new THREE.OrthographicCamera(-1,1,1,-1,.1,50); const out={};
  for(const t in FURN){const g=buildFurn(t); sc.add(g); const box=new THREE.Box3().setFromObject(g); const c=box.getCenter(new THREE.Vector3()); const s=box.getSize(new THREE.Vector3()); const m=Math.max(s.x,s.y,s.z)*.72; cam.left=-m;cam.right=m;cam.top=m;cam.bottom=-m; cam.updateProjectionMatrix(); cam.position.copy(c).add(new THREE.Vector3(1,.9,1).normalize().multiplyScalar(10)); cam.lookAt(c); r.render(sc,cam); out[t]=r.domElement.toDataURL(); sc.remove(g);}
  r.dispose(); r.forceContextLoss(); return out;}
const thumbs=makeThumbs();
const catEl=$('#cat'); let catFilter='all';
function renderCat(){catEl.innerHTML=''; for(const t in FURN){if(catFilter!=='all'&&FURN[t].cat!==catFilter) continue; const el=document.createElement('div'); el.className='item'; el.innerHTML=`<img src="${thumbs[t]}" alt=""><span>${FURN[t].n}</span><small>${FURN[t].seats?FURN[t].seats.length+(FURN[t].seats.length===1?' місце':' місць'):(FURN[t].w/CS).toFixed(2).replace(/\.?0+$/,'')+'×'+(FURN[t].d/CS).toFixed(2).replace(/\.?0+$/,'')+' м'}</small>`; catEl.appendChild(el);
  bindDrag(el,how=>{startFurnDrag(t); if(how==='click'){drag.sticky=true; toast(`Клікніть на підлогу, щоб поставити «${FURN[t].n}»`);}});}}
function renderCatFilter(){const f=$('#catFilter'); f.innerHTML=`<button class="chipb" data-c="all" aria-pressed="${catFilter==='all'}">Усі</button>`+Object.keys(CATS).map(k=>`<button class="chipb" data-c="${k}" aria-pressed="${catFilter===k}">${CATS[k]}</button>`).join('');
  f.querySelectorAll('button').forEach(b=>b.onclick=()=>{catFilter=b.dataset.c; renderCatFilter(); renderCat();});}
renderCatFilter(); renderCat();
const zl=$('#zonesList'); for(const k in ZONES){const el=document.createElement('div'); el.className='zt'; el.innerHTML=`<i style="background:${ZONES[k].c}"></i>${ZONES[k].n}`; zl.appendChild(el);}

/* tabs */
$$('#tabs button[role="tab"]').forEach(b=>b.onclick=()=>{if(b.dataset.tab!=='stats') HR.exitFull(); tab=b.dataset.tab; app.dataset.tab=tab; app.dataset.dock='open'; $$('#tabs button[role="tab"]').forEach(x=>x.setAttribute('aria-selected',x===b)); $$('.pane').forEach(p=>p.classList.toggle('on',p.dataset.pane===tab)); select(null); closePops(); cancelDrag(); updateZoneHint();});
$('#collapseBtn').onclick=()=>{app.dataset.dock=app.dataset.dock==='closed'?'open':'closed';};
function updateZoneHint(){$('#zoneHint').textContent=settings.zoning==='rect'?'Проведіть прямокутник по підлозі, щоб створити зону':'Натисніть на кімнату в офісі, щоб призначити зону';}

/* ---------- zone popover ---------- */
let popTarget=null;
function openZonePop(t){popTarget=t; const pop=$('#zonePop'); const isRoom=!!t.room; const cur=isRoom?state.zones[t.room]:state.rects.find(r=>r.uid===t.rect);
  const roomObj=isRoom?ROOMS.find(r=>r.id===t.room):null; const title=isRoom?('Кімната '+(roomObj.n||'')+(roomObj.corridor?' · Коридор':'')):'Зона на підлозі';
  let curType=cur?cur.type:'open', curName=cur?(cur.name||''):'', curColor=cur&&cur.color?cur.color:null;
  const typeOpts=Object.keys(ZONES).map(k=>`<option value="${k}" ${k===curType?'selected':''}>${ZONES[k].n}</option>`).join('');
  const deptOpts=`<option value="">— свій варіант —</option>`+ZONE_DEPT_PRESETS.map((d,i)=>`<option value="${i}" ${cur&&cur.name===d.name?'selected':''}>${esc(d.name)}</option>`).join('');
  const swatches=ZONE_PALETTE.map(c=>`<button type="button" class="zsw" data-c="${c}" style="background:${c}"></button>`).join('');
  pop.innerHTML=`<h4>${title}</h4>`
    +`<div class="zrow"><label>Тип</label><select class="zsel" id="zType">${typeOpts}</select></div>`
    +`<div class="zrow"><label>Відділ</label><select class="zsel" id="zDept">${deptOpts}</select></div>`
    +`<div class="zrow"><label>Назва</label><input class="field" id="zName" placeholder="напр. Логістика" value="${esc(curName)}"></div>`
    +`<div class="zrow"><label>Колір</label><div class="zsws" id="zSw">${swatches}<input type="color" id="zColor" class="zcol"></div></div>`
    +`<div class="row"><button class="tbtn txt" id="zClear">Прибрати</button><button class="tbtn red" id="zDone">Готово</button></div>`;
  pop.classList.add('open'); let p; if(isRoom){const c=roomCenter(roomObj); p=project(c.x,.2,c.z);} else {p=project((cur.x0+cur.x1)/2,.2,(cur.z0+cur.z1)/2);}
  pop.style.left=Math.min(innerWidth-260,Math.max(10,p.x+16))+'px'; pop.style.top=Math.min(innerHeight-300,Math.max(80,p.y-30))+'px';
  const markSw=()=>{const eff=(curColor||ZONES[curType].c).toLowerCase(); pop.querySelectorAll('.zsw').forEach(b=>b.setAttribute('aria-pressed',b.dataset.c.toLowerCase()===eff)); const ci=$('#zColor'); if(ci&&/^#[0-9a-f]{6}$/i.test(curColor||ZONES[curType].c)) ci.value=curColor||ZONES[curType].c;};
  const apply=()=>{pushUndo(); if(isRoom){const d={type:curType,name:curName}; if(curColor) d.color=curColor; state.zones[t.room]=d;}
    else {const rz=state.rects.find(r=>r.uid===t.rect); rz.type=curType; rz.name=curName; if(curColor) rz.color=curColor; else delete rz.color;}
    markDirty(); syncZones(); renderLabels(); hideWelcome(); markSw();};
  $('#zType').onchange=e=>{curType=e.target.value; $('#zDept').value=''; apply();};
  $('#zDept').onchange=e=>{const v=e.target.value; if(v!==''){const d=ZONE_DEPT_PRESETS[+v]; curType=d.type; curName=d.name; curColor=d.c; $('#zType').value=curType; $('#zName').value=curName;} apply();};
  $('#zName').oninput=e=>{curName=e.target.value.trim(); apply();};
  pop.querySelectorAll('.zsw').forEach(b=>b.onclick=()=>{curColor=b.dataset.c; apply();});
  $('#zColor').oninput=e=>{curColor=e.target.value; apply();};
  $('#zClear').onclick=()=>{pushUndo(); if(isRoom) delete state.zones[t.room]; else state.rects=state.rects.filter(r=>r.uid!==t.rect); markDirty(); syncZones(); renderLabels(); closePops();};
  $('#zDone').onclick=closePops; markSw();}
function closePops(){$('#zonePop').classList.remove('open'); $('#settings').classList.remove('open'); $('#empcard').classList.remove('open'); $('#sugg').classList.remove('open');}

/* ---------- employees ---------- */
const initials=n=>n.trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
function statusBtns(cur){return Object.keys(STATUS).map(k=>`<button type="button" class="optbtn" data-s="${k}" aria-pressed="${cur===k}"><i style="background:${STATUS[k].c}"></i>${STATUS[k].n}</button>`).join('');}
function moodBtns(cur){return Object.keys(MOODS).map(k=>`<button type="button" class="moodbtn" data-m="${k}" title="${MOODS[k].n}" aria-pressed="${cur===k}">${MOODS[k].e}</button>`).join('');}
// Photo avatars set background-image + size/position explicitly (the `background`
// shorthand would reset background-size:cover from CSS → image shown top-left at
// natural size). This centres & covers any photo aspect ratio.
// Employee records are user-editable (Mini App / bot) → never trust photo/colour in a style attribute.
const safePhoto=p=>typeof p==='string'&&(/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/i.test(p)||/^https:\/\/[^\s"'()\\]+$/i.test(p))?p:null;
const safeColor=c=>typeof c==='string'&&/^#[0-9a-f]{3,8}$/i.test(c)?c:'#9AA3AA';
const avHTML=(e,cls='av')=>{const ph=safePhoto(e.photo); return `<div class="${cls}" style="${ph?`background-image:url(${ph});background-size:cover;background-position:center;background-repeat:no-repeat`:`background:${safeColor(e.color)}`}">${ph?'':esc(initials(e.name||''))}</div>`;};
const ICO_EDIT='<svg viewBox="0 0 512 512"><path d="M362.7 19.3L314.3 67.7 444.3 197.7l48.4-48.4c25-25 25-65.5 0-90.5L453.3 19.3c-25-25-65.5-25-90.5 0zm-71 71L58.6 323.5c-10.4 10.4-18 23.3-22.2 37.4L1 481.2C-1.5 489.7 .8 498.8 7 505s15.3 8.5 23.7 6.1l120.3-35.4c14.1-4.2 27-11.8 37.4-22.2L421.7 220.3 291.7 90.3z"/></svg>';
const ICO_UNBIND='<svg viewBox="0 0 512 512"><path d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1-128 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l128 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z"/></svg>';
const ICO_TRASH='<svg viewBox="0 0 448 512"><path d="M135.2 17.7L128 32 32 32C14.3 32 0 46.3 0 64S14.3 96 32 96l384 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0-7.2-14.3C307.4 6.8 296.3 0 284.2 0L163.8 0c-12.1 0-23.2 6.8-28.6 17.7zM416 128L32 128 53.2 467c1.6 25.3 22.6 45 47.9 45l245.8 0c25.3 0 46.3-19.7 47.9-45L416 128z"/></svg>';
function renderPeople(){const holder=$('#people'); holder.innerHTML=''; $('#empCount').textContent=state.employees.length;
  for(const e of state.employees){const el=document.createElement('div'); el.className='emp'; let loc; if(e.seat){const f=state.furniture.find(x=>x.uid===e.seat.f); loc=f?(roomName(roomAt(seatWorld(f,e.seat.i).x,seatWorld(f,e.seat.i).z))||'В офісі'):'Без місця';} else loc=statusOf(e)==='office'?'Ходить офісом':'Не в офісі';
    const st=STATUS[statusOf(e)], md=MOODS[e.mood]||MOODS.good;
    el.innerHTML=`${avHTML(e)}<div class="txt"><div class="nm">${esc(e.name)}</div><div class="dp">${esc(e.dept)}${e.position?' · '+esc(e.position):''}</div><div class="st ${e.seat?'seated':''}"><span class="mood">${md.e}</span><i style="background:${st.c}"></i>${esc(loc)}</div></div>`
      +`<div class="empacts"><button class="edit" title="Редагувати">${ICO_EDIT}</button>${e.seat?`<button class="unbind" title="Відв'язати від місця">${ICO_UNBIND}</button>`:''}<button class="del" title="Видалити працівника">${ICO_TRASH}</button></div>`;
    const acts=el.querySelector('.empacts'); acts.addEventListener('pointerdown',ev=>ev.stopPropagation());
    el.querySelector('.edit').onclick=ev=>{ev.stopPropagation(); openModal(e);};
    const ub=el.querySelector('.unbind'); if(ub) ub.onclick=ev=>{ev.stopPropagation(); pushUndo(); e.seat=null; empUpsert(e); markDirty(); syncAvatars(); renderPeople(); renderLabels(); toast(`${e.name} — відв'язано, тепер вільно ходить`);};
    el.querySelector('.del').onclick=ev=>{ev.stopPropagation(); pushUndo(); state.employees=state.employees.filter(x=>x!==e); delete EP[e.id]; empDelete(e.id); markDirty(); syncAvatars(); renderPeople(); renderLabels(); toast(`${e.name} — видалено`);};
    bindDrag(el,how=>{if(how==='drag'){startEmpDrag(e.id);} else focusEmployee(e.id,false);});
    holder.appendChild(el);}
  const add=document.createElement('button'); add.className='addemp'; add.innerHTML='<b>+</b>Додати співробітника'; add.onclick=()=>openModal(); holder.appendChild(add);
  const dl=$('#deptList'); fillDeptList();
  renderFilters();}

/* modal */
const backdrop=$('#backdrop'); let fColor=DEPT_COLORS[0], fPhoto=null, fStatus='office', fMood='good', editingId=null;
const pRenderer=glRenderer({canvas:$('#pc'),alpha:true,antialias:true}); pRenderer.setClearColor(0,0); pRenderer.toneMapping=THREE.NeutralToneMapping; 
const pScene=new THREE.Scene(); pScene.add(new THREE.HemisphereLight(0xffffff,0xc9b8a8,1)); const pl=new THREE.DirectionalLight(0xfff3e4,1.8); pl.position.set(2,4,3); pl.castShadow=true; pScene.add(pl);
const pCam=new THREE.PerspectiveCamera(30,480/560,.1,20*CS); pCam.position.set(0,1.1*CS,4.6*CS); pCam.lookAt(0,.8*CS,0);
const pFloor=new THREE.Mesh(new THREE.CircleGeometry(.9*CS,32).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({color:'#ffffff',roughness:1,transparent:true,opacity:.6})); pFloor.receiveShadow=true; pScene.add(pFloor);
let pAv=null; function refreshPreview(){if(pAv){pScene.remove(pAv); disposeAvatar(pAv);} pAv=buildAvatar(settings.avatar,fColor,false); pScene.add(pAv); const t=$('#ptag'); t.querySelector('i').style.background=fColor; t.querySelector('.n').textContent=$('#fName').value.trim()||'Ім'+"'"+'я'; t.querySelector('.d').textContent=$('#fDept').value.trim()||'Відділ';}
function renderSwatches(){const dept=$('#fDept').value.trim(); if(dept&&state.depts[dept]&&!editingId) fColor=state.depts[dept];
  $('#swatches').innerHTML=DEPT_COLORS.map(c=>`<button type="button" data-c="${c}" style="background:${c}" aria-pressed="${c===fColor}"></button>`).join('');
  $$('#swatches button').forEach(b=>b.onclick=()=>{fColor=b.dataset.c; renderSwatches(); refreshPreview();}); $('#fAv').style.background=fPhoto?`url(${fPhoto})`:fColor; $('#fAv').style.backgroundSize='cover'; $('#fAv').style.color='#fff'; $('#fAv').textContent=fPhoto?'':(initials($('#fName').value)||'?'); refreshPreview();}
function renderStatusMood(){$('#fStatus').innerHTML=statusBtns(fStatus); $('#fMood').innerHTML=moodBtns(fMood);
  $$('#fStatus .optbtn').forEach(b=>b.onclick=()=>{fStatus=b.dataset.s; $$('#fStatus .optbtn').forEach(x=>x.setAttribute('aria-pressed',x===b));});
  $$('#fMood .moodbtn').forEach(b=>b.onclick=()=>{fMood=b.dataset.m; $$('#fMood .moodbtn').forEach(x=>x.setAttribute('aria-pressed',x===b));});}
function openModal(edit){editingId=(edit&&edit.id)||null; backdrop.classList.add('open'); $('#empForm').reset();
  if(editingId){$('#fName').value=edit.name; $('#fDept').value=edit.dept; $('#fPos').value=edit.position||''; $('#fMail').value=edit.email||''; $('#fPhone').value=edit.phone||''; $('#fExt').value=edit.ext||''; fPhoto=edit.photo||null; $('#fPhotoName').textContent=fPhoto?'фото завантажено':"необов'язково"; fColor=edit.color; fStatus=statusOf(edit); fMood=edit.mood||'good'; $('#empTitle').textContent='Редагувати співробітника'; $('#empSub').textContent='Змініть дані, статус або настрій.'; $('#empSubmit').textContent='Зберегти';}
  else {fPhoto=null; $('#fPhotoName').textContent="необов'язково"; fColor=DEPT_COLORS[state.employees.length%DEPT_COLORS.length]; fStatus='office'; fMood='good'; $('#empTitle').textContent='Новий співробітник'; $('#empSub').textContent="Працівник ходитиме офісом. За бажанням можна перетягнути на місце."; $('#empSubmit').textContent='Додати';}
  renderSwatches(); renderStatusMood(); fillDeptList(); setTimeout(()=>$('#fName').focus(),50);}
function closeModal(){backdrop.classList.remove('open');}
$('#cancelEmp').onclick=closeModal; backdrop.addEventListener('pointerdown',e=>{if(e.target===backdrop) closeModal();});
$('#fName').oninput=renderSwatches; $('#fDept').oninput=renderSwatches;
$('#fPhoto').onchange=e=>{const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{fPhoto=rd.result; $('#fPhotoName').textContent=f.name; renderSwatches();}; rd.readAsDataURL(f);};
$('#empForm').onsubmit=ev=>{ev.preventDefault(); const name=$('#fName').value.trim(), dept=$('#fDept').value.trim(); if(!name||!dept) return; pushUndo(); state.depts[dept]=fColor; const color=fColor;
  const data={name,dept,position:$('#fPos').value.trim(),email:$('#fMail').value.trim(),phone:$('#fPhone').value.trim(),ext:$('#fExt').value.trim(),color,photo:fPhoto,status:fStatus,mood:fMood};
  const hired=$('#fHired').value; if(hired&&getToken()){const id=editingId; setTimeout(()=>apiEmpWrite('PUT','/employees/'+encodeURIComponent(id||(state.employees[state.employees.length-1]||{}).id),{hired_on:hired}).catch(()=>{}),900);}
  if(editingId){const emp=state.employees.find(x=>x.id===editingId); Object.assign(emp,data); empUpsert(emp); editingId=null; markDirty(); closeModal(); syncAvatars(); renderPeople(); renderLabels(); toast(`${name} — оновлено`); return;}
  const ne=Object.assign({id:uid(),seat:null},data); state.employees.push(ne); if(TG.active&&!TG.me){TG.me=ne; setTimeout(()=>PHONE.personalStart&&PHONE.personalStart(),1200);} empUpsert(ne); markDirty(); closeModal(); syncAvatars(); renderPeople(); toast(`${name} — додано й ходить офісом. За бажанням перетягніть на місце`); hideWelcome();
  if(tab!=='people') $('#tabPeople').click();};

/* ---------- viewer ---------- */
function focusEmployee(id,card){const e=state.employees.find(x=>x.id===id); const pos=e&&empPos(e); if(!e||!pos){toast(`${e?e.name:'Співробітник'} зараз не в офісі`); return;} hlEmp=id; app.classList.add('hl'); dirty2d=true;
  if(view==='2d'){fly2To(pos.x,pos.z,Math.max(view2.scale,34)); if(card) setTimeout(()=>showCard(e),620); return;}
  const g=avObjs[id]; if(!g){if(card) showCard(e); return;} const t=g.position.clone(); t.y=.9;
  const dir=new THREE.Vector3(.35,.62,.7).normalize().multiplyScalar(mode==='viewer'?8.5:10); flyTo(t,dir,1100); if(mode==='viewer') showHighlight(g); if(card) setTimeout(()=>showCard(e),700);}
let hlRing=null,hlArrow=null;
function showHighlight(g){clearHighlight(); const p=g.position;
  if(settings.hl!=='arrow'){hlRing=new THREE.Mesh(new THREE.RingGeometry(.55,.85,40).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:'#E2001A',transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false})); hlRing.position.set(p.x,.04,p.z); fxRoot.add(hlRing);
    const glow=new THREE.Mesh(new THREE.CircleGeometry(1.1,40).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:'#E2001A',transparent:true,opacity:.18,depthWrite:false})); glow.position.set(p.x,.035,p.z); fxRoot.add(glow);}
  if(settings.hl!=='glow'){hlArrow=new THREE.Mesh(new THREE.ConeGeometry(.22,.5,20),new THREE.MeshStandardMaterial({color:'#E2001A',roughness:.5})); hlArrow.rotation.x=Math.PI; hlArrow.position.set(p.x,p.y+g.userData.tagY+1.1,p.z); hlArrow.castShadow=true; fxRoot.add(hlArrow);}}
function clearHighlight(){while(fxRoot.children.length) fxRoot.remove(fxRoot.children[0]); hlRing=hlArrow=null;}
function showCard(e){const c=$('#empcard'); const sr=seatRef(e), f=sr&&state.furniture.find(x=>x.uid===sr.f); let where; if(f){const sw=seatWorld(f,sr.i); where=roomName(roomAt(sw.x,sw.z))||'В офісі';} else where=statusOf(e)==='office'?'Ходить офісом':'Не в офісі';
  const st=STATUS[statusOf(e)], md=MOODS[e.mood]||MOODS.good;
  c.innerHTML=`<div class="top">${avHTML(e)}<div><div class="nm" style="font-size:16px">${esc(e.name)}</div><div class="dp">${esc(e.dept)}${e.position?' · '+esc(e.position):''}</div></div></div>`+
    `<div class="badges"><span class="pill" style="color:${st.c}">${st.icon} ${st.n}</span><span class="pill">${md.e} ${md.n}</span><span class="pill">📍 ${esc(where)}</span>${(LIVE.birthdays||[]).includes(e.id)?'<span class="pill" style="color:#E06CA6">🎂 День народження сьогодні!</span>':''}${(()=>{const a=(LIVE.anniversaries||[]).find(x=>x.id===e.id); return a?`<span class="pill" style="color:#B5651D">🏅 ${a.years} р. з нами</span>`:'';})()}${!e.seat&&seatRef(e)?'<span class="pill">🪑 Місце на сьогодні</span>':''}${busyOf(e)?`<span class="pill" style="color:#5B76E6">📅 На зустрічі до ${hhmm(busyOf(e))}${LIVE.busy[e.id].room?' · '+esc(liveRoomName(LIVE.busy[e.id].room)):''}</span>`:''}${e.tg_linked?'<span class="pill" style="color:#229ED9" title="Прив\'язано через Telegram">✈️ TG</span>':''}</div>`+
    `<dl>${e.email?`<dt>Email</dt><dd>${esc(e.email)}</dd>`:''}${e.phone?`<dt>Телефон</dt><dd>${esc(e.phone)}</dd>`:''}${e.ext?`<dt>Роб. номер</dt><dd>${esc(e.ext)}</dd>`:''}</dl>`+
    // Status/mood/edit controls write to the DB. Shown to HR (builder) and — in the
    // Telegram Mini App — to the owner of this card only. Everyone else sees it read-only.
    (mode==='builder'||isMe(e)?
      `<div class="fsec-t"><svg class="fsec-i" viewBox="0 0 384 512"><path d="M215.7 499.2C267 435 384 279.4 384 192C384 86 298 0 192 0S0 86 0 192c0 87.4 117 243 168.3 307.2c12.3 15.3 35.1 15.3 47.4 0zM192 128a64 64 0 1 1 0 128 64 64 0 1 1 0-128z"/></svg><span>Де зараз</span></div><div class="optrow" id="cardStatus">${statusBtns(statusOf(e))}</div>`+
      `<div class="fsec-t"><svg class="fsec-i" viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM176 208a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zm128 0a32 32 0 1 1 64 0 32 32 0 1 1 -64 0zM164.1 325.5C158 318.4 158 308.5 164.1 301.4C176.5 287.2 199.3 272 240 272l32 0c40.7 0 63.5 15.2 75.9 29.4c6.1 7 6.1 17 0 24.1c-6.1 7.1-16 7.1-22.1 0C317.5 316 302.7 304 272 304l-32 0c-30.7 0-45.5 12-53.8 21.5c-6.1 7.1-16 7.1-22.1 0z"/></svg><span>Настрій</span></div><div class="moodrow" id="cardMood">${moodBtns(e.mood||'good')}</div>`+
      `<div class="row"><button class="tbtn" id="cardEdit">Редагувати</button><button class="tbtn txt" id="cardClose">Закрити</button></div>`
     :`<div class="row"><button class="tbtn txt" id="cardClose">Закрити</button></div>`);
  c.classList.add('open'); c.style.left='16px'; c.style.top='auto'; c.style.bottom='24px';
  if(mode==='builder'||isMe(e)){
    c.querySelectorAll('#cardStatus .optbtn').forEach(b=>b.onclick=()=>{pushUndo(); e.status=b.dataset.s; empUpsert(e); markDirty(); syncAvatars(); refreshAvatarLook(); renderPeople(); showCard(e);});
    c.querySelectorAll('#cardMood .moodbtn').forEach(b=>b.onclick=()=>{pushUndo(); e.mood=b.dataset.m; empUpsert(e); markDirty(); updateAvatarMood(e.id); dirty2d=true; renderPeople(); showCard(e);});
    $('#cardEdit').onclick=()=>{c.classList.remove('open'); app.classList.remove('hl'); openModal(e);};
  }
  $('#cardClose').onclick=()=>{c.classList.remove('open'); app.classList.remove('hl');};}
// search
const q=$('#q'), sugg=$('#sugg'); let sIdx=0;
function suggest(){const v=q.value.trim().toLowerCase(); if(!v){sugg.classList.remove('open'); return;} const list=state.employees.filter(e=>e.name.toLowerCase().includes(v)||e.dept.toLowerCase().includes(v)).slice(0,8);
  sugg.innerHTML=list.length?list.map((e,i)=>`<button data-id="${e.id}" class="${i===sIdx?'act':''}">${avHTML(e)}<div><div class="nm">${esc(e.name)}</div><div class="dp">${esc(e.dept)}${e.seat?'':' · без місця'}</div></div></button>`).join(''):'<button disabled><div class="dp">Нікого не знайдено</div></button>';
  sugg.classList.add('open'); sugg.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>pick(b.dataset.id));}
function pick(id){const e=state.employees.find(x=>x.id===id); q.value=e.name; sugg.classList.remove('open'); hideVIntro(); focusEmployee(id,true);}
q.addEventListener('input',()=>{sIdx=0; suggest();});
q.addEventListener('keydown',e=>{const items=sugg.querySelectorAll('[data-id]'); if(e.key==='ArrowDown'){sIdx=Math.min(items.length-1,sIdx+1); suggest();} else if(e.key==='ArrowUp'){sIdx=Math.max(0,sIdx-1); suggest();} else if(e.key==='Enter'){e.preventDefault(); if(items[sIdx]) pick(items[sIdx].dataset.id);} else if(e.key==='Escape') sugg.classList.remove('open');});
q.addEventListener('focus',suggest);
function renderFilters(){const f=$('#filters'); const depts=Object.keys(state.depts); f.innerHTML=depts.length?`<button class="chipb" data-d="" aria-pressed="${!filterDept}">Усі відділи</button>`+depts.map(d=>`<button class="chipb" data-d="${esc(d)}" aria-pressed="${filterDept===d}"><i style="background:${state.depts[d]}"></i>${esc(d)}</button>`).join(''):'';
  f.querySelectorAll('button').forEach(b=>b.onclick=()=>{filterDept=b.dataset.d||null; app.classList.remove('hl'); clearHighlight(); hlEmp=null; renderFilters(); applyFilter();});}
function statusOf(e){return STATUS[e.status]?e.status:'office';}
function refreshAvatarLook(){for(const e of state.employees){const g=avObjs[e.id]; if(!g) continue; const st=statusOf(e); let op=1; if(filterDept&&e.dept!==filterDept&&mode==='viewer') op=.22; setOpacity(g,op); if(g.userData.gem){const c=STATUS[st].c; g.userData.gem.material.color.set(c); g.userData.gem.material.emissive.set(c);}}}
function applyFilter(){refreshAvatarLook();}
function seatOfEmp(e){const sr=seatRef(e); if(!sr) return null; const f=state.furniture.find(x=>x.uid===sr.f); return f?seatWorld(f,sr.i):null;}
function pointBlocked(x,z){return state.furniture.some(o=>{if(FURN[o.type].underlay||FURN[o.type].onDesk) return false; const p=fp(o); return Math.abs(o.x-x)<p.w/2+.28&&Math.abs(o.z-z)<p.d/2+.28;});}
// ── Office-wide roaming (renderer-agnostic): a per-employee ephemeral position EP ──
const EP={}; // {x,z,ry,pose,roam} keyed by employee id; not persisted
function empPos(e){const ep=EP[e.id]; return ep?{x:ep.x,z:ep.z}:seatOfEmp(e);}
function distSeg(px,pz,x0,z0,x1,z1){const dx=x1-x0,dz=z1-z0,L=dx*dx+dz*dz; let t=L?((px-x0)*dx+(pz-z0)*dz)/L:0; t=Math.max(0,Math.min(1,t)); return Math.hypot(px-(x0+t*dx),pz-(z0+t*dz));}
function nearWall(x,z){for(const w of WALLS){if(distSeg(x,z,w[0],w[1],w[2],w[3])<.2) return true;} return false;}
const CORRIDOR_X=15.75; // world x-centre of the central corridor (sketch x 6..8)
// Door gaps per room: sample each room's vertical edges; gaps in the wall (nearWall false) are doorways.
let DOORS=null;
function computeDoors(){const d={};
  for(const r of ROOMS){ if(r.corridor) continue;
    for(const rc of r.rects){ for(const ex of [rc[0],rc[2]]){ let run=null; const gaps=[];
      for(let z=rc[1]+.15; z<=rc[3]-.15; z+=.12){ if(!nearWall(ex,z)){ run=run||{a:z,b:z}; run.b=z; } else if(run){ gaps.push(run); run=null; } }
      if(run) gaps.push(run);
      for(const g of gaps){ if(g.b-g.a>.5){ (d[r.id]=d[r.id]||[]).push({x:ex, z:(g.a+g.b)/2}); } }
    }}
  }
  return d;
}
function nearestDoor(rid,pt){const list=DOORS[rid]; if(!list||!list.length) return null; let best=null,bd=1e9; for(const dr of list){const dd=Math.hypot(dr.x-pt.x,dr.z-pt.z); if(dd<bd){bd=dd;best=dr;}} return best;}
// pick a free point anywhere in the office (any room or corridor) → whole-territory wandering
function pickRoamTarget(home){for(let i=0;i<28;i++){const R=ROOMS[Math.floor(Math.random()*ROOMS.length)]; const rc=R.rects[Math.floor(Math.random()*R.rects.length)]; const m=.7; const x=rc[0]+m+Math.random()*Math.max(.1,rc[2]-rc[0]-2*m); const z=rc[1]+m+Math.random()*Math.max(.1,rc[3]-rc[1]-2*m); if(!pointBlocked(x,z)&&!nearWall(x,z)) return {x,z};} return {x:home.x,z:home.z};}
// route from → to as waypoints: exit the origin room's door, cross the corridor, enter the target room's door
function buildPath(from,to){const rf=roomAt(from.x,from.z), rt=roomAt(to.x,to.z); if(rf===rt) return [to];
  const path=[]; const df=rf&&nearestDoor(rf,from); if(df){ path.push(df); path.push({x:CORRIDOR_X,z:df.z}); }
  const dt=rt&&nearestDoor(rt,to); if(dt){ path.push({x:CORRIDOR_X,z:dt.z}); path.push(dt); }
  path.push(to); return path;}
// steer toward target, sliding along walls. Two passes: first avoid walls+furniture; if boxed
// in (e.g. sitting inside a desk footprint) avoid only walls so the avatar can always step out.
function stepAvoid(ep,tgt,step){const base=Math.atan2(tgt.x-ep.x,tgt.z-ep.z); const offs=[0,.4,-.4,.8,-.8,1.3,-1.3,2.0,-2.0,Math.PI];
  for(const strict of [true,false]) for(const off of offs){const a=base+off,nx=ep.x+Math.sin(a)*step,nz=ep.z+Math.cos(a)*step; if(!nearWall(nx,nz)&&(!strict||!pointBlocked(nx,nz))){ep.x=nx;ep.z=nz;ep.ry=a;return true;}}
  return false;}
function spawnPoint(){return pickRoamTarget({x:CORRIDOR_X,z:OD/2});}
// One step along r.path → 'moving' | 'arrived' | 'stuck' (no progress for a while).
function walkStep(ep,r,dt){const p=r.path&&r.path.length?r.path:[ep]; const wp=p[Math.min(r.wi,p.length-1)]; const d=Math.hypot(wp.x-ep.x,wp.z-ep.z); ep.pose='walk'; dirty2d=true;
  if(d<.4){r.wi++; r.bestD=1e9; r.noProg=0; return r.wi>=p.length?'arrived':'moving';}
  stepAvoid(ep,wp,Math.min(d,(r.speed||1.2)*dt)); if(d<(r.bestD??1e9)-.03){r.bestD=d; r.noProg=0;} else if((r.noProg=(r.noProg||0)+1)>60){r.noProg=0; r.bestD=1e9; return 'stuck';} return 'moving';}
// Where each person in a room-booked meeting stands/sits: chairs of meeting tables in that room,
// then a ring around the room centre. Stable order (by id) so nobody swaps places.
function meetingSpots(){const out={}, byRoom={}; for(const id in LIVE.busy){const b=LIVE.busy[id]; if(b&&b.room&&liveUntil(b)) (byRoom[b.room]=byRoom[b.room]||[]).push(id);}
  for(const key in byRoom){const ids=byRoom[key].sort(); let c=null, inRoom=null;
    if(key.startsWith('rz:')){const rz=state.rects.find(x=>'rz:'+x.uid===key); if(!rz) continue; c={x:(rz.x0+rz.x1)/2,z:(rz.z0+rz.z1)/2}; inRoom=(x,z)=>x>=rz.x0&&x<=rz.x1&&z>=rz.z0&&z<=rz.z1;}
    else {const R=ROOMS.find(x=>x.id===key); if(!R) continue; const v=roomCenter(R); c={x:v.x,z:v.z}; inRoom=(x,z)=>roomAt(x,z)===key;}
    const chairs=[]; for(const f of state.furniture){const fd=FURN[f.type]; if(fd&&fd.cat==='meeting'&&fd.seats&&inRoom(f.x,f.z)) fd.seats.forEach((_,i)=>chairs.push({...seatWorld(f,i),sit:true}));}
    ids.forEach((id,k)=>{out[id]=Object.assign({key},chairs[k]||{x:c.x+Math.cos(k*2.4)*(1+.35*k),z:c.z+Math.sin(k*2.4)*(1+.35*k),ry:0,sit:false});});}
  return out;}
// Read-only probe for the e2e tests (tests/ui): where is a person right now.
window.__where=id=>{const ep=EP[id]; return ep?{x:ep.x,z:ep.z,pose:ep.pose,room:roomAt(ep.x,ep.z)}:null;};
function roamArrive(ep,r,seat,out){ if(out){r.phase='pause'; r.t=2+Math.random()*4; ep.pose='stand';}
  else if(seat){ep.x=seat.x; ep.z=seat.z; ep.ry=seat.ry; ep.pose='sit'; r.phase='sitting'; r.t=4+Math.random()*8;}
  else {r.phase='sitting'; r.t=1+Math.random()*3;} }
// An employee appears in the office if seated OR just "in office" (status). Seat-binding is optional:
// unassigned in-office employees wander the whole office endlessly, like living people.
function updateRoam(dt){const on=settings.move==='on'; if(!DOORS) DOORS=computeDoors(); const spots=meetingSpots();
  for(const e of state.employees){ const seat=seatOfEmp(e), inOffice=statusOf(e)==='office';
    if(!seat && !inOffice){ delete EP[e.id]; continue; }
    let ep=EP[e.id]; if(!ep){ const sp=seat||spawnPoint(); ep=EP[e.id]={x:sp.x,z:sp.z,ry:seat?seat.ry:0,pose:seat?'sit':'stand'}; }
    // Meeting (spec 005): walk to the booked room and stay until it ends (regardless of the move setting).
    const mt=inOffice?spots[e.id]:null;
    if(mt){ let mr=ep.roam; if(!mr||mr.meet!==mt.key){ mr=ep.roam={phase:'go',meet:mt.key,speed:1.3,path:buildPath(ep,mt),wi:0,bestD:1e9,noProg:0}; }
      if(mr.phase==='there'){ if(ep.x!==mt.x||ep.z!==mt.z){ep.x=mt.x; ep.z=mt.z; dirty2d=true;} ep.ry=mt.ry??ep.ry; ep.pose=mt.sit?'sit':'stand'; continue; }
      const st=walkStep(ep,mr,dt); if(st==='arrived'||st==='stuck'){ mr.phase='there'; dirty2d=true; } continue; }
    if(ep.roam&&ep.roam.meet){ ep.roam=seat?{phase:'back',path:buildPath(ep,seat),wi:0,bestD:1e9,noProg:0,speed:1.2}:null; } // meeting over → back to the desk
    if(seat && !on){ ep.x=seat.x; ep.z=seat.z; ep.ry=seat.ry; ep.pose='sit'; ep.roam=null; continue; } // seated + static → stay put
    const hasHome=!!seat; let r=ep.roam; if(!r){r=ep.roam={phase:'sitting',t:1+Math.random()*5};}
    if(r.phase==='sitting'){ep.pose=hasHome?'sit':'stand'; r.t-=dt; if(r.t<=0){r.phase='out'; r.speed=1.0+Math.random()*.6; r.path=buildPath(ep,pickRoamTarget(seat||ep)); r.wi=0; r.bestD=1e9; r.noProg=0;}}
    else if(r.phase==='pause'){ep.pose='stand'; r.t-=dt; if(r.t<=0){ if(hasHome){r.phase='back'; r.path=buildPath(ep,seat); r.wi=0; r.bestD=1e9; r.noProg=0;} else {r.phase='sitting'; r.t=.8+Math.random()*2.5;} }}
    else { const out=r.phase==='out'; const path=r.path&&r.path.length?r.path:[seat||ep]; let wp=path[Math.min(r.wi,path.length-1)];
      const d=Math.hypot(wp.x-ep.x,wp.z-ep.z); ep.pose='walk'; dirty2d=true;
      if(d<.4){ r.wi++; r.bestD=1e9; r.noProg=0; if(r.wi>=path.length){ roamArrive(ep,r,seat,out); } }
      else { stepAvoid(ep,wp,Math.min(d,r.speed*dt));
        // progress-based unstick: if we haven't got closer to the waypoint for a while, re-route
        if(d < (r.bestD??1e9)-.03){ r.bestD=d; r.noProg=0; }
        else if((r.noProg=(r.noProg||0)+1) > 24){ r.noProg=0; r.bestD=1e9;
          if(out){ r.path=buildPath(ep,pickRoamTarget(seat||ep)); r.wi=0; }
          else { ep.x=seat.x; ep.z=seat.z; ep.ry=seat.ry; ep.pose='sit'; r.phase='sitting'; r.t=3+Math.random()*6; } } } }
  }}
$('#shareBtn').onclick=async()=>{const url=location.href.split('?')[0]+'?mode=viewer'; try{await navigator.clipboard.writeText(url);}catch(e){} toast('Посилання «тільки перегляд» скопійовано');};

/* ---------- mode ---------- */
let lockedViewer=false; // true when opened via a share link (?mode=viewer): view-only, no Builder
function setMode(m){if(lockedViewer&&m==='builder') return; if(m===mode) return; mode=m; app.dataset.mode=m; grid.visible=m==='builder'; $$('#modeSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m===m)); cancelDrag(); select(null); closePops(); clearHighlight(); hlEmp=null; app.classList.remove('hl');
  const pill=$('#modePill'); pill.textContent=m==='viewer'?'Режим перегляду — знайдіть своє місце':'Режим будівника'; pill.classList.add('show'); setTimeout(()=>pill.classList.remove('show'),1600);
  if(view==='3d') flyTo(CENTER,OVERVIEW.clone().multiplyScalar(m==='viewer'?.95:1),900); else dirty2d=true;
  if(m==='viewer'){renderFilters(); if(state.employees.some(e=>e.seat)) showVIntro(); } else {hideVIntro(); filterDept=null;} applyFilter();}
$$('#modeSeg button').forEach(b=>b.onclick=()=>setMode(b.dataset.m));
function showVIntro(){const vi=$('#vintro'); vi.style.display=''; $('#vsearchHolder').appendChild($('#search'));}
function hideVIntro(){const vi=$('#vintro'); if(vi.style.display==='none') return; vi.style.display='none'; const hdr=$('#hdr'); hdr.insertBefore($('#search'),hdr.querySelectorAll('.spacer')[1]);}
$('#skipIntro').onclick=hideVIntro;
function hideWelcome(){$('#welcome').style.display='none';}
$('#startBtn').onclick=hideWelcome;

/* ---------- settings ---------- */
function applySettings(){if(NO_GL&&settings.view==='3d') settings.view='2d'; const viewChanged=view!==settings.view; view=settings.view; app.dataset.view=view; if(viewChanged){cancelDrag(); select(null); closePops();}
  app.dataset.layout=settings.layout; $$('#settings .opt').forEach(o=>o.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===settings[o.dataset.set])));
  if(settings.layout==='sides') $('#dock2').appendChild($('#panePeople')); else $('#dock').appendChild($('#panePeople'));
  if(settings.layout==='sides'){$('#panePeople').classList.add('on'); if(tab==='people') $$('#tabs button[role="tab"]')[0].click();} else $('#panePeople').classList.toggle('on',tab==='people');
  applyTheme(); syncAvatars(); updateZoneHint(); if(backdrop.classList.contains('open')) refreshPreview(); localStorage.setItem(LS_SET,JSON.stringify(settings));
  if(view==='2d'){ if(viewChanged) fit2d(); dirty2d=true; } else { resize(); syncFurniture(); syncZones(); }}
$$('#settings .opt').forEach(o=>o.querySelectorAll('button').forEach(b=>b.onclick=()=>{settings[o.dataset.set]=b.dataset.v; applySettings();}));
if(NO_GL){const b=$('#settings [data-set="view"] [data-v="3d"]'); if(b){b.disabled=true; b.title='3D недоступний: у браузері вимкнено WebGL (апаратне прискорення)';}}
$('#gear').onclick=e=>{e.stopPropagation(); const s=$('#settings'); const open=s.classList.contains('open'); closePops(); if(!open) s.classList.add('open');};
$('#settingsClose').onclick=closePops;
// "Clear office" wipes the HR-owned layout only; people are managed via the bot/DB
// and are intentionally left intact (delete individuals from the People list instead).
$('#resetBtn').onclick=()=>{pushUndo(); const emps=state.employees; emps.forEach(e=>{if(e.seat){e.seat=null; empUpsert(e);}}); state={furniture:[],zones:{},rects:[],employees:emps,depts:{}}; markDirty(); syncAll(); closePops(); toast('Планування очищено');};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.pop,#gear,#search,.rl')) closePops();});

/* ---------- 2D renderer (Canvas 2D top-down, пункт 1) ---------- */
const CAT_COLORS={work:'#D3BE9E',meeting:'#AEC6F2',kitchen:'#F4D48C',reception:'#EFB2AA',storage:'#C7BCA8',decor:'#B7D8AE'};
function rrect(x,y,w,h,r){r=Math.max(0,Math.min(r,w/2,h/2)); ctx2.beginPath(); ctx2.moveTo(x+r,y); ctx2.arcTo(x+w,y,x+w,y+h,r); ctx2.arcTo(x+w,y+h,x,y+h,r); ctx2.arcTo(x,y+h,x,y,r); ctx2.arcTo(x,y,x+w,y,r); ctx2.closePath();}
function draw2DFurn(f,color,S2,sel,ghost){const {w,d}=fp(f); const c=w2s(f.x,f.z); const pw=w*S2,pd=d*S2; const seated=!!FURN[f.type].seats;
  ctx2.save(); ctx2.translate(c.x,c.y); rrect(-pw/2,-pd/2,pw,pd,Math.min(7,pw*.16,pd*.16)); ctx2.fillStyle=color; ctx2.fill(); ctx2.lineWidth=sel?3:1.4; ctx2.strokeStyle=sel?'#E2001A':'rgba(60,40,30,.35)'; ctx2.stroke();
  if(seated&&!ghost){for(let i=0;i<FURN[f.type].seats.length;i++){const sw=seatWorld(f,i); const sp=w2s(sw.x,sw.z); ctx2.beginPath(); ctx2.arc(sp.x-c.x,sp.y-c.y,Math.max(3,S2*.14),0,Math.PI*2); ctx2.fillStyle=seatTaken(f.uid,i)?'rgba(226,0,26,.16)':'rgba(255,255,255,.6)'; ctx2.fill(); ctx2.lineWidth=1; ctx2.strokeStyle='rgba(60,40,30,.4)'; ctx2.stroke();}}
  if(pw>44&&!ghost){ctx2.fillStyle='rgba(43,37,48,.72)'; ctx2.font=`700 ${Math.max(9,Math.min(12,pw*.15))}px Nunito`; ctx2.fillText(FURN[f.type].n,0,seated?-pd/2+9:0);}
  ctx2.restore();}
function drawEmp2D(e,wx,wz,S2,forceColor){if(!e) return; ctx2.save(); const p=w2s(wx,wz); if(filterDept&&e.dept!==filterDept&&mode==='viewer') ctx2.globalAlpha*=.28;
  const rr=Math.max(8,S2*.26*CS); const img=forceColor?null:photoImage(e);
  ctx2.beginPath(); ctx2.arc(p.x,p.y,rr,0,Math.PI*2);
  if(img){ ctx2.save(); ctx2.clip(); const s=Math.max(2*rr/img.width,2*rr/img.height),dw=img.width*s,dh=img.height*s; ctx2.drawImage(img,p.x-dw/2,p.y-dh/2,dw,dh); ctx2.restore(); ctx2.lineWidth=2; ctx2.strokeStyle='#fff'; ctx2.stroke(); }
  else { ctx2.fillStyle=forceColor||e.color; ctx2.fill(); ctx2.lineWidth=2; ctx2.strokeStyle='#fff'; ctx2.stroke();
    ctx2.fillStyle='#fff'; ctx2.font=`800 ${Math.round(rr*.82)}px Nunito`; ctx2.textAlign='center'; ctx2.textBaseline='middle'; ctx2.fillText(initials(e.name),p.x,p.y); }
  ctx2.font=`${Math.round(rr*1.3)}px "Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx2.fillText((MOODS[e.mood]||MOODS.good).e,p.x,p.y-rr*1.8); const bdg=badgeOf(e); if(bdg){ctx2.font=`${Math.round(rr*1.05)}px "Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx2.fillText(bdg,p.x+rr*1.25,p.y-rr*1.7);}
  if(hlEmp===e.id){ctx2.beginPath(); ctx2.arc(p.x,p.y,rr+6,0,Math.PI*2); ctx2.strokeStyle='#E2001A'; ctx2.lineWidth=3; ctx2.stroke();}
  ctx2.restore();}
function draw2D(){dirty2d=false; const th=THEMES[settings.theme]; const W=innerWidth,H=innerHeight,S2=view2.scale;
  ctx2.setTransform(Math.min(2,devicePixelRatio||1),0,0,Math.min(2,devicePixelRatio||1),0,0);
  ctx2.clearRect(0,0,W,H); ctx2.fillStyle=th.bg; ctx2.fillRect(0,0,W,H); ctx2.textAlign='center'; ctx2.textBaseline='middle';
  for(const r of ROOMS){const base=new THREE.Color(r.corridor?th.cor:th.floor); const z=state.zones[r.id]; if(z) base.lerp(new THREE.Color(zoneColor(z)),th.zone);
    ctx2.fillStyle='#'+base.getHexString(); const polys=r.polys||r.rects.map(([x0,z0,x1,z1])=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]);
    for(const poly of polys){ctx2.beginPath(); poly.forEach(([x,z],i)=>{const p=w2s(x,z); i?ctx2.lineTo(p.x,p.y):ctx2.moveTo(p.x,p.y);}); ctx2.closePath(); ctx2.fill();}}
  // floor grid (разметка)
  ctx2.save(); ctx2.strokeStyle=th.ui==='dark'?'rgba(255,255,255,.055)':'rgba(60,40,30,.075)'; ctx2.lineWidth=1;
  for(let x=0;x<=OW+.01;x+=1){const a=w2s(x,0),b=w2s(x,OD); ctx2.beginPath(); ctx2.moveTo(a.x,a.y); ctx2.lineTo(b.x,b.y); ctx2.stroke();}
  for(let z=0;z<=OD+.01;z+=1){const a=w2s(0,z),b=w2s(OW,z); ctx2.beginPath(); ctx2.moveTo(a.x,a.y); ctx2.lineTo(b.x,b.y); ctx2.stroke();}
  ctx2.restore();
  for(const rz of state.rects){const a=w2s(rz.x0,rz.z0),b=w2s(rz.x1,rz.z1); ctx2.save(); ctx2.globalAlpha=.5; ctx2.fillStyle=zoneColor(rz); ctx2.fillRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y)); ctx2.restore();}
  const dm=w2s(3*S,.6); ctx2.save(); ctx2.globalAlpha=.85; ctx2.fillStyle='#E2001A'; ctx2.fillRect(dm.x-.8*S2,dm.y-.4*S2,1.6*S2,.8*S2); ctx2.restore();
  ctx2.strokeStyle=th.ui==='dark'?'#6b6675':'#b3a48f'; ctx2.lineWidth=Math.max(2,.16*S2); ctx2.lineCap='round';
  for(const [x0,z0,x1,z1] of WALLS){const a=w2s(x0,z0),b=w2s(x1,z1); ctx2.beginPath(); ctx2.moveTo(a.x,a.y); ctx2.lineTo(b.x,b.y); ctx2.stroke();}
  const rank=f=>FURN[f.type].underlay?0:(FURN[f.type].onDesk?2:1); const list=[...state.furniture].sort((a,b)=>rank(a)-rank(b));
  for(const f of list){if(drag&&drag.kind==='furn'&&drag.fromExisting&&drag.f.uid===f.uid) continue; draw2DFurn(f,CAT_COLORS[FURN[f.type].cat]||'#c9bdaa',S2,selected===f.uid,false);}
  if(drag&&drag.kind==='furn'&&drag.over){ctx2.save(); ctx2.globalAlpha=.72; draw2DFurn(drag.f,drag.ok?'#8fd6a3':'#f2a29a',S2,false,true); ctx2.restore();}
  if(drag&&drag.kind==='rect'){const a=w2s(drag.x0,drag.z0),b=w2s(drag.x1,drag.z1),X=Math.min(a.x,b.x),Y=Math.min(a.y,b.y),Wd=Math.abs(b.x-a.x),Hd=Math.abs(b.y-a.y); ctx2.save(); ctx2.globalAlpha=.4; ctx2.fillStyle='#5B76E6'; ctx2.fillRect(X,Y,Wd,Hd); ctx2.restore(); ctx2.strokeStyle='#5B76E6'; ctx2.lineWidth=2; ctx2.strokeRect(X,Y,Wd,Hd);}
  for(const e of state.employees){if(drag&&drag.kind==='emp'&&drag.id===e.id) continue; const s=empPos(e); if(!s) continue; drawEmp2D(e,s.x,s.z,S2);}
  if(drag&&drag.kind==='emp'){const gx=drag.gx??view2.ox,gz=drag.gz??view2.oz; ctx2.save(); ctx2.globalAlpha=.8; drawEmp2D(state.employees.find(x=>x.id===drag.id),gx,gz,S2,drag.seat?'#4CAF6E':null); ctx2.restore();}}
/* 2D hit-testing */
function furnHit2(wx,wz){for(let i=state.furniture.length-1;i>=0;i--){const f=state.furniture[i]; if(FURN[f.type].underlay) continue; const {w,d}=fp(f); if(Math.abs(wx-f.x)<=w/2+.05&&Math.abs(wz-f.z)<=d/2+.05) return f.uid;} return null;}
function avAt2(wx,wz){let best=null,bd=1e9; const rr=Math.max(.32,(Math.max(8,view2.scale*.26))/view2.scale); for(const e of state.employees){const s=empPos(e); if(!s) continue; const dd=Math.hypot(s.x-wx,s.z-wz); if(dd<rr&&dd<bd){bd=dd;best=e.id;}} return best;}
/* 2D focus tween */
let fly2=null;
function fly2To(x,z,scale){fly2={t0:performance.now(),ms:700,ox0:view2.ox,oz0:view2.oz,s0:view2.scale,ox1:x,oz1:z,s1:scale};}
function update2DFocus(now){if(!fly2) return; const k=Math.min(1,(now-fly2.t0)/fly2.ms),e=ease(k); view2.ox=fly2.ox0+(fly2.ox1-fly2.ox0)*e; view2.oz=fly2.oz0+(fly2.oz1-fly2.oz0)*e; view2.scale=fly2.s0+(fly2.s1-fly2.s0)*e; dirty2d=true; if(k>=1) fly2=null;}
/* 2D pointer interaction on #c2 */
let pan2=null;
c2.addEventListener('pointerdown',e=>{if(e.button===2){pan2={x:e.clientX,y:e.clientY,ox:view2.ox,oz:view2.oz}; return;} if(e.button!==0) return; downPos={x:e.clientX,y:e.clientY};
  if(drag&&drag.kind==='furn'&&drag.sticky){updateDrag2(e); drag.sticky=false; finishDrag(e); if(drag) drag.sticky=true; return;}
  if(mode==='builder'&&tab==='zones'&&settings.zoning==='rect'&&!drag){const w=s2w(e.clientX,e.clientY); if(roomAt(w.x,w.z)){drag={kind:'rect',x0:snap(w.x),z0:snap(w.z),x1:snap(w.x),z1:snap(w.z)}; dirty2d=true; return;}}
  if(!drag){pan2={x:e.clientX,y:e.clientY,ox:view2.ox,oz:view2.oz};}});
c2.addEventListener('pointermove',e=>{if(drag){updateDrag(e); return;}
  if(pan2){const ax=e.clientX-pan2.x, ay=e.clientY-pan2.y, c=ROTC[view2.rot], s=ROTS[view2.rot]; view2.ox=pan2.ox-(ax*c+ay*s)/(view2.scale*view2.flip); view2.oz=pan2.oz-(-ax*s+ay*c)/view2.scale; dirty2d=true; return;}
  const w=s2w(e.clientX,e.clientY); const aid=avAt2(w.x,w.z); if(aid!==hoverEmp){hoverEmp=aid;} c2.style.cursor=aid?'pointer':(mode==='builder'&&tab==='furniture'&&furnHit2(w.x,w.z)?'pointer':'grab');});
c2.addEventListener('pointerup',e=>{const moved=downPos&&Math.hypot(e.clientX-downPos.x,e.clientY-downPos.y)>5; pan2=null; downPos=null;
  if(drag&&drag.kind==='rect'){finishDrag(e); return;}
  if(drag&&(drag.kind==='furn'||drag.kind==='emp')){if(drag.sticky) return; /* finished by document pointerup */ return;}
  if(moved) return; const w=s2w(e.clientX,e.clientY); closePops();
  if(mode==='viewer'){const id=avAt2(w.x,w.z); if(id) focusEmployee(id,true); return;}
  const aid=avAt2(w.x,w.z); if(aid){const emp=state.employees.find(x=>x.id===aid); if(emp){showCard(emp); return;}}
  if(tab==='zones'&&settings.zoning==='click'){const rid=roomAt(w.x,w.z); if(rid) openZonePop({room:rid}); return;}
  const fu=furnHit2(w.x,w.z); if(fu&&tab!=='zones') select(fu); else select(null);});
c2.addEventListener('pointerleave',()=>{hoverEmp=null;});
c2.addEventListener('contextmenu',e=>e.preventDefault());
c2.addEventListener('wheel',e=>{e.preventDefault(); const w=s2w(e.clientX,e.clientY); view2.scale=Math.max(4,Math.min(120,view2.scale*Math.exp(-e.deltaY*.0012))); const w2=s2w(e.clientX,e.clientY); view2.ox+=w.x-w2.x; view2.oz+=w.z-w2.z; dirty2d=true;},{passive:false});
$('#v2rotL').onclick=()=>rotateView(-1); $('#v2rotR').onclick=()=>rotateView(1); $('#v2flip').onclick=flipView;

/* ---------- HR analytics tab + HR settings: js/office/hr.js ---------- */
const HR=initHr({$, API, app, esc, getToken, openTokenModal, toast});

/* ---------- init ---------- */
const params=new URLSearchParams(location.search);
applySettings(); syncAll();
// In the Telegram Mini App the user is not HR: run as a locked viewer (no building),
// but they may still edit their OWN character and use the phone.
if(params.get('mode')==='viewer'||TG.active){mode='viewer'; lockedViewer=true; grid.visible=false; app.dataset.mode='viewer'; app.dataset.locked='viewer'; $$('#modeSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.m==='viewer'));}
initLoad().then(async okServer=>{
  syncAll();
  setSyncStatus(okServer?'Синхронізовано з сервером':'Локальні дані (офлайн)', true);
  if(okServer) startEmpPolling(); // reflect bot-created people & daily check-ins live
  if(TG.active){
    await tgVerify();                                   // who am I (linked character)?
    if(PHONE.personalStart) PHONE.personalStart();      // personal phone: session, tasks, chats
    renderFilters();
    setTimeout(()=>{const fab=$('#phoneFab'); if(fab) fab.click();}, 350); // open the phone (only the phone)
    // Precise status so it can be diagnosed on mobile (no console there):
    if(TG.me) toast(`Вітаю, ${TG.me.name.split(' ')[0]}! 👋`);
    else if(TG.tgId) toast('Профіль не знайдено. Створи його в боті: /start');
    else toast('Не вдалося визначити користувача ('+(TG.diag||'?')+'). Онови застосунок.');
    return;
  }
  if(mode==='viewer'){renderFilters(); if(state.employees.some(e=>e.seat)) showVIntro();}
  else if(!state.furniture.length&&!Object.keys(state.zones).length) $('#welcome').style.display='';
});

function resize(){renderer.setSize(innerWidth,innerHeight); camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); resize2();} addEventListener('resize',resize); fit2d(); resize();
const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; let lastT=0;
function loop(now){requestAnimationFrame(loop); const dt=Math.min(.05,(now-lastT)/1000); lastT=now;
  if(view==='2d'){ updateRoam(dt); pan2FromKeys(dt); update2DFocus(now); if(dirty2d||drag||fly2||pan2||panKeys.size||settings.move==='on') draw2D(); }
  else {
    for(const mx of mixers) mx.update(dt);
    updateRoam(dt); for(const id in avObjs){const g=avObjs[id]; const ep=EP[id]; if(ep){g.position.set(ep.x,.02,ep.z); g.rotation.y=ep.ry; loadPose(g,ep.pose==='sit'?true:ep.pose==='stand'?false:'walk');} const gm=g.userData.gem,ms=g.userData.moodSprite,pht=g.userData.photoSprite; const bob=Math.sin(now/500)*.05; if(gm){gm.rotation.y+=dt*1.8; gm.position.set(0,g.userData.tagY+.45+bob,0);} if(pht) pht.position.set(0,g.userData.tagY+.62+bob,0); if(ms) ms.position.set(0,g.userData.tagY+(pht?1.15:.95)+bob,0); const bd=g.userData.badgeSprite; if(bd) bd.position.set(.42,g.userData.tagY+(pht?1.15:.95)+bob,0);}
    if(fly){const k=Math.min(1,(now-fly.t0)/fly.ms), e=ease(k); camera.position.lerpVectors(fly.p0,fly.p1,e); controls.target.lerpVectors(fly.t0v,fly.t1,e); if(k>=1) fly=null;}
    panFromKeys(dt); controls.update();
    if(hlRing){const s=1+Math.sin(now/300)*.08; hlRing.scale.set(s,1,s);} if(hlArrow){hlArrow.position.y=hlArrow.userData.y0??(hlArrow.userData.y0=hlArrow.position.y); hlArrow.position.y+=Math.abs(Math.sin(now/350))*.35;}
    renderer.render(scene,camera);
  }
  updateLabels();
  if(backdrop.classList.contains('open')&&pAv){pRenderer.render(pScene,pCam); const pv=$('#preview').getBoundingClientRect(), cr=$('#pc').getBoundingClientRect(); const v=new THREE.Vector3(0,pAv.userData.tagY+.1,0).project(pCam); const t=$('#ptag'); t.style.left=(cr.left-pv.left+(v.x+1)/2*cr.width)+'px'; t.style.top=(cr.top-pv.top+(1-v.y)/2*cr.height)+'px';}}
/* ---------- phone (AllianceOS) — lives in public/phone.js ---------- */
const PHONE=initPhone({get state(){return state;}, $, API, DEPT_COLORS, MOODS, ROOMS, STATUS, TG, ZONES, apiEmpWrite, app, applySettings, avHTML, empPos, empUpsert, esc, focusEmployee, getToken, params, refreshLive, renderLabels, renderPeople, roomAt, roomName, settings, statusOf, syncAvatars, toast});
requestAnimationFrame(loop);
