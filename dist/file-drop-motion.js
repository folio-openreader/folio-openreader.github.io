// Motion parameters measured from DesignBookmark File Drop's actual drop.js.
// This implementation is local-input only: no autoplay, uploads or mock progress.
export const fileDropSprings=Object.freeze({
  zone:[380,16], hover:[300,26], core:[420,14], arrow:[420,30],
  ring:[300,30], fill:[260,21], check:[200,26], line:[360,30],
  chipFollow:[90,15], chipNear:[150,18], chipLand:[520,36], chipScale:[520,34], chipFade:[500,40],
});
const nearer=(a,b)=>Math.abs(a-b)<.0009;
function spring(value,key){const [k,d]=fileDropSprings[key];return {x:value,v:0,t:value,k,d}}
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
function integrate(s,dt){
  // Semi-implicit Euler with short substeps keeps all source stiffness values stable at low frame rates.
  const steps=Math.max(1,Math.ceil(dt/.006));
  for(let i=0;i<steps;i++){const h=dt/steps;s.v+=((s.t-s.x)*s.k-s.v*s.d)*h;s.x+=s.v*h}
  if(nearer(s.x,s.t)&&Math.abs(s.v)<.02){s.x=s.t;s.v=0}
}
export function bookFileError(file){
  if(!file)return '';
  const suffix=file.name.match(/\.(epub|pdf|txt|png|jpe?g)$/i)?.[1]?.toLowerCase();
  if(!suffix)return 'Выберите EPUB, PDF, TXT, PNG или JPEG.';
  const limit=suffix==='txt'?3:['png','jpg','jpeg'].includes(suffix)?16:24;
  if(file.size>limit*1024*1024)return `${suffix.toUpperCase()}: максимум ${limit} МБ.`;
  if(!file.size)return 'Файл пуст.';
  return '';
}
export function installDropMotion(label){
  const core=label.querySelector('.drop-core'),chip=label.querySelector('.drop-chip'),arrow=label.querySelector('.drop-arrow'),
    ring=label.querySelector('.drop-ring'),fill=label.querySelector('.drop-fill'),check=label.querySelector('.drop-check'),
    path=check.querySelector('path'),name=label.querySelector('.file-copy span'),reduce=matchMedia('(prefers-reduced-motion: reduce)');
  const s={Z:spring(1,'zone'),H:spring(0,'hover'),C:spring(1,'core'),U:spring(1,'arrow'),R:spring(0,'ring'),
    F:spring(0,'fill'),K:spring(0,'check'),N:spring(1,'line'),X:spring(0,'chipFollow'),Y:spring(0,'chipFollow'),
    S:spring(1,'chipScale'),O:spring(0,'chipFade')};
  let phase='idle',hover=false,dragging=false,raf=0,prev=0,clock=0,oldLine=null,dropSettling=false;
  function tune(item,key){[item.k,item.d]=fileDropSprings[key]}
  function paint(){
    label.style.transform=`scale(${(s.Z.x*(1+.025*s.H.x)).toFixed(4)})`;
    label.style.setProperty('--drop-lift',clamp(s.H.x).toFixed(3));
    core.style.transform=`translateY(${(-5*s.H.x).toFixed(2)}px) scale(${s.C.x.toFixed(4)})`;
    arrow.style.opacity=clamp(s.U.x).toFixed(3);
    arrow.style.transform=`translateY(${((-3.5*clamp(s.H.x)*(.5+.5*Math.sin(clock*7)))+(1-s.U.x)*-12).toFixed(2)}px) scale(${(.6+.4*s.U.x).toFixed(3)})`;
    ring.style.opacity=clamp(s.R.x).toFixed(3);fill.style.transform=`scale(${Math.max(0,s.F.x).toFixed(3)})`;
    check.style.opacity=clamp(s.K.x*4).toFixed(3);path.style.strokeDashoffset=(24*(1-clamp(s.K.x))).toFixed(2);
    const n=clamp(s.N.x);
    name.style.opacity=clamp((n-.35)/.65).toFixed(3);name.style.transform=`translateY(${((1-s.N.x)*16).toFixed(2)}px)`;
    if(oldLine){if(n>.985){oldLine.remove();oldLine=null}else{oldLine.style.opacity=clamp(1-n*1.8).toFixed(3);oldLine.style.transform=`translateY(${(-s.N.x*16).toFixed(2)}px)`}}
    chip.style.opacity=clamp(s.O.x).toFixed(3);
    chip.style.transform=`translate(${s.X.x.toFixed(1)}px,${s.Y.x.toFixed(1)}px) translate(-50%,-50%) rotate(${clamp(s.X.v*.04,-16,16).toFixed(2)}deg) scale(${Math.max(0,s.S.x).toFixed(3)})`;
  }
  function frame(now){
    raf=0;const dt=prev?Math.min(.035,(now-prev)/1000):1/60;prev=now;clock+=dt;
    for(const spring of Object.values(s))integrate(spring,dt);
    if(dropSettling&&s.S.x<.30){dropSettling=false;s.O.t=0}
    paint();
    if(hover||Object.values(s).some(a=>a.x!==a.t||a.v!==0))raf=requestAnimationFrame(frame);else prev=0;
  }
  function animate(){
    if(reduce.matches){if(raf)cancelAnimationFrame(raf);raf=0;prev=0;
      dropSettling=false;s.O.t=0;
      for(const a of Object.values(s)){a.x=a.t;a.v=0}
      clock=0;paint();return}
    if(!raf)raf=requestAnimationFrame(frame);
  }
  const setText=(text,roll=true)=>{
    if(name.textContent===text)return;
    if(oldLine)oldLine.remove();
    if(roll&&!reduce.matches){
      oldLine=document.createElement('span');oldLine.textContent=name.textContent;oldLine.className='drop-old-line';oldLine.setAttribute('aria-hidden','true');name.after(oldLine);
      s.N.x=0;s.N.v=0;
    }else{oldLine=null;s.N.x=1;s.N.v=0}
    name.textContent=text;s.N.t=1;
    animate();
  };
  const state=(next)=>{
    phase=next;label.dataset.dropPhase=next;
    const complete=next==='selected'||next==='ready';
    s.H.t=next==='idle'&&hover?1:0;
    s.U.t=complete||next==='reading'?0:1;
    s.R.t=next==='reading'?1:0;s.F.t=complete?1:0;s.K.t=complete?1:0;
    if(next==='reading'){s.C.x=1.2;s.Z.x=.965}
    if(next==='ready'){s.C.x=.84}
    if(next==='rejected'){s.Z.x=.975}
    animate();
  };
  function leave(){
    hover=false;dragging=false;dropSettling=false;s.H.t=0;s.O.t=0;
    label.removeAttribute('data-dragging');animate();
  }
  function drag(event){
    if(!hover){hover=true;label.setAttribute('data-dragging','')}
    s.H.t=1;
    const rect=label.getBoundingClientRect(),c=core.getBoundingClientRect();
    const x=clamp(event.clientX-rect.left,22,Math.max(24,rect.width-22)),y=clamp(event.clientY-rect.top,18,Math.max(20,rect.height-18));
    const dist=Math.hypot(event.clientX-c.x-c.width/2,event.clientY-c.y-c.height/2);
    if(!dragging){dragging=true;dropSettling=false;s.S.x=s.S.t=1;s.O.t=1;s.X.x=x;s.Y.x=y;s.X.v=s.Y.v=0;chip.textContent='Файл'}
    tune(s.X,dist<90?'chipNear':'chipFollow');tune(s.Y,dist<90?'chipNear':'chipFollow');s.X.t=x;s.Y.t=y;
    animate();
  }
  function land(file,dropped){
    if(dropped&&dragging&&!reduce.matches){
      const rect=label.getBoundingClientRect(),c=core.getBoundingClientRect();
      tune(s.X,'chipLand');tune(s.Y,'chipLand');s.X.t=c.x+c.width/2-rect.left;s.Y.t=c.y+c.height/2-rect.top;
      s.S.t=0;s.O.t=1;chip.textContent=file.name.length>22?file.name.slice(0,19)+'…':file.name;dropSettling=true;
      dragging=false;hover=false;s.H.t=0;label.removeAttribute('data-dragging');
    }else leave();
    s.C.x=1.2;s.Z.x=.965;state('selected');
  }
  return {
    drag,leave,land,state,setText,
    press(){s.Z.x=.975;animate()},
    reset(){leave();state('idle')},
    settle(){if(raf)cancelAnimationFrame(raf);raf=0;prev=0;hover=false;dragging=false;dropSettling=false;s.H.t=0;s.O.t=0;label.removeAttribute('data-dragging');for(const a of Object.values(s)){a.x=a.t;a.v=0}paint()},
    get phase(){return phase},
  };
}
