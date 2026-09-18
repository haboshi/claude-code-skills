/* 経路探索とラベル配置。オフラインの layout.mjs とブラウザの viewer が共有する。
   座標はキャンバス単位。ドメイン非依存で、ノード矩形・辺・ポート位置だけを受け取る。
   CommonJS のまま置く理由: viewer 側は本文をそのまま inline して UMD の globalThis 分岐で読み、
   Node 側は createRequire で読む。ESM 化すると前者が壊れる。 */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.AtlasRouting=api})(typeof globalThis!=='undefined'?globalThis:this,()=>{
'use strict';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const inside=(p,r)=>p.x>r.x+.1&&p.x<r.x+r.w-.1&&p.y>r.y+.1&&p.y<r.y+r.h-.1;
const inflate=(r,d)=>({x:r.x-d,y:r.y-d,w:r.w+2*d,h:r.h+2*d});
function segmentHits(a,b,r){
 let lo=0,hi=1;
 for(const [v,d,min,max] of [[a.x,b.x-a.x,r.x+.1,r.x+r.w-.1],[a.y,b.y-a.y,r.y+.1,r.y+r.h-.1]]){
  if(Math.abs(d)<1e-8){if(v<=min||v>=max)return false;continue}
  const t1=(min-v)/d,t2=(max-v)/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>=hi)return false;
 }
 return hi>0&&lo<1;
}
function sample(points,step=18){
 const out=[];
 for(let i=0;i<points.length-1;i+=3){
  const [a,b,c,d]=points.slice(i,i+4),steps=Math.max(4,Math.ceil((distance(a,b)+distance(b,c)+distance(c,d))/step));
  for(let j=i?1:0;j<=steps;j++){const t=j/steps,u=1-t;out.push({x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y})}
 }
 return out;
}
function rounded(points,radius=28){
 const clean=points.filter((p,i)=>!i||distance(p,points[i-1])>.1),ps=[];
 for(const p of clean){while(ps.length>1){const a=ps.at(-2),b=ps.at(-1);if(Math.abs((b.x-a.x)*(p.y-b.y)-(b.y-a.y)*(p.x-b.x))>.1||(b.x-a.x)*(p.x-b.x)+(b.y-a.y)*(p.y-b.y)<0)break;ps.pop()}ps.push(p)}
 if(ps.length<2)return [ps[0],ps[0],ps[0],ps[0]];
 const out=[ps[0]];let from=ps[0];
 const line=to=>{if(distance(from,to)<.1)return;out.push(lerp(from,to,1/3),lerp(from,to,2/3),to);from=to};
 for(let i=1;i<ps.length-1;i++){const a=ps[i-1],b=ps[i],c=ps[i+1],r=Math.min(radius,distance(a,b)*.35,distance(b,c)*.35),pre=lerp(b,a,r/distance(a,b)),post=lerp(b,c,r/distance(b,c));line(pre);out.push(lerp(pre,b,2/3),lerp(post,b,2/3),post);from=post}
 line(ps.at(-1));return out;
}
function blocked(points,nodes,exclude=[]){
 const rects=Object.entries(nodes).filter(([id])=>!exclude.includes(id)).map(([,n])=>inflate(n,8)),ps=sample(points);
 return ps.some((p,i)=>rects.some(r=>inside(p,r)||(i&&segmentHits(ps[i-1],p,r))));
}
function toPath(ps){let d=`M${ps[0].x},${ps[0].y}`;for(let i=1;i<ps.length;i+=3)d+=` C${ps[i].x},${ps[i].y} ${ps[i+1].x},${ps[i+1].y} ${ps[i+2].x},${ps[i+2].y}`;return d}
// Nearby samples reserve space for already drawn edges. Crossing incurs a short
// penalty, whereas following the same channel incurs a penalty over its length.
function reservations(){
 const cells=new Map(),key=(x,y)=>`${x},${y}`;
 const segments=new Map();let routeIndex=0;
 const segmentCells=(a,b)=>{const keys=[];for(let x=Math.floor(Math.min(a.x,b.x)/64);x<=Math.floor(Math.max(a.x,b.x)/64);x++)for(let y=Math.floor(Math.min(a.y,b.y)/64);y<=Math.floor(Math.max(a.y,b.y)/64);y++)keys.push(key(x,y));return keys};
 return {
  add(ps){const points=sample(ps,16);for(const p of points){const k=key(Math.floor(p.x/32),Math.floor(p.y/32));if(!cells.has(k))cells.set(k,[]);cells.get(k).push(p)}
   for(let i=1;i<points.length;i++){const segment={a:points[i-1],b:points[i],start:points[0],end:points.at(-1),routeIndex};for(const k of segmentCells(segment.a,segment.b)){if(!segments.has(k))segments.set(k,[]);segments.get(k).push(segment)}}routeIndex++;
  },
  crossings(ps){const points=sample(ps,16),hits=new Set();
   for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y;
    for(const other of new Set(segmentCells(a,b).flatMap(k=>segments.get(k)||[]))){const c=other.a,d=other.b,ex=d.x-c.x,ey=d.y-c.y,den=dx*ey-dy*ex;if(Math.abs(den)<.001)continue;
     const t=((c.x-a.x)*ey-(c.y-a.y)*ex)/den,u=((c.x-a.x)*dy-(c.y-a.y)*dx)/den;if(t<=0||t>=1||u<=0||u>=1)continue;
     const p={x:a.x+t*dx,y:a.y+t*dy};if([points[0],points.at(-1),other.start,other.end].some(q=>distance(p,q)<24))continue;
     hits.add(`${other.routeIndex}:${Math.round(p.x/4)}:${Math.round(p.y/4)}`);
    }
   }return hits.size;
  },
  cost(p){let d=24;const x=Math.floor(p.x/32),y=Math.floor(p.y/32);for(let i=x-1;i<=x+1;i++)for(let j=y-1;j<=y+1;j++)for(const q of cells.get(key(i,j))||[])d=Math.min(d,distance(p,q));return d<8?32:d<16?10:d<22?2:0}
 };
}
class Heap{
 constructor(){this.items=[]}
 push(v){let i=this.items.length;this.items.push(v);while(i){const p=(i-1)>>1;if(this.items[p].score<=v.score)break;this.items[i]=this.items[p];i=p}this.items[i]=v}
 pop(){const top=this.items[0],v=this.items.pop();if(this.items.length){let i=0;while(i*2+1<this.items.length){let c=i*2+1;if(c+1<this.items.length&&this.items[c+1].score<this.items[c].score)c++;if(this.items[c].score>=v.score)break;this.items[i]=this.items[c];i=c}this.items[i]=v}return top}
}
function detour(start,end,nodes,reserve,offset){
 const rects=Object.values(nodes).map(n=>inflate(n,20));
 const xs=[...new Set([start.x,end.x,...rects.flatMap(r=>[r.x-offset,r.x+r.w+offset])])].sort((a,b)=>a-b);
 const ys=[...new Set([start.y,end.y,...rects.flatMap(r=>[r.y-offset,r.y+r.h+offset])])].sort((a,b)=>a-b);
 const nx=xs.length,ny=ys.length,points=ys.flatMap(y=>xs.map(x=>({x,y}))),free=points.map(p=>!rects.some(r=>inside(p,r)));
 const source=ys.indexOf(start.y)*nx+xs.indexOf(start.x),target=ys.indexOf(end.y)*nx+xs.indexOf(end.x);
 const dist=new Map(),prev=new Map(),heap=new Heap(),edgeCosts=new Map();
 const sourceState=source*3;dist.set(sourceState,0);heap.push({id:sourceState,score:0,cost:0});let final=-1;
 while(heap.items.length){
  const entry=heap.pop(),state=entry.id;if(entry.cost!==dist.get(state))continue;
  const u=Math.floor(state/3),axis=state%3;if(u===target){final=state;break}
  const x=u%nx,y=Math.floor(u/nx);
  for(const [v,nextAxis] of [[x?u-1:-1,1],[x<nx-1?u+1:-1,1],[y?u-nx:-1,2],[y<ny-1?u+nx:-1,2]]){
   if(v<0||!free[v])continue;const ek=u<v?`${u}:${v}`:`${v}:${u}`;let cost=edgeCosts.get(ek);
   if(cost===undefined){
    const a=points[u],b=points[v];cost=Infinity;
    if(!rects.some(r=>segmentHits(a,b,r))){const len=distance(a,b),count=Math.max(1,Math.ceil(len/24));let congestion=0;for(let j=0;j<count;j++)congestion+=reserve.cost(lerp(a,b,(j+.5)/count));cost=len+congestion*3}
    edgeCosts.set(ek,cost);
   }
   const ns=v*3+nextAxis,nd=entry.cost+cost+(axis&&axis!==nextAxis?50:0);
   if(nd<(dist.get(ns)??Infinity)){dist.set(ns,nd);prev.set(ns,state);heap.push({id:ns,cost:nd,score:nd+Math.abs(points[v].x-end.x)+Math.abs(points[v].y-end.y)})}
  }
 }
 if(final<0)return null;
 const path=[];for(let s=final;s!==undefined;s=prev.get(s))path.unshift(points[Math.floor(s/3)]);return path;
}
function anchors(nodes,edges,ports,mode){
 const ends={},direction=1;
 for(const e of edges){
  const a=nodes[e.a],b=nodes[e.b],back=mode!=='er'&&mode!=='overview'&&(e.type==='exception'||(b.x-a.x)*direction<0);
  const vertical=mode==='overview'&&Math.abs(b.x-a.x)<Math.max(a.w,b.w)*.8;
  const sideA=back?'bottom':vertical?(b.y>a.y?'bottom':'top'):(b.x+b.w/2>a.x+a.w/2?'right':'left');
  const sideB=back?'bottom':vertical?(b.y>a.y?'top':'bottom'):(sideA==='right'?'left':'right');
  ends[e.id]={a:{node:e.a,side:sideA,key:e.sourcePort,other:e.b},b:{node:e.b,side:sideB,key:e.targetPort,other:e.a},back};
 }
 for(const end of Object.values(ends))for(const role of ['a','b']){
  const a=end[role],n=nodes[a.node],horizontal=['left','right'].includes(a.side);
  const siblings=Object.values(ends).flatMap(o=>[o.a,o.b]).filter(o=>o.node===a.node&&o.side===a.side).sort((u,v)=>{const p=nodes[u.other],q=nodes[v.other];return(horizontal?p.y-q.y:p.x-q.x)||u.other.localeCompare(v.other)});
  const index=siblings.indexOf(a),port=ports[a.node]?.[a.key];
  const ratio=(index+1)/(siblings.length+1);
  a.point=horizontal?{x:n.x+(a.side==='right'?n.w:0),y:n.y+(port?.y??(40+(n.h-80)*ratio)),dir:a.side==='right'?1:-1}:{x:n.x+40+(n.w-80)*ratio,y:n.y+(a.side==='bottom'?n.h:0),dir:0};
  a.normal={x:a.side==='right'?1:a.side==='left'?-1:0,y:a.side==='bottom'?1:a.side==='top'?-1:0};
  // Keep the field anchor exact; separate connections just outside a shared key.
  const shared=mode==='er'&&port?siblings.filter(o=>o.key===a.key):[];
  a.fan=shared.length>1;
  const fanY=a.fan?(shared.indexOf(a)-(shared.length-1)/2)*44:0;
  a.exit={x:a.point.x+a.normal.x*(44+index*18),y:a.point.y+a.normal.y*(44+index*18)+fanY};
 }
 return ends;
}
function labelPositions(routes,nodes,edges){
 const placed=[],rects=Object.values(nodes).map(n=>inflate(n,12));
 // Reserve cardinality text beside field endpoints before placing relationship labels.
 for(const e of edges){if(!e.ca)continue;const r=routes[e.id];for(const [p,txt] of [[r.s,e.ca],[r.t,e.cb]]){const w=txt.length*9+8;placed.push({x:p.dir>0?p.x+8:p.x-w-8,y:p.y-27,w,h:22})}}
 const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
 const lines=Object.values(routes).map(r=>({id:r.id,points:sample(r.points,24)}));
 for(const e of [...edges].sort((a,b)=>(b.label||'').length-(a.label||'').length)){
  const r=routes[e.id],text=e.label||'',w=Math.max(60,text.length*12+24),h=26,ps=sample(r.points,26);
  const candidates=[];
  for(let i=2;i<ps.length-2;i++){
   const p=ps[i],before=ps[i-1],after=ps[i+1];
   for(const offset of [0,-30,30,-58,58,-90,90]){
    const x=p.x,y=p.y+offset,box={x:x-w/2-5,y:y-h/2-5,w:w+10,h:h+10};
    if(rects.some(n=>overlaps(box,n))||placed.some(n=>overlaps(box,n)))continue;
    let interference=0;for(const l of lines){if(l.id===e.id)continue;interference+=l.points.filter(q=>inside(q,box)).length}
    const slope=Math.abs(after.y-before.y)/(distance(before,after)||1);
    candidates.push({x,y,box,leader:offset?{x:p.x,y:p.y}:null,score:interference*200+Math.abs(offset)*.6+Math.abs(i/ps.length-.5)*50+slope*15});
   }
  }
  candidates.sort((a,b)=>a.score-b.score);let best=candidates[0];
  if(!best){const p=ps[Math.floor(ps.length/2)];let y=Math.min(...rects.map(n=>n.y))-60;let box={x:p.x-w/2-5,y:y-h/2-5,w:w+10,h:h+10};while(placed.some(n=>overlaps(box,n))){y-=44;box.y-=44}best={x:p.x,y,box,leader:p,score:0}}
  placed.push(best.box);r.mx=best.x;r.my=best.y;r.labelWidth=w;r.labelBox=best.box;r.leader=best.leader;
 }
}
function routeAll(nodes,edges,ports={},mode='er'){
 const ends=anchors(nodes,edges,ports,mode),reserve=reservations(),routes={};
 const bottom=Math.max(...Object.values(nodes).map(n=>n.y+n.h));
 const sorted=[...edges].sort((a,b)=>Number(ends[a.id].back)-Number(ends[b.id].back)||(b.strength||2)-(a.strength||2)||a.id.localeCompare(b.id));
 let backSlot=0;
 for(let index=0;index<sorted.length;index++){
  const e=sorted[index],anchor=ends[e.id],s=anchor.a.point,t=anchor.b.point,u=anchor.a.exit,v=anchor.b.exit,ns=anchor.a.normal,nt=anchor.b.normal,candidates=[];
  const add=ps=>{const sampled=sample(ps);
   // Facing ER ports should not create small loops or reverse the reading direction.
   const reverses=mode==='er'&&(t.x-s.x)*s.dir>0&&sampled.some((p,i)=>i&&(p.x-sampled[i-1].x)*s.dir<-.1);
   if(!reverses&&!blocked(ps,nodes,[e.a,e.b])&&!sampled.slice(2,-2).some(p=>inside(p,inflate(nodes[e.a],-2))||inside(p,inflate(nodes[e.b],-2))))candidates.push(ps);
  };
  if(anchor.back){const y=bottom+100+backSlot++*80;add(rounded([s,u,{x:u.x,y},{x:v.x,y},v,t],42))}
  else {
   const gap=distance(s,t);
   for(const factor of (anchor.a.fan||anchor.b.fan?[]:[.42,.25,.65]))add([s,{x:s.x+ns.x*Math.min(400,Math.max(60,gap*factor)),y:s.y+ns.y*Math.min(400,Math.max(60,gap*factor))},{x:t.x+nt.x*Math.min(400,Math.max(60,gap*factor)),y:t.y+nt.y*Math.min(400,Math.max(60,gap*factor))},t]);
   for(const shift of [0,-70,70,-140,140]){const x=(u.x+v.x)/2+shift;add(rounded([s,u,{x,y:u.y},{x,y:v.y},v,t]))}
   for(const y of [(u.y+v.y)/2,Math.min(u.y,v.y)-90-index%4*22,Math.max(u.y,v.y)+90+index%4*22])add(rounded([s,u,{x:u.x,y},{x:v.x,y},v,t]));
  }
  const score=ps=>{const samples=sample(ps);let n=(ps.length-4)*4+(mode==='er'?reserve.crossings(ps)*400:0);for(let i=1;i<samples.length;i++)n+=distance(samples[i-1],samples[i])*.08+reserve.cost(samples[i]);return n};
  let ranked=candidates.map(points=>({points,score:score(points)})).sort((a,b)=>a.score-b.score);
  if(!ranked.length||(!anchor.back&&ranked[0].score>distance(s,t)*.08+90)){
   const path=detour(u,v,nodes,reserve,14+index%5*16);
   if(path){const points=rounded([s,...path,t]);add(points);ranked=candidates.map(points=>({points,score:score(points)})).sort((a,b)=>a.score-b.score)}
  }
  // Overlapping manually placed cards may leave no clear route. Keep endpoints
  // attached and operable; layout reset remains available in the UI.
  const points=ranked[0]?.points||rounded([s,u,v,t]);
  routes[e.id]={id:e.id,points,s,t,path:toPath(points),back:anchor.back,clear:!!ranked.length};reserve.add(points);
 }
 labelPositions(routes,nodes,edges);return routes;
}
return{routeAll,blocked,sample,toPath,rounded,segmentHits};
});
