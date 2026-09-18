'use strict';
// Design Atlas のビューワ。埋め込み JSON だけを読み、外部へは一切取りに行かない。
// ドメインの語はすべて model.json 由来で、このファイルには 1 つも書かない。
(() => {
const D=JSON.parse(document.getElementById('atlas-data').textContent);
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const all=[...D.screens,...D.entities,...D.processes], lookup=new Map(all.map(n=>[n.id,n]));
const screen=id=>D.screens.find(s=>s.id===id||s.key===id);
const entity=id=>D.entities.find(e=>e.id===id||e.key===id);
const group=id=>D.groups.find(g=>g.id===id);
const area=id=>D.areas.find(a=>a.id===id);
const lane=id=>D.lanes.find(l=>l.id===id);
const source=id=>D.sources.find(s=>s.id===id);
const label=id=>lookup.get(id)?.name||group(id)?.name||id;
const statusText=D.labels.status, fieldRole=D.labels.field_roles, weightText=D.labels.weights;
const modes=Object.keys(D.layouts);
let mode=modes[0], selected=null, selectedEdge=null, query='', activeGroup=null, scenario='all', relatedOnly=false;
let positions={}, graphEdges=[], width=1600,height=1000,camera={x:0,y:0,z:1}, drag=null, lastDragged=0;
// モデルを改訂したら保存キーが変わり、古いモデルの手動配置は持ち込まれない。
const cameras={}, storageKey=()=>`design-atlas-${D.meta.id}-v${D.meta.model_version}-${mode}`;
let routed={},routePositions={},routingMs=0,measuredPorts={};
let worldBounds={x:0,y:0,w:1600,h:1000},miniBounds=worldBounds,drawFrame=0;
const modeInfo=D.views;
const canvas=$('#canvas'),world=$('#world'),nodes=$('#nodes'),edges=$('#edges');
function crossRelated(id){
 const set=new Set(id?[id]:[]); if(!id)return set;
 const s=screen(id);
 if(s&&s.id===id){s.entities.forEach(x=>set.add(x));s.processes.forEach(x=>set.add(x));D.transitions.filter(t=>t.a===id||t.b===id).forEach(t=>{set.add(t.a);set.add(t.b)});}
 if(entity(id)?.id===id){D.screens.filter(x=>x.entities.includes(id)).forEach(x=>{set.add(x.id);x.processes.forEach(p=>set.add(p))});D.relations.filter(r=>r.a===id||r.b===id).forEach(r=>{set.add(r.a);set.add(r.b)});}
 const p=D.processes.find(x=>x.id===id);
 if(p){if(p.screen)set.add(p.screen);p.entities.forEach(x=>set.add(x));D.processEdges.filter(e=>e.a===id||e.b===id).forEach(e=>{set.add(e.a);set.add(e.b)});}
 D.groups.forEach(g=>{if(g.screens.some(x=>set.has(x))||g.entities.some(x=>set.has(x))||g.processes.some(x=>set.has(x)))set.add(g.id)});
 return set;
}
function groupRelated(gid){const g=group(gid);return new Set(g?[g.id,...g.screens,...g.entities,...g.processes]:[])}
function searchable(n){return [n.name,n.key,n.id,n.desc,n.note,n.origin,...(n.fields||[]).flatMap(f=>[f.name,f.label])].filter(Boolean).join(' ').toLowerCase()}
function currentSet(){
 let focus=selectedEdge?new Set([selectedEdge.a,selectedEdge.b]):selected?crossRelated(selected):activeGroup?groupRelated(activeGroup):null;
 if(query){const matches=new Set(all.filter(n=>searchable(n).includes(query.toLowerCase())).map(n=>n.id));focus=focus?new Set([...focus].filter(id=>matches.has(id))):matches;}
 if(mode==='flow'&&scenario!=='all'){
   const chosen=D.scenarios.find(s=>s.id===scenario);
   if(chosen){
    const set=new Set(D.processes.filter(p=>chosen.conditions.includes(p.cond)).map(p=>p.id));
    chosen.include.forEach(id=>set.add(id));
    focus=focus?new Set([...focus].filter(id=>set.has(id))):set;
   }
 }
 return focus;
}
function imageSrc(key){return D.images[key]??null}
function screenNode(s,x,y,w,withPorts){
 const shot=s.images[0];
 // 画像が無いモデルでも成立させる。空の枠を高さ分だけ確保すると、画面カードが間延びして読めなくなる。
 const imageH=shot?Math.round(w*(shot.width&&shot.height?shot.height/shot.width:D.imageRatio)):0;
 let pins='',ports='';
 if(withPorts){const outgoing=D.transitions.filter(t=>t.a===s.id);let pi=0;
   for(const t of outgoing){
    if(t.pin){pi++;const p=t.pin;
      pins+=`<button class="pin" data-edge="${t.id}" data-port="${t.id}" style="left:${p.xPct}%;top:${p.yPct}%" title="${esc(t.label)} → ${esc(label(t.b))}" aria-label="${esc(t.label)}から${esc(label(t.b))}への遷移">${pi}</button>`;
    }else{ports+=`<button class="action-port" data-edge="${t.id}" data-port="${t.id}"><i class="port-dot"></i>${esc(t.label)}</button>`;}
   }
 }
 const src=shot?imageSrc(shot.key):null;
 const el=document.createElement('article');el.className='node screen-node';el.dataset.id=s.id;
 const figure=src?`<button class="shot-open" data-preview="${s.id}" aria-label="${esc(s.name)}のスクリーンショットを拡大"><img src="${esc(src)}" alt="${esc(s.name)}の画面" draggable="false"></button>`:'';
 const shotBlock=imageH?`<div class="shot" style="height:${imageH}px">${shot.historical?'<span class="historical-shot">参考画像 · 現行版は詳細から開く</span>':''}${figure}${pins}</div>`:(pins?`<div class="shot" style="height:0">${pins}</div>`:'');
 el.innerHTML=`<div class="node-head"><span class="node-code">${s.code}</span><button class="node-title" data-select="${s.id}">${esc(s.name)}</button><button class="drag-handle" aria-label="${esc(s.name)}の配置を移動">⠿</button></div>${shotBlock}<div class="node-footer"><span>${esc(s.role)}</span><button data-select="${s.id}">${s.entities.length} データ ↗</button></div>${ports?`<div class="action-ports">${ports}</div>`:''}`;
 addNode(el,s.id,x,y,w,46+imageH+37+(ports?70:0));
}
function entityNode(e,x,y,w,compact=false){
 const domain=area(e.area)?.label;
 const el=document.createElement('article');el.className='node entity-node '+e.status;el.dataset.id=e.id;
 el.innerHTML=`<div class="node-head"><span class="node-code">${compact?'↳':'◈'}</span><button class="node-title" data-select="${e.id}">${esc(e.name)}</button><button class="drag-handle" aria-label="${esc(e.name)}の配置を移動">⠿</button></div>`+(compact?`<div class="entity-bottom"><span>${esc(e.origin)}</span></div>`:`<div class="entity-source" title="${esc(e.origin)}">${domain?esc(domain)+' · ':''}${esc(e.origin)}</div>${e.fields.map(f=>`<button class="field" data-select="${e.id}" data-field="${esc(f.name)}" data-port="${esc(f.name)}" title="${esc(f.label)}"><span class="field-role ${f.proposed?'role-question':''}">${esc(fieldRole[f.role]||'·')}</span><code>${esc(f.name)}</code></button>`).join('')}<div class="entity-bottom"><span>${esc(statusText[e.status]||e.status)}</span><span>詳細 ↗</span></div>`);
 addNode(el,e.id,x,y,w,compact?75:95+e.fields.length*34);
}
function flowNode(p,x,y,w){
 const el=document.createElement('article');el.className='node flow-node'+(p.extra?' extra':'');el.dataset.id=p.id;
 const cond=D.conditionLabels[p.cond]??p.cond??'';
 const ln=lane(p.lane);
 const target=p.screen?`<button data-jump="${p.screen}" data-mode="screens">▣ ${esc(label(p.screen))} ↗</button>`:'';
 el.innerHTML=`<div class="node-head"><span class="node-code">${p.extra?'+':'#'}${esc(p.number??'')}</span><button class="node-title" data-select="${p.id}">${esc(p.name)}</button><button class="drag-handle" aria-label="${esc(p.name)}の配置を移動">⠿</button></div><div class="flow-body"><span class="department">${esc(ln?.label??'')}</span><p>${esc(p.sys)}</p>${target}<span class="cond">${esc(cond)}</span></div>`;
 addNode(el,p.id,x,y,w,110);
}
function addNode(el,id,x,y,w,h){Object.assign(el.style,{left:x+'px',top:y+'px',width:w+'px'});positions[id]={x,y,w,h};nodes.append(el)}
function render(){
 positions={};graphEdges=[];routed={};measuredPorts={};nodes.replaceChildren();$('#bands').replaceChildren();
 const info=modeInfo[mode];$('#mode-eyebrow').textContent=info.eyebrow;$('#view-title').textContent=info.title;$('#view-description').textContent=info.description;$('#canvas-caption').textContent=info.caption;$('#scenario').hidden=mode!=='flow'||!D.scenarios.length;
 $$('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===mode)));
 const layout=D.layouts[mode],place=id=>layout.nodes[id];
 width=layout.bounds.w;height=layout.bounds.h;
 if(mode==='overview'){
  D.groups.forEach((g,i)=>{
   const p=place(g.id),el=document.createElement('article');el.className='node group-node';el.dataset.id=g.id;
   el.innerHTML=`<button class="drag-handle" aria-label="${esc(g.name)}の配置を移動">⠿</button><div class="group-top">${String(i+1).padStart(2,'0')} / BUSINESS</div><button class="node-title" data-group="${g.id}">${esc(g.name)}</button><p>${esc(g.sub)}</p>`;addNode(el,g.id,p.x,p.y,p.w,p.h);
   g.screens.forEach(id=>{const q=place(id);if(q)screenNode(screen(id),q.x,q.y,q.w,false)});
   if(g.primary){const q=place(g.primary);if(q)entityNode(entity(g.primary),q.x,q.y,q.w,true)}
  });
 }else if(mode==='screens'){
  D.screens.forEach(s=>{const p=place(s.id);screenNode(s,p.x,p.y,p.w,true)});
 }else if(mode==='er'){
  D.entities.forEach(e=>{const p=place(e.id);entityNode(e,p.x,p.y,p.w)});
 }else{
  D.processes.forEach(p=>{const q=place(p.id);flowNode(p,q.x,q.y,q.w)});
 }
 graphEdges=D.edges[mode].map(e=>({...e}));
 Object.assign(world.style,{width:width+'px',height:height+'px'});edges.setAttribute('width',width);edges.setAttribute('height',height);
 try{const saved=JSON.parse(localStorage.getItem(storageKey())||'{}');for(const [id,p] of Object.entries(saved)){if(positions[id]&&Number.isFinite(p.x)&&Number.isFinite(p.y)){positions[id].x=p.x;positions[id].y=p.y;const el=nodeElement(id);el.style.left=p.x+'px';el.style.top=p.y+'px'}}}catch{}
 for(const [id,p] of Object.entries(positions))p.h=nodeElement(id).offsetHeight;
 updateBounds();renderCatalog();renderDetails();
 if(cameras[mode]){camera={...cameras[mode]};setCamera()}else readableView();
 settleRoutes();drawEdges();applyFocus();
}
function updateBounds(){
 const ps=Object.values(positions),extra=Object.values(routed).flatMap(r=>[...r.points.map(p=>({x:p.x,y:p.y,w:0,h:0})),...(r.labelBox?[r.labelBox]:[])]),bounds=[...ps,...extra];
 const x=Math.min(...bounds.map(p=>p.x))-90,y=Math.min(...bounds.map(p=>p.y))-90;
 worldBounds={x,y,w:Math.max(...bounds.map(p=>p.x+p.w))+90-x,h:Math.max(...bounds.map(p=>p.y+p.h))+90-y};
}
function nodeElement(id){return [...nodes.children].find(el=>el.dataset.id===id)}
function settleRoutes(){
 const start=performance.now();
 for(const [id] of Object.entries(positions)){
  const n=nodeElement(id),r=n.getBoundingClientRect();
  // Hidden cards have zero DOM bounds. Retain their last visible field positions.
  if(r.height>0)measuredPorts[id]=Object.fromEntries([...n.querySelectorAll('[data-port]')].map(f=>{const b=f.getBoundingClientRect();return[f.dataset.port,{y:(b.y-r.y+b.height/2)/camera.z}]}));
 }
 routed=AtlasRouting.routeAll(positions,graphEdges,measuredPorts,mode);
 routePositions=JSON.parse(JSON.stringify(positions));routingMs=performance.now()-start;updateBounds();
}
function edgeShape(e){
 const route=routed[e.id];if(!route)return null;
 if(!drag?.id)return route;
 const a=positions[e.a],b=positions[e.b],oa=routePositions[e.a],ob=routePositions[e.b];
 const ad={x:a.x-oa.x,y:a.y-oa.y},bd={x:b.x-ob.x,y:b.y-ob.y};
 const points=route.points.map((p,i)=>{const t=i/(route.points.length-1);return{x:p.x+ad.x*(1-t)+bd.x*t,y:p.y+ad.y*(1-t)+bd.y*t}});
 return {...route,points,path:AtlasRouting.toPath(points),s:{...points[0],dir:route.s.dir},t:{...points.at(-1),dir:route.t.dir},mx:route.mx+(ad.x+bd.x)/2,my:route.my+(ad.y+bd.y)/2,leader:null};
}
function drawEdges(){
 const defs='<defs><marker id="arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M2 2L10 6L2 10" fill="none" stroke="#4b8053" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></marker><marker id="arrow-active" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M2 2L10 6L2 10" fill="none" stroke="#236747" stroke-width="2"/></marker></defs>';
 edges.innerHTML=defs+graphEdges.map((e,i)=>{
  const g=edgeShape(e,i);if(!g)return'';
  const dash=e.strength===1||e.type==='exception',arrow=!['relation','proposed','mapping'].includes(e.type);
  const text=e.label||'',lw=g.labelWidth,title=`${label(e.a)} → ${label(e.b)}：${text}。${['','補助・候補','参照・依存','強い関係'][e.strength]}：${e.reason}`;
  return `<g class="connection strength-${e.strength} ${dash?'dashed':''} ${e.type==='exception'?'exception':''}" data-edge-id="${e.id}" data-strength="${e.strength}" role="button" tabindex="0" aria-label="${esc(title)}"><title>${esc(title)}</title><path class="edge-hit" d="${g.path}"/><path class="edge-bridge" d="${g.path}"/><path class="edge-path" d="${g.path}" ${arrow?'marker-end="url(#arrow)"':''}/>${text?`<g class="edge-label ${mode==='flow'?'always':''}">${g.leader?`<path class="label-leader" d="M${g.leader.x},${g.leader.y} L${g.mx},${g.my}"/>`: ''}<rect x="${g.mx-lw/2}" y="${g.my-13}" width="${lw}" height="26" rx="7"/><text x="${g.mx}" y="${g.my+4}" text-anchor="middle">${esc(text)}</text></g>`:''}${e.ca?`<text class="cardinality" x="${g.s.x+(g.s.dir||1)*13}" y="${g.s.y-12}" text-anchor="${g.s.dir===-1?'end':'start'}">${esc(e.ca)}</text><text class="cardinality" x="${g.t.x+(g.t.dir||-1)*13}" y="${g.t.y-12}" text-anchor="${g.t.dir===1?'start':'end'}">${esc(e.cb)}</text>`:''}</g>`;
 }).join('');
}
function applyFocus(){
 const focus=currentSet();let count=0;
 for(const [id] of Object.entries(positions)){
  const el=nodeElement(id),match=!focus||focus.has(id);el.classList.toggle('is-selected',id===selected||id===activeGroup);el.classList.toggle('is-related',!!focus&&match);el.classList.toggle('is-dim',!!focus&&!match);el.classList.toggle('is-hidden',relatedOnly&&!!focus&&!match);if(match)count++;
 }
 for(const e of graphEdges){const el=edges.querySelector(`[data-edge-id="${e.id}"]`);if(!el)continue;const hit=!focus||(focus.has(e.a)&&focus.has(e.b));el.classList.toggle('dim',!!focus&&!hit);el.classList.toggle('highlight',!!focus&&hit);el.classList.toggle('active-edge',selectedEdge?.id===e.id);el.style.display=relatedOnly&&!hit?'none':'';if(el.querySelector('.edge-path').hasAttribute('marker-end'))el.querySelector('.edge-path').setAttribute('marker-end',`url(#${focus&&hit?'arrow-active':'arrow'})`);}
 $$('.pin').forEach(b=>b.classList.toggle('is-active',b.dataset.edge===selectedEdge?.id));
 $('#visible-count').textContent=`${count} / ${Object.keys(positions).length} 項目${focus?' · 関連を表示':''}`;$('#empty').hidden=count>0;
 $$('#catalog button').forEach(b=>b.classList.toggle('active',b.dataset.select===selected));$$('#group-list button').forEach(b=>b.classList.toggle('active',b.dataset.group===activeGroup));
 $('#selection-bar').hidden=!selected&&!selectedEdge&&!activeGroup;$('#selection-title').textContent=selectedEdge?.label||label(selected||activeGroup||'');
 updateMinimap();
}
function renderCatalog(){
 const items=mode==='er'?D.entities:mode==='flow'?D.processes:mode==='overview'?[...D.groups,...D.screens]:D.screens;
 const filtered=items.filter(n=>!query||searchable(n).includes(query.toLowerCase()));
 $('#catalog-count').textContent=filtered.length;
 $('#catalog').innerHTML=filtered.map(n=>`<button data-select="${n.id}" title="${esc(n.name)}"><i></i>${esc(n.name)}<small>${esc(n.code||n.number||'')}</small></button>`).join('');
}
function setCamera(){world.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;$('#zoom-label').textContent=Math.round(camera.z*100)+'%';updateMinimap()}
function fitBounds(bounds,maxZoom=1){
 const cw=canvas.clientWidth,ch=canvas.clientHeight,top=innerWidth<=720?180:140,bottom=110;
 camera.z=Math.max(.06,Math.min((cw-90)/bounds.w,(ch-top-bottom)/bounds.h,maxZoom));
 camera.x=cw/2-(bounds.x+bounds.w/2)*camera.z;camera.y=top+(ch-top-bottom)/2-(bounds.y+bounds.h/2)*camera.z;setCamera();
}
function fit(){fitBounds(worldBounds)}
function readableView(){
 const widths={er:360,flow:320};
 camera.z=Math.min(1,(canvas.clientWidth-50)/(widths[mode]??420));
 if(selected&&positions[selected]){centerNode(selected);return}
 // 起点は各面の先頭。モデル側の並び順がそのまま「最初に見る場所」になる。
 const first=(mode==='flow'?D.processes:mode==='er'?D.entities:mode==='overview'?D.groups:D.screens)[0];
 const start=first&&positions[first.id]||Object.values(positions)[0];
 if(!start)return;
 const top=innerWidth<=720?185:145,bottom=110;
 camera.x=canvas.clientWidth/2-(start.x+start.w/2)*camera.z;
 camera.y=top+(canvas.clientHeight-top-bottom)/2-(start.y+start.h/2)*camera.z;setCamera();
}
function zoom(factor,point){
 const x=point?.x??canvas.clientWidth/2,y=point?.y??canvas.clientHeight/2,z=Math.min(2.2,Math.max(.06,camera.z*factor));
 camera.x=x-(x-camera.x)*z/camera.z;camera.y=y-(y-camera.y)*z/camera.z;camera.z=z;setCamera();
}
function centerNode(id){
 const p=positions[id];if(!p)return;
 const cw=canvas.clientWidth,ch=canvas.clientHeight,occupied=!$('#inspector').hidden&&cw>720?380:0;
 camera.z=Math.min(1.2,Math.max(camera.z,Math.min(1,(cw-occupied-60)/p.w)));
 camera.x=(cw-occupied)/2-(p.x+p.w/2)*camera.z;camera.y=(innerWidth<=720?190:150)+(ch-(innerWidth<=720?190:150)-115)/2-(p.y+p.h/2)*camera.z;setCamera();
}
function fitRelated(){const set=currentSet(),ps=Object.entries(positions).filter(([id])=>!set||set.has(id)).map(([,p])=>p);if(!ps.length)return;const x=Math.min(...ps.map(p=>p.x))-25,y=Math.min(...ps.map(p=>p.y))-25;fitBounds({x,y,w:Math.max(...ps.map(p=>p.x+p.w))+25-x,h:Math.max(...ps.map(p=>p.y+p.h))+25-y})}
function updateMinimap(){
 const mini=$('#minimap');if(!mini||!mini.clientWidth)return;
 const vx=-camera.x/camera.z,vy=-camera.y/camera.z,vw=canvas.clientWidth/camera.z,vh=canvas.clientHeight/camera.z;
 const x=Math.min(worldBounds.x,vx),y=Math.min(worldBounds.y,vy),w=Math.max(worldBounds.x+worldBounds.w,vx+vw)-x,h=Math.max(worldBounds.y+worldBounds.h,vy+vh)-y;
 const ratio=mini.clientWidth/(mini.clientHeight||100),mw=Math.max(w,h*ratio),mh=mw/ratio;miniBounds={x:x-(mw-w)/2,y:y-(mh-h)/2,w:mw,h:mh};
 mini.setAttribute('viewBox',`${miniBounds.x} ${miniBounds.y} ${mw} ${mh}`);
 mini.innerHTML=Object.entries(positions).map(([id,p])=>`<rect class="mini-node ${id===selected||id===activeGroup?'selected':''}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="15"/>`).join('')+`<rect class="mini-viewport" x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="8"/>`;
}
function choose(id,center=false){
 if(!lookup.has(id)){if(D.groups.some(g=>g.id===id))chooseGroup(id);return}
 selected=id;selectedEdge=null;activeGroup=null;drawEdges();applyFocus();renderDetails();closeCatalog(false);openInspector();
 if(center)centerNode(id);$('#live').textContent=label(id)+'を選択';
}
function chooseGroup(id){activeGroup=id;selected=null;selectedEdge=null;drawEdges();applyFocus();renderDetails();closeCatalog(false);openInspector();centerNode(id)}
function changeView(next,preserveEdge=false){if(!modeInfo[next])return;if(mode!==next){cameras[mode]={...camera};if(selectedEdge&&!preserveEdge){selected=selectedEdge.a;selectedEdge=null}}mode=next;closeInspector(false);closeCatalog(false);render()}
function jump(id,next){const isGroup=D.groups.some(g=>g.id===id);selected=isGroup?null:id;selectedEdge=null;activeGroup=isGroup?id:null;if(next&&mode!==next)changeView(next);else{drawEdges();applyFocus();renderDetails()}openInspector();centerNode(id)}
function tag(status){return `<span class="status-tag ${esc(status)}">${esc(statusText[status]??status)}</span>`}
function chips(ids,view){return `<div class="detail-chips">${[...new Set(ids)].map(id=>`<button data-jump="${id}" data-mode="${view}">${esc(label(id))} ↗</button>`).join('')}</div>`}
function detailLinks(screens){return `<div class="detail-list">${screens.map(s=>`<button class="detail-link" data-jump="${s.id}" data-mode="screens"><span class="link-arrow">↗</span><b>${esc(s.name)}</b><small>${esc(s.desc)}</small></button>`).join('')}</div>`}
function relationList(e){return D.relations.filter(r=>r.a===e.id||r.b===e.id).map(r=>{const other=r.a===e.id?r.b:r.a;return `<div class="relation-item"><button data-jump="${other}" data-mode="er">${esc(label(other))} ↗</button><small>${esc(label(r.a))} ${esc(r.ca)} → ${esc(r.cb)} ${esc(label(r.b))}<br>${esc(r.label)}${r.proposed?' · 設計候補':''}</small></div>`}).join('')}
function sourceButton(id,find){const s=source(id);if(!s)return '';
 const text=s.kind==='note'?`${esc(s.note??id)}${s.range?' '+esc(s.range):''}`:`${esc(s.path??id)}${s.range?' '+esc(s.range):''}`;
 const body=D.sources.find(x=>x.id===id)?.embedded;
 if(!body)return `<p class="detail-note">根拠：${esc(text)}${s.commit?`<br><code>${esc(s.commit)}</code>`:''}</p>`;
 return `<button class="source-button" data-source="${esc(id)}"${find?` data-find="${esc(find)}"`:''}>根拠：${esc(text)}</button>`;
}
function renderDetails(){
 let html='';
 if(selectedEdge&&selectedEdge.type!=='navigation'){const e=selectedEdge;
  html=`<p class="detail-kicker">RELATIONSHIP</p><h2 class="detail-title">${esc(e.label||'つながり')}</h2>${strengthDetail(e)}<div class="detail-label">接続する項目</div>${chips([e.a,e.b],mode)}${e.ca?`<p class="detail-note">${esc(label(e.a))} ${esc(e.ca)} → ${esc(e.cb)} ${esc(label(e.b))}<br>${esc(e.sourcePort)} → ${esc(e.targetPort)}</p>`:''}`;
 }else if(selectedEdge){const t=selectedEdge,from=screen(t.a);
  html=`<p class="detail-kicker">SCREEN TRANSITION</p><h2 class="detail-title">${esc(t.label)}</h2><p class="detail-desc">${esc(t.desc)}</p>${strengthDetail(t)}<div class="detail-label">遷移元 → 遷移先</div>${detailLinks([from,screen(t.b)])}${t.carry?`<div class="detail-note green"><b>引き継ぎ</b><br>${esc(t.carry)}</div>`:''}<dl class="detail-meta"><dt>操作位置</dt><dd>${t.pin?'画像内の丸い番号':'詳細表示後、または画面外の操作'}</dd>${t.selector?`<dt>確認元</dt><dd><code>${esc(t.selector)}</code></dd>`:''}</dl><div class="detail-action">${from.images.length?`<button data-preview="${t.a}">操作画面を見る</button>`:''}<button data-jump="${t.b}" data-mode="screens">遷移先に移動 ↗</button></div><hr class="detail-rule">${sourceButton(from.source,t.selector)}`;
 }else if(screen(selected)?.id===selected){
  const s=screen(selected),ts=D.transitions.filter(t=>t.a===s.id),shot=s.images[0];
  html=`<p class="detail-kicker">${s.code} / SCREEN</p><h2 class="detail-title">${esc(s.name)}</h2><p class="detail-desc">${esc(s.desc)}</p>${shot&&imageSrc(shot.key)?`<button class="detail-image-button" data-preview="${s.id}"><img class="detail-image" src="${esc(imageSrc(shot.key))}" alt="${esc(s.name)}の画面"></button>`:''}<dl class="detail-meta"><dt>担当</dt><dd>${esc(s.role)}</dd>${s.version?`<dt>対象版</dt><dd>${esc(s.version)}</dd>`:''}${s.note?`<dt>ポイント</dt><dd>${esc(s.note)}</dd>`:''}</dl><div class="detail-action">${s.mock?`<a href="${esc(s.mock.href)}" target="_blank" rel="noopener">${esc(s.mock.label||'実物を開く')} ↗</a>`:''}</div>${sourceButton(s.source)}<hr class="detail-rule"><div class="detail-label">関連データ <b>${s.entities.length}</b></div>${chips(s.entities,'er')}<hr class="detail-rule"><div class="detail-label">画面内の操作・遷移 <b>${ts.length}</b></div><div class="detail-list">${ts.map(t=>`<button class="detail-link" data-edge="${t.id}"><span class="link-arrow">→</span>${esc(t.label)}<small>${esc(label(t.b))}${t.carry?' · '+esc(t.carry):''}</small></button>`).join('')||'<p class="detail-desc">この画面から他の画面への遷移は登録されていません。</p>'}</div><hr class="detail-rule"><div class="detail-label">業務のどこで使うか</div>${chips(s.processes,'flow')}`;
 }else if(entity(selected)?.id===selected){
  const e=entity(selected),ss=D.screens.filter(s=>s.entities.includes(e.id));
  html=`<p class="detail-kicker">ENTITY / DATA MODEL</p><h2 class="detail-title">${esc(e.name)}</h2>${tag(e.status)}<p class="detail-desc" style="margin-top:14px">${esc(e.note)}</p><div class="detail-label">項目</div><table class="detail-fields"><tbody>${e.fields.map(f=>`<tr><td><code>${esc(f.name)}</code><br>${esc(f.label)}</td><td>${esc(fieldRole[f.role]||'値')}${f.proposed?' · 候補':''}</td></tr>`).join('')}</tbody></table><div class="detail-note">KEY / REF は、この設計上の識別・参照のしかたです。実DBの PK・FK 制約が設定済みという意味ではありません。</div>${sourceButton(e.source,e.origin)}<hr class="detail-rule"><div class="detail-label">使われる画面 <b>${ss.length}</b></div>${detailLinks(ss)}<hr class="detail-rule"><div class="detail-label">関係と多重度</div>${relationList(e)}`;
 }else if(lookup.get(selected)&&D.processes.some(p=>p.id===selected)){
  const b=lookup.get(selected),ln=lane(b.lane),links=D.processEdges.filter(e=>e.a===b.id);
  html=`<p class="detail-kicker">${b.extra?'SUPPLEMENT':'BUSINESS STEP'}${b.number!=null?' / '+esc(String(b.number).padStart(2,'0')):''}</p><h2 class="detail-title">${esc(b.name)}</h2><p class="detail-desc">${esc(b.desc)}</p><dl class="detail-meta">${ln?`<dt>担当</dt><dd>${esc(ln.label)}${ln.external?'（社外）':''}</dd>`:''}${b.sys?`<dt>現行ツール</dt><dd>${esc(b.sys)}</dd>`:''}${b.reads?`<dt>読み取る</dt><dd>${esc(b.reads)}</dd>`:''}${b.writes?`<dt>残す情報</dt><dd>${esc(b.writes)}</dd>`:''}${b.lt?`<dt>目安L/T</dt><dd>${esc(b.lt)}</dd>`:''}</dl>${b.screen?`<hr class="detail-rule"><div class="detail-label">対応する操作画面</div>${detailLinks([screen(b.screen)])}`:''}<hr class="detail-rule"><div class="detail-label">関連データ</div>${chips(b.entities,'er')}<hr class="detail-rule"><div class="detail-label">次の工程・分岐</div><div class="detail-list">${links.map(e=>`<button class="detail-link" data-jump="${e.b}" data-mode="flow">${esc(e.label)} → ${esc(label(e.b))}</button>`).join('')||'<p class="detail-desc">このフローの終点です。</p>'}</div>${b.extra?'<div class="detail-note">原資料に番号が無く、後から補った工程です。</div>':''}${sourceButton(b.source,b.name)}`;
 }else if(activeGroup){
  const g=group(activeGroup);
  html=`<p class="detail-kicker">BUSINESS AREA</p><h2 class="detail-title">${esc(g.name)}</h2><p class="detail-desc">${esc(g.sub)}</p><div class="detail-label">対応する画面</div>${detailLinks(g.screens.map(screen))}<hr class="detail-rule"><div class="detail-label">扱うデータ</div>${chips(g.entities,'er')}<hr class="detail-rule"><div class="detail-label">業務工程</div>${chips(g.processes,'flow')}`;
 }else{
  html=`<p class="detail-kicker">START EXPLORING</p><h2 class="detail-title">${esc(D.meta.title)}</h2><p class="detail-desc">画面、工程、データを選ぶと、接続線と詳細が連動します。</p>${D.trace?`<div class="example-box"><code>${esc(D.trace.title)}</code>${D.trace.subtitle?`<small>${esc(D.trace.subtitle)}</small>`:''}<button class="primary" data-example>${esc(D.trace.label)}</button></div>`:''}<div class="detail-label">見る順番</div>${modes.filter(m=>m!=='overview').map((m,i)=>`<div class="numbered-step"><span class="number">${String(i+1).padStart(2,'0')}</span><div><button data-view="${m}"><b>${esc(modeInfo[m].title)} ↗</b></button><p>${esc(modeInfo[m].description)}</p></div></div>`).join('')}<button class="source-button" data-guide>図の読み方・根拠・未確定事項</button>`;
 }
 const moving=selected||activeGroup;
 if(moving&&positions[moving])html+=`<section class="move-controls"><p>配置を動かす（1回40px）</p>${[['left','←'],['up','↑'],['down','↓'],['right','→']].map(([d,t])=>`<button data-move="${d}" aria-label="選択項目を${{left:'左',up:'上',down:'下',right:'右'}[d]}へ移動">${t}</button>`).join('')}</section>`;
 $('#details').innerHTML=html;
}
function strengthDetail(e){return `<div class="detail-note green"><span class="strength-key"><i style="--weight:${[0,1.8,3,5][e.strength]||3}px"></i>${esc(weightText[e.strength]||'')}</span>${e.reason?`<br>${esc(e.reason)}`:''}<br><small>線幅は関係の種類を表します。件数・頻度の数値ではありません。</small></div>`}
function openViewer(title,caption,tabs,content){
 $('#viewer-title').textContent=title;$('#viewer-caption').textContent=caption;
 $('#viewer-tabs').innerHTML=tabs;$('#viewer-content').innerHTML=content;
 if(!$('#viewer').open)$('#viewer').showModal();$('#viewer-content').scrollTop=0;
}
let viewingScreen=null;
function preview(id,key){const s=screen(id);if(!s||!s.images.length)return;viewingScreen=s;
 const imageKey=key||s.images[0].key,shown=s.images.find(i=>i.key===imageKey)||s.images[0];
 const stamp=esc(shown.captured_at?String(shown.captured_at).slice(0,10):'撮影日時の記録なし');
 const caption=`${shown.historical?'現行版より古い参考画像':'SCREEN CAPTURE'} / ${stamp}`;
 openViewer(s.name,caption,s.images.map(i=>`<button data-image="${esc(i.key)}" class="${i.key===imageKey?'active':''}">${esc(i.label)}</button>`).join(''),imageSrc(shown.key)?`<img src="${esc(imageSrc(shown.key))}" alt="${esc(s.name)}：${esc(shown.label)}">`:'<p>この画像は同梱されていません。</p>');
}
function showSource(file,find=''){
 const text=D.sourceBodies[file];if(!text)return;
 const lines=text.split('\n');let index=find?lines.findIndex(l=>l.includes(find)):-1;
 if(index<0&&find){const safe=find.replace(/[#.\[\]"=]/g,' ').trim().split(/\s+/).find(w=>w.length>4);index=safe?lines.findIndex(l=>l.includes(safe)):-1;}
 const start=Math.max(0,index-6),end=index>=0?Math.min(lines.length,index+45):Math.min(lines.length,100);
 const excerpt=lines.slice(start,end).map((l,i)=>String(start+i+1).padStart(4,' ')+'  '+l).join('\n');
 const meta=source(file);
 openViewer('根拠：'+(meta?.path??meta?.note??file),'CURRENT SOURCE / 現行ソース（画像とは取得時点が異なります）',`<button class="active">${start+1}–${end} 行 / 全 ${lines.length} 行</button>${lines.length>end-start?`<button data-source-full="${esc(file)}">全文を見る</button>`:''}`,`<pre>${esc(excerpt)}</pre>`);
}
function showGuide(){
 const sections=D.guide.map(g=>`<h3>${esc(g.heading)}</h3>${g.body.map(p=>`<p>${esc(p)}</p>`).join('')}${g.source?sourceButton(g.source):''}`).join('');
 const questions=D.openQuestions.length?`<h3>確定前の設計</h3><ul>${D.openQuestions.map(q=>`<li>${esc(q.text)}${q.scope?` <small>（${esc(q.scope)}）</small>`:''}</li>`).join('')}</ul>`:'';
 // 未実施の検証は必ず出す。ここを省くと「全部確かめた」と読まれる。
 const unverified=`<h3>実施していない検証</h3>${D.notVerified.length?`<ul>${D.notVerified.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:'<p>未実施の検証は記録されていません。</p>'}`;
 // 本文を同梱したときは、それを黙って配らない。配布物に何が載っているかを読み手に見せる。
 const embedded=D.embedsSourceText?`<h3>同梱している本文</h3><p>この設計マップには、根拠にした入力の<b>本文そのもの</b>が埋め込まれています（「根拠：…」から読めます）。配布先を選んでください。</p>`:'<h3>同梱している本文</h3><p>根拠にした入力の本文は埋め込んでいません。出典の表記だけを載せています。</p>';
 const evidence=D.evidence?`<h3>この版の証跡</h3><p>入力 ${D.evidence.sources} 件・model.json の SHA-256 は <code>${esc(D.evidence.model_sha256.slice(0,16))}…</code>。実行した検査の一覧と日時は同梱の検証結果ファイルにあります。</p>`:'';
 const weights=`<h3>線の太さの意味</h3><p>${[3,2,1].map(w=>`<b>${esc(weightText[w]||'')}</b>`).join(' / ')} の 3 段階です。関係の種類を表すもので、件数や利用頻度を測った値ではありません。線をクリックすると、その分類の理由が開きます。</p>`;
 const sourceList=D.sources.length?`<h3>根拠にした入力</h3><ul>${D.sources.map(s=>`<li>${esc(s.path??s.note??s.id)}${s.range?` ${esc(s.range)}`:''}${s.commit?` <code>${esc(s.commit)}</code>`:''}</li>`).join('')}</ul>`:'';
 openViewer('図の読み方と根拠','ABOUT THIS ATLAS','<button class="active">ガイド</button>',`<div class="guide-content">${weights}${sections}${questions}${unverified}${sourceList}${embedded}${evidence}</div>`);
}
function traceExample(){
 if(!D.trace)return;
 selected=null;activeGroup=null;selectedEdge=null;query='';$('#search').value='';
 const t=D.trace;
 const steps=t.steps.map((s,i)=>{
  const target=screen(s.target)?.id??entity(s.target)?.id;
  const view=target&&target.startsWith('e-')?'er':'screens';
  return `<div class="numbered-step"><span class="number">${i+1}</span><div><button data-jump="${target}" data-mode="${view}"><b>${esc(s.title)} ↗</b></button><p>${esc(s.description??'')}</p></div></div>`;
 }).join('');
 $('#details').innerHTML=`<p class="detail-kicker">TRACE</p><h2 class="detail-title" style="font-family:var(--mono)">${esc(t.title)}</h2>${t.subtitle?`<p class="detail-desc">${esc(t.subtitle)}</p>`:''}${steps}${t.note?`<div class="detail-note">${esc(t.note)}</div>`:''}`;
 openInspector();
}
function openInspector(){closeCatalog(false);$('#inspector').hidden=false;$('#open-inspector').setAttribute('aria-expanded','true')}
function closeInspector(restore=true){const focused=$('#inspector').contains(document.activeElement);$('#inspector').hidden=true;$('#open-inspector').setAttribute('aria-expanded','false');if(restore&&focused)$('#open-inspector').focus()}
function openCatalog(focusSearch=false){closeInspector(false);$('#catalog-panel').hidden=false;$('#open-catalog').setAttribute('aria-expanded','true');if(focusSearch)$('#search').focus()}
function closeCatalog(restore=true){const focused=$('#catalog-panel').contains(document.activeElement);$('#catalog-panel').hidden=true;$('#open-catalog').setAttribute('aria-expanded','false');if(restore&&focused)$('#open-catalog').focus()}
function clearSelection(){selected=null;selectedEdge=null;activeGroup=null;query='';$('#search').value='';scenario='all';$('#scenario').value='all';drawEdges();applyFocus();renderCatalog();renderDetails();closeInspector(false)}
function selectTransition(id){const t=D.transitions.find(t=>t.id===id);if(!t)return;selectedEdge={...t};selected=null;activeGroup=null;if(mode!=='screens')changeView('screens',true);else{drawEdges();applyFocus();renderDetails()}openInspector()}
function selectEdge(id){const e=graphEdges.find(e=>e.id===id);if(!e)return;if(e.type==='navigation'){selectTransition(id);return}selectedEdge=e;selected=null;activeGroup=null;drawEdges();applyFocus();renderDetails();openInspector()}
function saveLayout(){try{localStorage.setItem(storageKey(),JSON.stringify(Object.fromEntries(Object.entries(positions).map(([id,p])=>[id,{x:p.x,y:p.y}]))))}catch{}}
function moveNode(id,dx,dy){const p=positions[id];if(!p)return;p.x+=dx;p.y+=dy;const el=nodeElement(id);el.style.left=p.x+'px';el.style.top=p.y+'px';settleRoutes();drawEdges();applyFocus();saveLayout();$('#live').textContent=label(id)+'の配置を移動しました'}
function pan(direction){camera.x+=direction==='left'?160:direction==='right'?-160:0;camera.y+=direction==='up'?160:direction==='down'?-160:0;setCamera()}
document.addEventListener('click',event=>{
 if(Date.now()-lastDragged<180)return;
 const edge=event.target.closest('.connection');if(edge){selectEdge(edge.dataset.edgeId);return}
 const b=event.target.closest('button');if(!b)return;
 if(b.dataset.view){changeView(b.dataset.view);return}
 if(b.dataset.select){choose(b.dataset.select,b.closest('#catalog')!==null);return}
 if(b.dataset.group){chooseGroup(b.dataset.group);return}
 if(b.dataset.jump){jump(b.dataset.jump,b.dataset.mode);return}
 if(b.dataset.edge){selectTransition(b.dataset.edge);return}
 if(b.dataset.pan){pan(b.dataset.pan);return}
 if(b.dataset.move){const dir=b.dataset.move;moveNode(selected||activeGroup,dir==='left'?-40:dir==='right'?40:0,dir==='up'?-40:dir==='down'?40:0);return}
 if(b.dataset.preview){preview(b.dataset.preview,b.dataset.imageKey);return}
 if(b.dataset.image){preview(viewingScreen.id,b.dataset.image);return}
 if(b.dataset.source){showSource(b.dataset.source,b.dataset.find);return}
 if(b.dataset.sourceFull){$('#viewer-content').innerHTML=`<pre>${esc(D.sourceBodies[b.dataset.sourceFull].split('\n').map((l,i)=>(i+1)+'  '+l).join('\n'))}</pre>`;return}
 if(b.hasAttribute('data-guide'))showGuide();if(b.hasAttribute('data-example'))traceExample();
});
$('#group-list').innerHTML=D.groups.map((g,i)=>`<button data-group="${g.id}"><span>${String(i+1).padStart(2,'0')}</span>${esc(g.name)}</button>`).join('');
$('#group-list').previousElementSibling.hidden=!D.groups.length;
$('#search').addEventListener('input',e=>{query=e.target.value.trim();renderCatalog();drawEdges();applyFocus();$('#live').textContent=$('#visible-count').textContent});
$('#scenario').addEventListener('change',e=>{scenario=e.target.value;applyFocus()});
$('#related-only').addEventListener('change',e=>{relatedOnly=e.target.checked;applyFocus()});
$('#clear').addEventListener('click',clearSelection);$('#trace-example')?.addEventListener('click',traceExample);$('#guide').addEventListener('click',showGuide);
$('#zoom-in').addEventListener('click',()=>zoom(1.2));$('#zoom-out').addEventListener('click',()=>zoom(1/1.2));$('#fit').addEventListener('click',()=>fit(true));
$('#reset-layout').addEventListener('click',()=>{try{localStorage.removeItem(storageKey())}catch{}delete cameras[mode];render();$('.canvas-options').open=false});
$('#readable').addEventListener('click',readableView);$('#zoom-label').addEventListener('click',()=>zoom(1/camera.z));
$('#focus-selection').addEventListener('click',()=>centerNode(selected||activeGroup||selectedEdge?.a));$('#fit-related').addEventListener('click',fitRelated);
function toggleMap(collapsed){$('.minimap-wrap').classList.toggle('collapsed',collapsed);$('#toggle-map').setAttribute('aria-expanded',String(!collapsed));$('#toggle-map').setAttribute('aria-label',collapsed?'全体マップを開く':'全体マップを折りたたむ');$('#toggle-map').textContent=collapsed?'MAP ▸':'MAP ▾';if(!collapsed)updateMinimap()}
$('#toggle-map').addEventListener('click',()=>toggleMap(!$('.minimap-wrap').classList.contains('collapsed')));
if(innerWidth<=720)toggleMap(true);
$('#map-fit').addEventListener('click',fit);$('#edge-guide').addEventListener('click',showGuide);
$('#open-catalog').addEventListener('click',()=>$('#catalog-panel').hidden?openCatalog(true):closeCatalog());$('#close-catalog').addEventListener('click',()=>closeCatalog());
$('#minimap').addEventListener('click',e=>{const r=e.currentTarget.getBoundingClientRect(),x=miniBounds.x+(e.clientX-r.x)/r.width*miniBounds.w,y=miniBounds.y+(e.clientY-r.y)/r.height*miniBounds.h;camera.x=canvas.clientWidth/2-x*camera.z;camera.y=canvas.clientHeight/2-y*camera.z;setCamera()});
$('#open-inspector').addEventListener('click',()=>$('#inspector').hidden?openInspector():closeInspector());$('#close-inspector').addEventListener('click',()=>closeInspector());
$('#viewer-close').addEventListener('click',()=>$('#viewer').close());$('#viewer').addEventListener('click',e=>{if(e.target===$('#viewer')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}});
canvas.addEventListener('pointerdown',e=>{
 if(e.button!==0)return;
 const handle=e.target.closest('.drag-handle');
 if(!handle&&e.target.closest('.node,.overlay,button,select,input,.connection,details'))return;
 const id=handle?.closest('.node').dataset.id;
 drag={id,x:e.clientX,y:e.clientY,px:id?positions[id].x:camera.x,py:id?positions[id].y:camera.y,moved:false};canvas.setPointerCapture(e.pointerId);canvas.classList.add('dragging');e.preventDefault();
});
canvas.addEventListener('pointermove',e=>{
 if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
 if(Math.abs(dx)+Math.abs(dy)>4)drag.moved=true;
 if(drag.id){
  const p=positions[drag.id];p.x=drag.px+dx/camera.z;p.y=drag.py+dy/camera.z;
  const el=nodeElement(drag.id);el.style.left=p.x+'px';el.style.top=p.y+'px';
  if(!drawFrame)drawFrame=requestAnimationFrame(()=>{drawFrame=0;updateBounds();drawEdges();applyFocus()});
 }else{camera.x=drag.px+dx;camera.y=drag.py+dy;setCamera()}
});
function finishDrag(){if(!drag)return;const changed=drag.moved&&drag.id;if(drag.moved)lastDragged=Date.now();drag=null;if(changed){if(drawFrame){cancelAnimationFrame(drawFrame);drawFrame=0}settleRoutes();drawEdges();applyFocus();saveLayout();$('#live').textContent=label(changed)+'を移動し、接続線を引き直しました'}canvas.classList.remove('dragging')}
canvas.addEventListener('pointerup',finishDrag);canvas.addEventListener('pointercancel',finishDrag);
canvas.addEventListener('wheel',e=>{
 if(e.target.closest('.overlay'))return;
 e.preventDefault();if(e.ctrlKey||e.metaKey){const r=canvas.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.003),{x:e.clientX-r.x,y:e.clientY-r.y})}else{camera.x-=e.deltaX;camera.y-=e.deltaY;setCamera()}
},{passive:false});
document.addEventListener('keydown',e=>{
 if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
 if(e.key==='/'&&!$('#viewer').open){e.preventDefault();openCatalog(true)}
 if(e.key==='Escape'&&!$('#viewer').open){closeInspector();closeCatalog();$('.canvas-options').open=false}
 const edge=e.target.closest('.connection');if(edge&&['Enter',' '].includes(e.key)){e.preventDefault();selectEdge(edge.dataset.edgeId)}
 const directions={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'},direction=directions[e.key];
 if(direction&&e.target.closest('.drag-handle')){e.preventDefault();const id=e.target.closest('.node').dataset.id;moveNode(id,direction==='left'?-40:direction==='right'?40:0,direction==='up'?-40:direction==='down'?40:0)}
 else if(direction&&(e.target===canvas||e.target===$('#minimap'))){e.preventDefault();pan(direction)}
 if(e.target===$('#minimap')&&['Enter',' '].includes(e.key)){e.preventDefault();fit()}
});
// Resizing preserves the user's camera instead of fitting and shrinking every object again.
window.addEventListener('resize',()=>updateMinimap());
// Keyboard traversal brings off-screen nodes into the camera without native hidden scrolling.
canvas.addEventListener('focusin',e=>{const node=e.target.closest('.node');if(!node)return;const r=node.getBoundingClientRect(),c=canvas.getBoundingClientRect();if(r.left<c.left+16||r.right>c.right-16||r.top<c.top+140||r.bottom>c.bottom-100)centerNode(node.dataset.id)});
canvas.addEventListener('scroll',()=>{canvas.scrollLeft=0;canvas.scrollTop=0});
render();
// Read-only hooks for validating the delivered artifact and correspondence data.
// 配布した成果物をそのまま機械検証するための読み取り専用の口。verify-browser が使う。
window.ATLAS={data:D,modes,getState:()=>({mode,selected,selectedEdge:selectedEdge?.id,query,scenario,camera:{...camera},positions:JSON.parse(JSON.stringify(positions)),bounds:{...worldBounds},routingMs,routes:JSON.parse(JSON.stringify(routed)),edges:graphEdges.map(e=>({...e}))}),setMode:m=>changeView(m)};
})();
