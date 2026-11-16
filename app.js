import {measure,pulse,clamp,createPostureWarning,viewMeasurement,postureScore,createOverlayTracker,postureDeviation} from './metrics.js?v=profile-eyes-1';
const $=id=>document.getElementById(id),canvas=$('skeleton'),ctx=canvas.getContext('2d'),video=$('video');
let mode='demo',scene='optimal',paused=false,stream=null,pose=null,face=null,baseline=null,calibration=null,metrics=null,score=94,history=[],seconds=0,blinkTimes=[],eyesClosedAt=null,lastFrame=-1,lastInference=0,raf=0,generation=0,resetTimer=null,resetRemaining=0,loading=false,frames=0,fpsAt=performance.now();
let viewBaselines = {};
let smoothedPosture = null, activeView = null, pendingView = null, pendingViewSince = 0;
let audioContext = null, soundEnabled = true, lastBeep = -Infinity;
function enableAudio(){
 try { audioContext ??= new (window.AudioContext||window.webkitAudioContext)(); audioContext.resume().catch(()=>{}); } catch {} 
}
function warningBeep(){
 if(!soundEnabled||!audioContext||audioContext.state!=='running'||performance.now()-lastBeep<1000)return;
 lastBeep=performance.now();
 const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;
 oscillator.frequency.value=660;gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.12,now+.03);gain.gain.exponentialRampToValueAtTime(.001,now+.3);
 oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(now);oscillator.stop(now+.32);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
}
$('test-alert').onclick=async()=>{soundEnabled=true;enableAudio();try{await audioContext?.resume();}catch{}lastBeep=-Infinity;warningBeep();$('sound').textContent='Sound: on';$('sound').setAttribute('aria-pressed','true');showModal('<div class="eyebrow">ALERT TEST</div><h2>This is a test notification.</h2><p>You should hear a short beep. Live posture warnings use this sound every second while your tracked score stays in the red zone.</p>');};
$('sound').onclick=()=>{soundEnabled=!soundEnabled;if(soundEnabled)enableAudio();$('sound').textContent=soundEnabled?'Sound: on':'Sound: off';$('sound').setAttribute('aria-pressed',String(soundEnabled));};

const overlayTracker=createOverlayTracker();
function renderLiveOverlay(p,t){
 const points=overlayTracker.update(p,t);
 ctx.globalAlpha=p?1:.45;
 drawSkeleton(points.map(v=>v?{...v,x:1-v.x}:null));
 ctx.globalAlpha=1;
}
function postureTips(){
 if(activeView==='shoulders'&&mode==='live')return ['Let both shoulders relax to a similar height.','Rest both forearms comfortably on the desk.','Keep your feet supported; avoid leaning to one side.'];
 if(metrics?.tilt>6)return ['Relax the raised shoulder without forcing it down.','Support both forearms evenly.','Center your chair and screen in front of you.'];
 return ['Bring your head gently back over your shoulders.','Sit back with your lower back supported and feet resting comfortably.','Bring the screen closer or raise it so you do not need to lean forward.'];
}
function showPostureTips(){showModal('<div class="eyebrow">A COMFORTABLE RESET</div><h2>Try these small adjustments.</h2><ol>'+postureTips().map(t=>'<li>'+t+'</li>').join('')+'</ol><p>Move gently. Do not force a position or continue a movement that hurts.</p>');}

