export const clamp = (v,min=0,max=100)=>Math.max(min,Math.min(max,v));
export function eyeRatio(p,ids,w,h){const d=(a,b)=>Math.hypot((p[a].x-p[b].x)*w,(p[a].y-p[b].y)*h);return (d(ids[1],ids[5])+d(ids[2],ids[4]))/(2*Math.max(d(ids[0],ids[3]),.001));}
export function measure(p,f,w,h,baseline){const l=p[11],r=p[12],nose=p[0];const shoulderWidth=Math.hypot((l.x-r.x)*w,(l.y-r.y)*h);const height=((l.y+r.y)/2-nose.y)*h/Math.max(shoulderWidth,1);const tilt=Math.atan2(Math.abs((l.y-r.y)*h),Math.abs((l.x-r.x)*w))*180/Math.PI;const shift=postureDeviation('front',height,baseline);const ear=f?(eyeRatio(f,[33,160,158,133,153,144],w,h)+eyeRatio(f,[362,385,387,263,373,380],w,h))/2:null;return {height,tilt,shift,ear};}
export function pulse(m){if(m.shift==null||m.ear==null)return null;const posture=clamp(100-m.shift*2.2-m.tilt*2);const eyes=clamp((m.ear-.1)/.15*100);return Math.round(posture*.75+eyes*.25);}

// Posture-only estimate; eye closure must not trigger a posture warning.
export function postureScore(m) {
  if (!m || !Number.isFinite(m.shift) || !Number.isFinite(m.tilt)) return null;
  return Math.round(clamp(100 - m.shift * 2.2 - m.tilt * 2));
}
export function createPostureWarning() {
  let poorSince = null, recoveredSince = null, missingSince = null, active = false;
  return {
    reset() { poorSince = recoveredSince = missingSince = null; active = false; },
    update(m, now, score = postureScore(m)) {
      if (score === null) {
        missingSince ??= now;
        if(now-missingSince>700)this.reset();
        return {active:false,score:null};
      }
      if(missingSince!==null){
        const gap=now-missingSince;
        if(gap>700)this.reset();
        else {if(poorSince!==null)poorSince+=gap;if(recoveredSince!==null)recoveredSince+=gap;}
        missingSince=null;
      }
      if (!active) {
        if (score < 55) {
          poorSince ??= now;
          if (now - poorSince >= 2000) { active = true; recoveredSince = null; }
        } else poorSince = null;
      } else if (score >= 70) {
        recoveredSince ??= now;
        if (now - recoveredSince >= 1000) this.reset();
      } else recoveredSince = null;
      return {active, score};
    }
  };
}

export function viewMeasurement(p,f,w,h,world=null,previousView=null) {
 const visible=i=>p[i]&&(p[i].visibility??0)>=.75;
 const width=Math.abs(p[11].x-p[12].x)*w;
 const torso=visible(23)&&visible(24)?Math.abs((p[23].y+p[24].y-p[11].y-p[12].y)/2)*h:0;
 const shoulder3D=world?.[11]&&world?.[12]?{
  x:world[11].x-world[12].x,z:world[11].z-world[12].z}:null;
 const yaw=shoulder3D?Math.abs(shoulder3D.z)/Math.max(.001,Math.hypot(shoulder3D.x,shoulder3D.z)):null;
 const noseOffset=Math.abs(p[0].x-(p[11].x+p[12].x)/2)*w/Math.max(width,1);
 const side=yaw!=null?yaw>(previousView==='side'?.5:.7):width<Math.max(torso*.65,60)||(visible(0)&&noseOffset>.65);

 if(side){
  const pairs=[[7,11],[8,12]].filter(([e,s])=>visible(e)&&visible(s));
  if(!pairs.length)return null;
  pairs.sort((a,b)=>Math.min(p[b[0]].visibility,p[b[1]].visibility)-Math.min(p[a[0]].visibility,p[a[1]].visibility));
  const [e,s]=pairs[0];
  const angle=Math.atan2(Math.abs(p[e].x-p[s].x)*w,Math.max(1,(p[s].y-p[e].y)*h))*180/Math.PI;
  return {view:'side',height:angle/100,tilt:0,ear:profileEyeRatio(f,w,h)};
 }
 if(!visible(11)||!visible(12))return null;
 if(!visible(0))return {view:'shoulders',height:0,tilt:Math.atan2(Math.abs(p[11].y-p[12].y)*h,Math.max(1,width))*180/Math.PI,ear:null};
 return {...measure(p,f,w,h,null),view:'front'};
}

// Visual continuity only: cached points never feed posture measurements.
export function createOverlayTracker(holdMs=450) {
 let points=[];
 return {
  reset(){points=[];},
  update(incoming,now){
   const count=Math.max(points.length,incoming?.length??0);
   for(let i=0;i<count;i++){
    const p=incoming?.[i],old=points[i];
    if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility??1)>=.4){
     const a=old&&now-old.time<holdMs?1-Math.exp(-Math.max(1,now-old.time)/90):1;
     points[i]={...p,x:old?old.x+a*(p.x-old.x):p.x,y:old?old.y+a*(p.y-old.y):p.y,time:now};
    }
   }
   return points.map(p=>p&&now-p.time<=holdMs?{...p,held:now>p.time}:null);
  }
 };
}

// Front: slouching reduces vertical head-to-shoulder separation.
// Side: forward head displacement increases ear-to-shoulder inclination.
// Moving in the opposite direction must not lower the posture score.
export function postureDeviation(view,current,baseline) {
 if(!Number.isFinite(current)||!Number.isFinite(baseline))return null;
 if(view==='shoulders')return 0;
 return Math.max(0,view==='side'?current-baseline:baseline-current)*100;
}

// In profile, use the better-resolved eye rather than averaging an occluded eye.
export function profileEyeRatio(face,w,h) {
 if(!face)return null;
 const eyes=[[33,160,158,133,153,144],[362,385,387,263,373,380]];
 const candidates=eyes.filter(ids=>ids.every(i=>face[i]&&Number.isFinite(face[i].x)&&Number.isFinite(face[i].y)))
 .map(ids=>({ids,width:Math.hypot((face[ids[0]].x-face[ids[3]].x)*w,(face[ids[0]].y-face[ids[3]].y)*h)}))
 .filter(e=>e.width>=10).sort((a,b)=>b.width-a.width);
 if(!candidates.length)return null;
 const ratio=eyeRatio(face,candidates[0].ids,w,h);
 return Number.isFinite(ratio)&&ratio>=0&&ratio<=.65?ratio:null;
}
