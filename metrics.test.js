import test from 'node:test';import assert from 'node:assert/strict';import {pulse,measure,eyeRatio} from './metrics.js';
test('score requires calibrated posture and face; bounded values',()=>{assert.equal(pulse({shift:null,ear:.3,tilt:0}),null);assert.equal(pulse({shift:0,ear:null,tilt:0}),null);assert.equal(pulse({shift:0,ear:.3,tilt:0}),100);assert.equal(pulse({shift:100,ear:.05,tilt:90}),0);assert.ok(pulse({shift:25,ear:.3,tilt:8})<pulse({shift:0,ear:.3,tilt:0}));});
test('shoulder tilt uses pixel aspect ratio and baseline shift is scale invariant',()=>{let p=Array.from({length:25},()=>({x:.5,y:.3}));p[11]={x:.3,y:.6};p[12]={x:.7,y:.6};const m=measure(p,null,1000,500,null);assert.equal(m.tilt,0);assert.ok(Math.abs(m.height-.375)<1e-10);assert.equal(m.shift,null);assert.ok(measure(p,null,2000,1000,.375).shift<1e-10);p[12].y=.8;assert.ok(Math.abs(measure(p,null,1000,500,0).tilt-14.036)<.01);});
test('eye ratio responds to closed eyes',()=>{const p=[{x:0,y:0},{x:.2,y:.1},{x:.8,y:.1},{x:1,y:0},{x:.8,y:-.1},{x:.2,y:-.1}];assert.equal(eyeRatio(p,[0,1,2,3,4,5],100,100),.2);p.forEach(v=>v.y=0);assert.equal(eyeRatio(p,[0,1,2,3,4,5],100,100),0);});