const postureWarning = createPostureWarning();
function clearPostureWarning() {
  postureWarning.reset();
  $('posture-warning').hidden = true;
  $('warning-title').textContent = '';
}
function updatePostureWarning(m, sharedScore) {
  if (paused || calibration || loading) { clearPostureWarning(); return; }
  const warning = postureWarning.update(m, performance.now(), sharedScore);
  const wasHidden = $('posture-warning').hidden;
  $('posture-warning').hidden = !warning.active;
  if (!warning.active) {
    if (!wasHidden) $('warning-title').textContent = '';
    return;
  }
  if(sharedScore<55)warningBeep();$('warning-score').textContent = warning.score;const tips=postureTips().map(t=>'<li>'+t+'</li>').join('');if($('warning-tips').innerHTML!==tips)$('warning-tips').innerHTML=tips;
  $('warning-mode').textContent = mode === 'demo' ? 'SIMULATED POSTURE · DEMO' : activeView==='side'?'SIDE VIEW · POSTURE WARNING':'LIVE POSTURE WARNING';
  if (wasHidden) $('warning-title').textContent = activeView==='shoulders'&&mode==='live'?'Shoulders look uneven. Gently level them.':'Posture needs a reset. Sit upright.';
}
const scenes={optimal:{shift:3,tilt:2,ear:.31},slouching:{shift:25,tilt:9,ear:.28},fatigued:{shift:6,tilt:3,ear:.09}};
function status(t){$('status').textContent=t;}
function showModal(html){$('modal-body').innerHTML=html;if(!$('modal').open)$('modal').showModal();}
function closeModal(){ $('modal').close();clearInterval(resetTimer);resetTimer=null; }
$('close-modal').onclick=closeModal;$('modal').addEventListener('cancel',()=>{clearInterval(resetTimer);resetTimer=null;});
function paintMetrics(m){metrics=m;score=calibration?null:postureScore(m);updatePostureWarning(m,score);const accent=score==null?'#91a099':score>=75?'#b4e7c9':score>=55?'#e8cb8b':'#f09aa4';$('ring').style.setProperty('--value',score??0);$('ring').style.setProperty('--accent',accent);$('score').textContent=score??'—';$('score-caption').textContent=score==null?(calibration?'Calibrating…':mode==='live'&&baseline==null?'Calibrate to get your score':'Keep your face visible'):score>=75?'Looking balanced':score>=55?'A little room to reset':'Time for a gentle reset';$('score-caption').style.color=accent;
$('neck').innerHTML=m?.shift!=null?(activeView==='shoulders'&&mode==='live'?'—':`${Math.round(m.shift)}<span>${activeView==='side'&&mode==='live'?'°':'%'}</span>`):'—';$('shoulder').innerHTML=m&&!(activeView==='side'&&mode==='live')?`${Math.round(m.tilt)}<span>°</span>`:'—';$('eye').innerHTML=m?.ear!=null?`${m.ear.toFixed(2)}<span> EAR</span>`:'—';$('neck-tag').textContent=m?.shift==null?'Calibrate first':m.shift<12?'Balanced':'Shift detected';$('shoulder-tag').textContent=activeView==='side'&&mode==='live'?'Unavailable':!m?'No tracking':m.tilt<6?'Level':'Uneven';$('shoulder-note').textContent=activeView==='side'&&mode==='live'?'Turn toward the camera to show both shoulders':'Estimated angle in the camera plane';$('eye-note').textContent=activeView==='side'&&mode==='live'?(m?.ear!=null?'Visible-eye estimate · profile may reduce accuracy':'Eye obscured or too narrow to measure'):'Eye aspect ratio · not fatigue detection';$('eye-tag').textContent=m?.ear==null?'Unavailable':m.ear<.18?'Closed / narrowed':'Open';$('neck-meter').style.width=`${clamp((m?.shift??0)*3)}%`;$('shoulder-meter').style.width=`${clamp((m?.tilt??0)*5)}%`;$('eye-meter').style.width=`${clamp((m?.ear??0)*280)}%`;
$('alignment').textContent=!m?'Position face & shoulders in frame':m.shift==null?'Sit comfortably, then calibrate':score>=75?'Aligned & feeling good':m.ear!=null&&m.ear<.18?'Eyes closed / narrowed':'Let’s find your balance';$('alignment').style.color=accent;
}
function drawSkeleton(points,simulated=false){ctx.clearRect(0,0,canvas.width,canvas.height);if(!points)return;const w=canvas.width,h=canvas.height;const color=score==null||score>=75?'#b4e7c9':score>=55?'#e8cb8b':'#f09aa4';const xy=p=>[p.x*w,p.y*h];if(simulated){const head=points[0];ctx.fillStyle='#58746425';ctx.strokeStyle='#b4e7c91a';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(head.x*w,head.y*h-15,76,98,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(points[11].x*w-40,points[11].y*h);ctx.quadraticCurveTo(w*.5,h*.36,points[12].x*w+40,points[12].y*h);ctx.lineTo(w*.8,h);ctx.lineTo(w*.2,h);ctx.closePath();ctx.fill();ctx.stroke();}
ctx.strokeStyle=color;ctx.lineWidth=2;ctx.shadowColor=color;ctx.shadowBlur=12;for(const [a,b] of [[7,8],[7,11],[8,12],[11,12],[11,13],[12,14],[13,15],[14,16],[15,17],[15,19],[15,21],[17,19],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[29,31],[27,31],[28,30],[30,32],[28,32],[0,7],[0,8]]){if(!points[a]||!points[b])continue;ctx.beginPath();ctx.moveTo(...xy(points[a]));ctx.lineTo(...xy(points[b]));ctx.stroke();}for(const i of [0,2,5,7,8,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]){if(!points[i])continue;const [x,y]=xy(points[i]);ctx.beginPath();ctx.arc(x,y,i===11||i===12?6:4,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#ffffff35';ctx.beginPath();ctx.arc(x,y,11,0,Math.PI*2);ctx.stroke();ctx.strokeStyle=color;}ctx.shadowBlur=0;
if(!simulated&&[11,12,23,24].every(i=>points[i])){
 const top={x:(points[11].x+points[12].x)/2,y:(points[11].y+points[12].y)/2};
 const bottom={x:(points[23].x+points[24].x)/2,y:(points[23].y+points[24].y)/2};
 ctx.strokeStyle=color;ctx.globalAlpha=.35;ctx.lineWidth=1;
 ctx.beginPath();ctx.moveTo(...xy(top));ctx.lineTo(...xy(bottom));ctx.stroke();
 for(const amount of [.25,.5,.75]){
  const left={x:points[11].x+(points[23].x-points[11].x)*amount,y:points[11].y+(points[23].y-points[11].y)*amount};
  const right={x:points[12].x+(points[24].x-points[12].x)*amount,y:points[12].y+(points[24].y-points[12].y)*amount};
  ctx.beginPath();ctx.moveTo(...xy(left));ctx.lineTo(...xy(right));ctx.stroke();
 }ctx.globalAlpha=1;
}
if(simulated){ctx.fillStyle='#a6c3af';ctx.font='10px monospace';ctx.fillText('SHOULDER LINE',w*.69,h*.53);ctx.fillText('HEAD POSITION',w*.62,h*.26);}}
function demoPoints(t){const bob=Math.sin(t/1500)*.004,sl=scene==='slouching'?.09:0;const p=Array.from({length:25},()=>({x:.5,y:.5}));p[0]={x:.5+sl*.4,y:.32+bob+sl};p[2]={x:.47+sl*.4,y:.285+bob+sl};p[5]={x:.53+sl*.4,y:.285+bob+sl};p[7]={x:.42+sl*.4,y:.32+bob+sl};p[8]={x:.58+sl*.4,y:.32+bob+sl};p[11]={x:.29,y:.56+bob+sl*.4};p[12]={x:.71,y:.56+bob-sl*.2};p[13]={x:.23,y:.91};p[14]={x:.77,y:.91};p[23]={x:.37,y:.94};p[24]={x:.63,y:.94};return p;}
function tick(t){raf=requestAnimationFrame(tick);
if(calibration&&t-calibration.start>8000){calibration=null;baseline=null;$('calibrate').disabled=false;status('Calibration timed out: improve lighting and keep your upper body in frame, then try again.');}
if(!calibration)$('calibrate').textContent='⌖ Calibrate posture';
if(paused)return;if(mode==='demo'){const m={...scenes[scene]};m.tilt+=Math.sin(t/2000)*.2;paintMetrics(m);drawSkeleton(demoPoints(t),true);return;}if(!pose||!face||video.readyState<2||video.currentTime===lastFrame||t-lastInference<66)return;lastFrame=video.currentTime;lastInference=t;
try{const poseResult=pose.detectForVideo(video,t);const p=poseResult.landmarks[0],f=face.detectForVideo(video,t).faceLandmarks[0];frames++;if(t-fpsAt>1000){$('fps').textContent=`${Math.round(frames*1000/(t-fpsAt))} INFERENCES / SEC`;fpsAt=t;frames=0;}const observed=p?viewMeasurement(p,f,video.videoWidth,video.videoHeight,poseResult.worldLandmarks?.[0],activeView):null;if(!observed){eyesClosedAt=null;smoothedPosture=null;paintMetrics(null);renderLiveOverlay(p,t);if(calibration){calibration.missingSince??=t;status('Brief tracking gap — keep your upper body visible.');if(t-calibration.missingSince>1200){calibration=null;status('Tracking lost for over a second. Adjust lighting or framing, then calibrate again.');$('calibrate').disabled=false;}}return;}
const m=observed;
if(m.view!==activeView){
 activeView=m.view;
 baseline=viewBaselines[activeView]??(activeView==='side'?.15:activeView==='shoulders'?0:null);
 calibration=null;smoothedPosture=null;$('calibrate').disabled=false;
 status(viewBaselines[activeView]!=null?'Saved '+activeView+' calibration restored.':activeView==='side'?'Side reference estimate active. Calibrate this angle for a personal baseline.':activeView==='shoulders'?'Shoulder-only estimate. Head and neck are not visible.':'Face forward and calibrate once to personalize your score.');
}
document.querySelector('.score-card p').textContent=activeView==='side'&&viewBaselines.side==null?'Side reference estimate · calibrate to personalize.':'Same posture score as the warning, updated on every tracked frame.';document.querySelector('.score-key').textContent='75–100 balanced · 55–74 adjust · 0–54 red';$('view-status').textContent=activeView==='front'?'Front view · head + shoulders':activeView==='side'?'Side view · ear-to-shoulder angle':'Shoulders only · head/neck unavailable';
$('head-label').textContent=activeView==='side'?'Head angle change':activeView==='shoulders'?'Head position unavailable':'Head drop from upright';
$('head-note').textContent=activeView==='side'?(viewBaselines.side!=null?'Degrees from your calibrated side view':'Degrees beyond a generic 15° reference'):activeView==='shoulders'?'Face not visible · shoulder coaching only':'Downward change from your upright calibration';

// Smooth posture landmarks only; keep eye measurements responsive for blinks.
if (!smoothedPosture) smoothedPosture = {height:m.height,tilt:m.tilt,time:t};
else {
 const alpha=1-Math.exp(-Math.min(t-smoothedPosture.time,250)/350);smoothedPosture.time=t;
 smoothedPosture.height += alpha * (m.height-smoothedPosture.height);
 smoothedPosture.tilt += alpha * (m.tilt-smoothedPosture.tilt);
}
m.height=smoothedPosture.height;
m.tilt=smoothedPosture.tilt;
m.shift=postureDeviation(activeView,m.height,baseline);
if(calibration){
 calibration.missingSince=null;
 calibration.samples.push(m.height);
 const elapsed=t-calibration.start;
 const progress=Math.min(100,Math.floor(Math.min(elapsed/3000,calibration.samples.length/15)*100));
 $('calibrate').textContent=`Calibrating… ${progress}%`;
 status(`Hold upright, looking straight ahead… ${Math.max(0,Math.ceil((3000-elapsed)/1000))}s · ${calibration.samples.length} valid samples`);
 if(elapsed>=3000&&calibration.samples.length>=15){
  const values=calibration.samples.sort((a,b)=>a-b);
  if(values[Math.floor(values.length*.9)]-values[Math.floor(values.length*.1)]>.08){
   calibration=null;baseline=null;$('calibrate').disabled=false;
   status('You moved too much to set a reliable baseline. Hold comfortably still and click Calibrate again.');return;
  }
  baseline=values[Math.floor(values.length/2)];viewBaselines[activeView]=baseline;calibration=null;$('calibrate').disabled=false;
  status(activeView+' view saved! Calibrate the other angle once; switching back will restore this baseline.');
 }
}

if(f&&Number.isFinite(m.ear)){if(m.ear<.18&&eyesClosedAt==null)eyesClosedAt=t;if(m.ear>=.21&&eyesClosedAt!=null){const duration=t-eyesClosedAt;if(duration>=60&&duration<=650)blinkTimes.push(Date.now());eyesClosedAt=null;}}else eyesClosedAt=null;
paintMetrics(m);renderLiveOverlay(p,t);if(f){ctx.strokeStyle='#b4e7c9';ctx.lineWidth=1;ctx.globalAlpha=.55;
for(const ids of [[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10],[33,160,158,133,153,144,33],[362,385,387,263,373,380,362],[70,63,105,66,107],[336,296,334,293,300]]){
 ctx.beginPath();ids.forEach((id,i)=>{const x=(1-f[id].x)*canvas.width,y=f[id].y*canvas.height;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
}ctx.globalAlpha=1;ctx.fillStyle='#b4e7c9';for(const i of [33,133,160,144,362,263,385,380]){ctx.beginPath();ctx.arc((1-f[i].x)*canvas.width,f[i].y*canvas.height,2,0,Math.PI*2);ctx.fill();}}
}catch(e){stopCamera();mode='demo';setModeUI();status('Tracking stopped unexpectedly. Demo is available; try the camera again.');}}
function stopCamera(){overlayTracker.reset();clearPostureWarning();generation++;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;video.style.display='none';pose?.close();face?.close();pose=face=null;loading=false;calibration=null;baseline=null;$('calibrate').disabled=false;$('camera').disabled=false;}
function freshSession(){viewBaselines={};overlayTracker.reset();activeView=pendingView=null;smoothedPosture=null;clearPostureWarning();seconds=0;history=[];blinkTimes=[];eyesClosedAt=null;paused=false;$('pause').textContent='Ⅱ';$('pause').setAttribute('aria-label','Pause session');$('timer').textContent='00:00';drawChart();}
function setModeUI(){$('demo').classList.toggle('active',mode==='demo');$('camera').classList.toggle('active',mode==='live');$('camera').textContent=mode==='live'?'◉ Camera on':'◉ Start camera';$('session-label').textContent=mode==='demo'?'DEMO SESSION':'LIVE SESSION';$('feed-badge').textContent=mode==='demo'?'SIMULATED DATA':'LOCAL INFERENCE';$('model-label').textContent=mode==='demo'?'Interactive simulation':'MediaPipe Pose + Face';$('blink-tag').textContent=mode==='demo'?'Simulated':'Observed';$('blinks').innerHTML='—<span> blinks</span>';$('fps').textContent=mode==='demo'?'DEMO':'WAITING FOR FRAME';document.querySelectorAll('[data-scene]').forEach(b=>b.disabled=mode==='live');}
$('demo').onclick=()=>{stopCamera();mode='demo';freshSession();setModeUI();status('Explore the experience. No camera needed.');};
$('camera').onclick=async()=>{enableAudio();if(loading||mode==='live')return;loading=true;const token=++generation;$('camera').disabled=true;status('Allow camera access. Loading local AI models…');let acquired=null,newPose=null,newFace=null;
try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera requires HTTPS or localhost.');acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:960},height:{ideal:660}},audio:false});if(token!==generation){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;status('Camera allowed. Starting bundled AI runtime…');
const {FilesetResolver,PoseLandmarker,FaceLandmarker}=await import('./vendor/mediapipe/vision_bundle.mjs');const vision=await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm/', import.meta.url).href.replace(/\/$/, ''));status('Loading posture model from this device…');newPose=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('./models/pose_landmarker_lite.task', import.meta.url).href},runningMode:'VIDEO',numPoses:1});status('Loading face model from this device…');newFace=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('./models/face_landmarker.task', import.meta.url).href},runningMode:'VIDEO',numFaces:1});if(token!==generation){acquired.getTracks().forEach(t=>t.stop());newPose.close();newFace.close();return;}
stream=acquired;pose=newPose;face=newFace;video.srcObject=stream;await video.play();if(token!==generation)return;video.style.display='block';canvas.width=video.videoWidth;canvas.height=video.videoHeight;mode='live';lastFrame=-1;freshSession();setModeUI();paintMetrics(null);status('Frame your face and both shoulders, then calibrate your comfortable posture.');stream.getVideoTracks()[0].addEventListener('ended',()=>{if(mode==='live'){$('demo').click();status('Camera disconnected. Returned to the demo.');}});
}catch(e){acquired?.getTracks().forEach(t=>t.stop());newPose?.close();newFace?.close();if(token===generation){pose=face=null;stream=null;video.srcObject=null;mode='demo';setModeUI();status(e.name==='NotAllowedError'?'Camera permission was denied. You can still use the demo.':`Camera could not start: ${e.message}. Demo remains available.`);}}finally{if(token===generation){loading=false;$('camera').disabled=false;}}};
for(const b of document.querySelectorAll('[data-scene]'))b.onclick=()=>{enableAudio();clearPostureWarning();scene=b.dataset.scene;document.querySelectorAll('[data-scene]').forEach(x=>x.classList.toggle('active',x===b));};
$('calibrate').onclick=()=>{enableAudio();if(mode==='demo'){showModal('<div class="eyebrow">A BASELINE THAT IS YOURS</div><h2>Comfort first.</h2><p>In live mode, sit comfortably with your face and both shoulders visible. We take the median of three seconds of stable landmarks to learn your starting position.</p><p>Start your camera to calibrate. Demo values are illustrative and do not use your camera.</p>');return;}if(paused){status('Resume the session before calibrating.');return;}if(!metrics){status('Keep your upper body visible until tracking settles first.');return;}clearPostureWarning();baseline=null;calibration={start:performance.now(),samples:[],missingSince:null};$('calibrate').disabled=true;$('calibrate').textContent='Calibrating… 0%';status('Sit upright with relaxed shoulders, look straight ahead, and hold for 3 seconds.');};
$('pause').onclick=()=>{clearPostureWarning();paused=!paused;eyesClosedAt=null;if(calibration){calibration=null;$('calibrate').disabled=false;}$('pause').textContent=paused?'▶':'Ⅱ';$('pause').setAttribute('aria-label',paused?'Resume session':'Pause session');status(paused?'Session paused. Camera stays on; analysis is paused.':'Session resumed.');};
function drawChart(){const data=history.slice(-180);const pts=data.map((v,i)=>[data.length<2?0:i/(data.length-1)*1000,125-v.score*1.2]);const d=pts.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');$('chart-line').setAttribute('d',d);$('chart-fill').setAttribute('d',pts.length?`${d} L${pts.at(-1)[0]},130 L0,130 Z`:'');$('chart-end').textContent=history.length>180?'LAST 3 MINUTES · NOW':'NOW';}
setInterval(()=>{if(paused)return;seconds++;$('timer').textContent=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;if(score!=null){history.push({second:seconds,score,shift:metrics.shift,tilt:metrics.tilt,ear:metrics.ear,mode});drawChart();}blinkTimes=blinkTimes.filter(v=>Date.now()-v<60000);$('blinks').innerHTML=mode==='demo'?'—<span> blinks</span>':`${blinkTimes.length}<span> blinks</span>`;$('blink-note').textContent=mode==='demo'?'Try live mode to count your blinks':seconds<60?'Collecting the first 60 seconds':'A rolling 60-second observation';},1000);
$('summary').onclick=()=>{const avg=arr=>arr.length?Math.round(arr.reduce((s,v)=>s+v.score,0)/arr.length):null;const first=avg(history.slice(0,10)),last=avg(history.slice(-10)),delta=first==null?null:last-first;showModal(`<div class="eyebrow">${mode==='demo'?'SIMULATED':'LIVE'} SESSION RECAP</div><h2>Small shifts add up.</h2><div class="recap-values"><div><strong>${avg(history)??'—'}</strong><span>AVERAGE PULSE</span></div><div><strong>${delta==null?'—':(delta>0?'+':'')+delta}</strong><span>FIRST → LAST 10 SAMPLES</span></div><div><strong>${Math.floor(seconds/60)}m</strong><span>SESSION TIME</span></div></div><p>${history.length<20?'Collect at least 20 valid samples for a useful before/after comparison.':'This compares the first and last 10 tracked samples. It is a wellness estimate, not a measured health outcome.'}</p><button class="primary" id="download">Download session CSV ↓</button>`);$('download').onclick=()=>{const csv='mode,second,pulse_score,head_shift_percent,shoulder_tilt_degrees,eye_aspect_ratio\n'+history.map(r=>[r.mode,r.second,r.score,r.shift,r.tilt,r.ear].join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download=`ergolens-${mode}-session.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};};
$('about').onclick=()=>showModal('<div class="eyebrow">ORDINARY CAMERA. A LITTLE MORE AWARENESS.</div><h2>Meet your posture pulse.</h2><p>MediaPipe’s pre-trained Pose and Face Landmarker neural networks run in your browser. We turn their coordinates into simple, explainable coaching cues.</p><ul><li>Head shift: change in nose-to-shoulder distance, normalized by shoulder width, from your calibration.</li><li>Shoulder tilt: estimated 2D angle between your shoulders.</li><li>Eye openness: eye aspect ratio (EAR). Blink counts are approximate and can miss quick blinks.</li><li>Pulse and warning use the same posture-only score on every tracked frame. Eye openness is shown separately. Thresholds are prototype heuristics.</li></ul><p>This does not measure clinical craniovertebral angle, attention, fatigue, or medical risk. Lighting, glasses, camera angle, and movement affect estimates.</p><p>Video is never recorded or uploaded by this app. AI runtime and models are bundled with this app; optional fonts load from Google. Camera analysis happens locally. Session data stays in memory unless you export it.</p>');
window.addEventListener('pagehide',stopCamera);requestAnimationFrame(tick);