import {postureScore,createPostureWarning} from './metrics.js';
test('posture alerts need sustained poor alignment, then sustained recovery',()=>{
 const alert=createPostureWarning(), poor={shift:25,tilt:9,ear:.3},good={shift:3,tilt:2,ear:.3};
 assert.equal(postureScore(poor),27);
 assert.equal(alert.update(poor,0).active,false);
 assert.equal(alert.update(poor,1999).active,false);
 assert.equal(alert.update(poor,2000).active,true);
 assert.equal(alert.update(good,2100).active,true);
 assert.equal(alert.update(good,3100).active,false);
});
test('brief movement and eye closure do not trigger posture warnings',()=>{
 const a=createPostureWarning(),poor={shift:25,tilt:9},good={shift:3,tilt:2,ear:.09};
 a.update(poor,0);assert.equal(a.update(good,1500).active,false);
 assert.equal(a.update(poor,2000).active,false);
 assert.equal(a.update(poor,3999).active,false);
 assert.equal(postureScore(good),89);
});
test('lost tracking or reset clears warnings and restarts the delay',()=>{
 const a=createPostureWarning(),poor={shift:25,tilt:9};a.update(poor,0);a.update(poor,2000);
 assert.deepEqual(a.update(null,2100),{active:false,score:null});
 assert.equal(a.update(poor,5000).active,false);a.update(poor,7000);a.reset();
 assert.equal(a.update(poor,8000).active,false);
 assert.equal(postureScore({shift:null,tilt:0}),null);
});
import {viewMeasurement} from './metrics.js';
test('profile tracks visible ear and shoulder; rear view limits measurements to shoulders',()=>{
 const p=Array.from({length:33},()=>({x:.5,y:.3,visibility:1}));
 p[11]={x:.45,y:.6,visibility:1};p[12]={x:.55,y:.6,visibility:1};p[23].y=p[24].y=.95;
 assert.equal(viewMeasurement(p,null,1000,700).view,'side');
 p[11].x=.2;p[12].x=.8;p[0].visibility=0;
 const rear=viewMeasurement(p,null,1000,700);assert.equal(rear.view,'shoulders');assert.equal(rear.ear,null);
 p[11].visibility=p[12].visibility=0;assert.equal(viewMeasurement(p,null,1000,700),null);
});
test('warning reuses the supplied displayed score including unavailable calibration',()=>{
 const a=createPostureWarning(),m={shift:25,tilt:9};
 for(const now of [0,1000,2000])assert.equal(a.update(m,now,27).score,27);
 assert.equal(a.update(m,2100,null).active,false);
 assert.equal(a.update(m,2200,80).score,80);
});
test('uncertain shoulders cannot produce a front or rear score',()=>{
 const p=Array.from({length:33},()=>({x:.5,y:.3,visibility:1}));
 p[11]={x:.2,y:.6,visibility:.65};p[12]={x:.8,y:.6,visibility:.65};
 assert.equal(viewMeasurement(p,null,1000,700),null);
});
import {createOverlayTracker} from './metrics.js';
test('overlay bridges a brief dropout but expires missing landmarks',()=>{
 const t=createOverlayTracker();t.update([{x:.2,y:.3,visibility:1}],0);
 assert.equal(t.update(null,200)[0].held,true);
 assert.equal(t.update(null,451)[0],null);
 assert.equal(t.update([{x:.8,y:.3,visibility:1}],500)[0].x,.8);
 t.reset();assert.deepEqual(t.update(null,600),[]);
});
test('3D shoulder rotation identifies side view without hips; missing face mesh keeps front scoring',()=>{
 const p=Array.from({length:33},()=>({x:.5,y:.3,visibility:1}));
 p[11]={x:.4,y:.6,visibility:1};p[12]={x:.6,y:.6,visibility:1};p[23].visibility=p[24].visibility=0;
 const world=Array.from({length:33},()=>({x:0,y:0,z:0}));world[11]={x:.03,z:.2};world[12]={x:-.03,z:-.2};
 assert.equal(viewMeasurement(p,null,1000,700,world).view,'side');
 world[11]={x:.2,z:.01};world[12]={x:-.2,z:-.01};
 assert.equal(viewMeasurement(p,null,1000,700,world).view,'front');
});
test('brief profile tracking gaps pause the alert delay instead of restarting it',()=>{
 const a=createPostureWarning(),side={shift:30,tilt:0};
 a.update(side,0);a.update(side,1500);
 assert.equal(a.update(null,1600).active,false);
 assert.equal(a.update(side,1800).active,false);
 assert.equal(a.update(side,2199).active,false);
 assert.equal(a.update(side,2200).active,true);
});
import {postureDeviation} from './metrics.js';
test('front score rewards straightening and penalizes head drop, not distance in either direction',()=>{
 const baseline=.45;
 const upright=postureScore({shift:postureDeviation('front',.55,baseline),tilt:0});
 const neutral=postureScore({shift:postureDeviation('front',.45,baseline),tilt:0});
 const slouched=postureScore({shift:postureDeviation('front',.2,baseline),tilt:0});
 assert.equal(upright,100);assert.equal(neutral,100);assert.equal(slouched,45);
});
test('side correction does not incur the old absolute deviation penalty',()=>{
 assert.equal(postureDeviation('side',.1,.2),0);
 assert.ok(Math.abs(postureDeviation('side',.4,.2)-20)<1e-9);
 assert.equal(postureDeviation('front',.4,null),null);
});
import {profileEyeRatio} from './metrics.js';
test('profile eye estimate uses resolved eye and rejects missing or too-small contours',()=>{
 const f=Array.from({length:468},()=>({x:.5,y:.5}));
 const ids=[33,160,158,133,153,144];const pts=[[.4,.5],[.42,.51],[.48,.51],[.5,.5],[.48,.49],[.42,.49]];
 ids.forEach((id,i)=>f[id]={x:pts[i][0],y:pts[i][1]});
 assert.ok(Math.abs(profileEyeRatio(f,1000,1000)-.2)<1e-9);
 assert.equal(profileEyeRatio(null,1000,1000),null);
 assert.equal(profileEyeRatio(f,50,50),null);
});
