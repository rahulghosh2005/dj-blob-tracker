// ─── DJ Blob Tracker — Ethereal Edition ─────────────────────────────────────

const video     = document.getElementById('webcam');
const canvas    = document.getElementById('canvas');
const ctx       = canvas.getContext('2d');
const loader    = document.getElementById('loader');
const loaderTxt = document.getElementById('loader-text');
const fpsCtr    = document.getElementById('fps-counter');
const blobCtr   = document.getElementById('blob-count');
const gestureEl = document.getElementById('gesture-display');
const modePill  = document.getElementById('mode-pill');

// ─── Processing canvas ───────────────────────────────────────────────────────
const PROC_W = 320, PROC_H = 240;
const proc  = document.createElement('canvas');
proc.width  = PROC_W; proc.height = PROC_H;
const pctx  = proc.getContext('2d', { willReadFrequently: true });

// ─── Spirit map canvas (accumulates motion ghost) ─────────────────────────────
let spiritCanvas = document.createElement('canvas');
let spiritCtx    = null;
function resizeSpirit() {
  spiritCanvas.width  = canvas.width;
  spiritCanvas.height = canvas.height;
  spiritCtx = spiritCanvas.getContext('2d');
}

// ─── Config ───────────────────────────────────────────────────────────────────
const cfg = {
  motionThresh: 22,
  bgAlpha:      0.04,
  minBlobCells: 12,
  cellSize:     10,
  confidence:   0.35,
  colorMode:    'purple',
  showVideo:    true,
  truthMode:    false,
  fx: { particles: true, spirit: true, crt: true, wave: true },
};

const COLORS = {
  purple: { main: '#b400ff', light: '#d966ff', glow: 'rgba(180,0,255,' },
  white:  { main: '#ffffff', light: '#aaddff', glow: 'rgba(255,255,255,' },
  green:  { main: '#00ff66', light: '#44ffaa', glow: 'rgba(0,255,100,'  },
  fire:   { main: '#ff6600', light: '#ffaa00', glow: 'rgba(255,100,0,'  },
};
const C = () => COLORS[cfg.colorMode];

const STROBE = ['#ff00ee','#00ffff','#eeff00','#ff1100','#00ff44','#ffffff','#aa00ff','#ff6600'];
const PSYCHE  = ['#ff00ee','#00ffff','#eeff00','#ff6600','#00ff88','#aa00ff','#ff1155','#44ffff'];

// ─── Background model ─────────────────────────────────────────────────────────
let bgModel = null;
function updateBg(data) {
  if (!bgModel) { bgModel = new Float32Array(data.length); bgModel.set(data); return; }
  const a = cfg.bgAlpha;
  for (let i = 0; i < data.length; i += 4) {
    bgModel[i]   += a * (data[i]   - bgModel[i]);
    bgModel[i+1] += a * (data[i+1] - bgModel[i+1]);
    bgModel[i+2] += a * (data[i+2] - bgModel[i+2]);
  }
}
function getFgMask(data) {
  const mask = new Uint8Array(PROC_W * PROC_H);
  const t = cfg.motionThresh;
  for (let i = 0; i < PROC_W * PROC_H; i++) {
    const p = i * 4;
    mask[i] = (Math.abs(data[p]-bgModel[p])+Math.abs(data[p+1]-bgModel[p+1])+Math.abs(data[p+2]-bgModel[p+2]))/3 > t ? 1 : 0;
  }
  return mask;
}

// ─── Blob detection ───────────────────────────────────────────────────────────
function findBlobs(mask) {
  const cs = cfg.cellSize;
  const cw = Math.ceil(PROC_W/cs), ch = Math.ceil(PROC_H/cs);
  const grid = new Uint8Array(cw*ch);
  for (let gy=0; gy<ch; gy++) for (let gx=0; gx<cw; gx++) {
    let on=0, tot=0;
    for (let dy=0; dy<cs; dy++) for (let dx=0; dx<cs; dx++) {
      const px=(gy*cs+dy)*PROC_W+(gx*cs+dx);
      if (px<mask.length) { on+=mask[px]; tot++; }
    }
    grid[gy*cw+gx] = tot && on/tot > 0.35 ? 1 : 0;
  }
  const labels = new Int32Array(cw*ch).fill(-1);
  const blobs  = [];
  let nid = 0;
  for (let gy=0; gy<ch; gy++) for (let gx=0; gx<cw; gx++) {
    const idx=gy*cw+gx;
    if (!grid[idx]||labels[idx]!==-1) continue;
    const q=[[gx,gy]]; labels[idx]=nid;
    let minX=gx,maxX=gx,minY=gy,maxY=gy,size=0;
    while (q.length) {
      const [cx,cy]=q.shift(); size++;
      minX=Math.min(minX,cx); maxX=Math.max(maxX,cx);
      minY=Math.min(minY,cy); maxY=Math.max(maxY,cy);
      for (const [nx,ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1],[cx-1,cy-1],[cx+1,cy-1],[cx-1,cy+1],[cx+1,cy+1]]) {
        if (nx>=0&&nx<cw&&ny>=0&&ny<ch) { const ni=ny*cw+nx; if (grid[ni]&&labels[ni]===-1){labels[ni]=nid;q.push([nx,ny]);} }
      }
    }
    if (size>=cfg.minBlobCells) blobs.push({id:nid++,x:minX*cs,y:minY*cs,w:(maxX-minX+1)*cs,h:(maxY-minY+1)*cs,area:size,miss:0,age:0});
  }
  return { blobs, grid, cw, ch };
}

// ─── Blob tracker ─────────────────────────────────────────────────────────────
class BlobTracker {
  constructor() { this.map=new Map(); this.nid=0; }
  update(raw) {
    const matched=new Set(), result=new Map();
    for (const d of raw) {
      const cx=d.x+d.w/2, cy=d.y+d.h/2;
      let best=null, bestD=Infinity;
      for (const [id,b] of this.map) {
        if (matched.has(id)) continue;
        const dist=Math.hypot(cx-b.cx,cy-b.cy);
        if (dist<Math.max(b.w,b.h)*1.8&&dist<bestD){bestD=dist;best=id;}
      }
      const id=best!==null?best:this.nid++;
      matched.add(id);
      result.set(id,{...d,id,cx,cy,miss:0,age:best!==null?(this.map.get(best)?.age||0)+1:0,label:this.map.get(best)?.label||null});
    }
    for (const [id,b] of this.map) if (!matched.has(id)&&b.miss<5) result.set(id,{...b,miss:b.miss+1});
    this.map=result; return result;
  }
}

// ─── Particle system ──────────────────────────────────────────────────────────
class Particle {
  constructor(x, y, col) {
    this.x = x+(Math.random()-.5)*10; this.y = y+(Math.random()-.5)*10;
    const ang=-Math.PI/2+(Math.random()-.5)*1.4, spd=0.6+Math.random()*2.2;
    this.vx=Math.cos(ang)*spd; this.vy=Math.sin(ang)*spd;
    this.life=1; this.decay=0.010+Math.random()*0.018;
    this.r=1.2+Math.random()*2.8; this.col=col;
  }
  update() { this.x+=this.vx; this.y+=this.vy; this.vy+=0.035; this.vx*=0.992; this.life-=this.decay; }
  alive()   { return this.life>0; }
  draw() {
    ctx.save();
    ctx.globalAlpha=this.life*.85;
    ctx.beginPath(); ctx.arc(this.x,this.y,this.r*this.life,0,Math.PI*2);
    ctx.fillStyle=this.col; ctx.shadowColor=this.col; ctx.shadowBlur=10; ctx.fill();
    ctx.restore();
  }
}
const particles=[];
const MAX_PARTICLES=500;

function spawnTipParticles(keypoints) {
  if (particles.length>=MAX_PARTICLES||!cfg.fx.particles) return;
  const sx=canvas.width/video.videoWidth, sy=canvas.height/video.videoHeight;
  for (const k of keypoints) {
    if (!k.name.endsWith('_tip')||Math.random()>.45) continue;
    particles.push(new Particle(k.x*sx,k.y*sy,C().main));
  }
}
function tickParticles() {
  for (let i=particles.length-1;i>=0;i--) { particles[i].update(); if (!particles[i].alive()) particles.splice(i,1); }
}
function drawParticles() {
  if (!cfg.fx.particles) return;
  for (const p of particles) p.draw();
}

// ─── Spirit map ───────────────────────────────────────────────────────────────
function updateSpirit(grid,cw,ch) {
  if (!spiritCtx||!cfg.fx.spirit) return;
  spiritCtx.globalCompositeOperation='destination-out';
  spiritCtx.fillStyle='rgba(0,0,0,0.022)';
  spiritCtx.fillRect(0,0,spiritCanvas.width,spiritCanvas.height);
  spiritCtx.globalCompositeOperation='source-over';
  const csx=spiritCanvas.width/cw, csy=spiritCanvas.height/ch;
  spiritCtx.fillStyle=C().glow+'0.28)';
  for (let gy=0;gy<ch;gy++) for (let gx=0;gx<cw;gx++)
    if (grid[gy*cw+gx]) spiritCtx.fillRect(gx*csx,gy*csy,csx,csy);
}
function drawSpirit() {
  if (!spiritCtx||!cfg.fx.spirit) return;
  ctx.save(); ctx.globalCompositeOperation='screen'; ctx.globalAlpha=0.55;
  ctx.drawImage(spiritCanvas,0,0); ctx.restore();
}

// ─── Hand velocity trail ──────────────────────────────────────────────────────
const wristHistory=[]; const MAX_HIST=30; let handVelocity=0;
function updateVelocity(keypoints) {
  const kp={}; for (const k of keypoints) kp[k.name]=k;
  if (!kp.wrist) { wristHistory.length=0; return; }
  const sx=canvas.width/video.videoWidth, sy=canvas.height/video.videoHeight;
  const x=kp.wrist.x*sx, y=kp.wrist.y*sy;
  if (wristHistory.length) handVelocity=Math.hypot(x-wristHistory.at(-1).x,y-wristHistory.at(-1).y);
  wristHistory.push({x,y});
  if (wristHistory.length>MAX_HIST) wristHistory.shift();
}
function drawVelocityTrail() {
  if (wristHistory.length<2||handVelocity<3) return;
  const col=C().main, glow=C().glow;
  ctx.save();
  for (let i=1;i<wristHistory.length;i++) {
    const t=i/wristHistory.length, alpha=t*Math.min(1,handVelocity/18)*.75;
    ctx.beginPath();
    ctx.moveTo(wristHistory[i-1].x,wristHistory[i-1].y);
    ctx.lineTo(wristHistory[i].x,wristHistory[i].y);
    ctx.strokeStyle=glow+alpha+')'; ctx.lineWidth=t*4.5*Math.min(1,handVelocity/12);
    ctx.shadowColor=col; ctx.shadowBlur=12; ctx.stroke();
  }
  ctx.restore();
}

// ─── CRT overlay ─────────────────────────────────────────────────────────────
function drawCRT() {
  if (!cfg.fx.crt) return;
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.022)';
  for (let y=0;y<canvas.height;y+=3) ctx.fillRect(0,y,canvas.width,1);
  const vg=ctx.createRadialGradient(canvas.width/2,canvas.height/2,canvas.height*.2,canvas.width/2,canvas.height/2,canvas.height*.85);
  vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,0,0,0.52)');
  ctx.fillStyle=vg; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.restore();
}

// ─── Edge waveform ────────────────────────────────────────────────────────────
let waveAmp=0, waveOff=0;
function drawWaveform(blobCount) {
  if (!cfg.fx.wave) return;
  waveAmp+=(Math.min(55,blobCount*14+10)-waveAmp)*.07; waveOff+=0.028;
  const col=C().main;
  ctx.save(); ctx.globalAlpha=0.4; ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.shadowColor=col; ctx.shadowBlur=14;
  ctx.beginPath();
  for (let x=0;x<=canvas.width;x+=3) {
    const y=canvas.height-10-Math.sin(x*.014+waveOff)*waveAmp-Math.sin(x*.031+waveOff*1.4)*waveAmp*.35;
    x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.beginPath();
  for (let x=0;x<=canvas.width;x+=3) {
    const y=10+Math.sin(x*.014+waveOff+Math.PI)*waveAmp+Math.sin(x*.031+waveOff*1.4+Math.PI)*waveAmp*.35;
    x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  }
  ctx.stroke(); ctx.restore();
}

// ─── Hand skeleton + connections ─────────────────────────────────────────────
const HAND_CONNECTIONS=[
  ['wrist','thumb_cmc'],['thumb_cmc','thumb_mcp'],['thumb_mcp','thumb_ip'],['thumb_ip','thumb_tip'],
  ['wrist','index_finger_mcp'],['index_finger_mcp','index_finger_pip'],['index_finger_pip','index_finger_dip'],['index_finger_dip','index_finger_tip'],
  ['wrist','middle_finger_mcp'],['middle_finger_mcp','middle_finger_pip'],['middle_finger_pip','middle_finger_dip'],['middle_finger_dip','middle_finger_tip'],
  ['wrist','ring_finger_mcp'],['ring_finger_mcp','ring_finger_pip'],['ring_finger_pip','ring_finger_dip'],['ring_finger_dip','ring_finger_tip'],
  ['wrist','pinky_finger_mcp'],['pinky_finger_mcp','pinky_finger_pip'],['pinky_finger_pip','pinky_finger_dip'],['pinky_finger_dip','pinky_finger_tip'],
  ['index_finger_mcp','middle_finger_mcp'],['middle_finger_mcp','ring_finger_mcp'],['ring_finger_mcp','pinky_finger_mcp'],
];
const FINGERS=['index_finger','middle_finger','ring_finger','pinky_finger'];

function analyzeHand(keypoints) {
  const kp={}; for (const k of keypoints) kp[k.name]=k;
  if (!kp.wrist) return {count:-1,isFist:false};
  let ext=0;
  for (const f of FINGERS) {
    const tip=kp[`${f}_tip`],mcp=kp[`${f}_mcp`];
    if (!tip||!mcp) continue;
    if (Math.hypot(tip.x-kp.wrist.x,tip.y-kp.wrist.y)>Math.hypot(mcp.x-kp.wrist.x,mcp.y-kp.wrist.y)*1.25) ext++;
  }
  return {count:ext,isFist:ext===0};
}

// ─── Laser pointer (1 finger, non-Truth) ─────────────────────────────────────
function drawLaser(keypoints) {
  const kp={}; for (const k of keypoints) kp[k.name]=k;
  if (!kp['index_finger_tip']||!kp['index_finger_pip']) return;
  const sx=canvas.width/video.videoWidth, sy=canvas.height/video.videoHeight;
  const tx=kp['index_finger_tip'].x*sx, ty=kp['index_finger_tip'].y*sy;
  const bx=kp['index_finger_pip'].x*sx, by=kp['index_finger_pip'].y*sy;
  const dx=tx-bx, dy=ty-by, len=Math.hypot(dx,dy);
  if (len<1) return;
  const nx=dx/len, ny=dy/len, ext=Math.max(canvas.width,canvas.height)*2;
  const ex=tx+nx*ext, ey=ty+ny*ext, col=C().main;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(ex,ey);
  ctx.strokeStyle=col; ctx.lineWidth=6; ctx.globalAlpha=0.08; ctx.shadowColor=col; ctx.shadowBlur=40; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(ex,ey);
  ctx.lineWidth=1.2; ctx.globalAlpha=0.85; ctx.shadowBlur=16; ctx.stroke();
  ctx.beginPath(); ctx.arc(tx,ty,6,0,Math.PI*2);
  ctx.fillStyle=col; ctx.globalAlpha=1; ctx.shadowBlur=25; ctx.fill();
  ctx.restore();
}

// ─── Hand skeleton renderer ───────────────────────────────────────────────────
function drawHand(keypoints,handState) {
  if (!keypoints?.length) return;
  const kp={}; for (const k of keypoints) kp[k.name]=k;
  const sx=canvas.width/video.videoWidth, sy=canvas.height/video.videoHeight;
  const col=C().main, glow=C().glow, bold=handState.isFist;
  ctx.save();
  ctx.lineWidth=bold?3:1.8;
  for (const [a,b] of HAND_CONNECTIONS) {
    if (!kp[a]||!kp[b]) continue;
    ctx.beginPath(); ctx.moveTo(kp[a].x*sx,kp[a].y*sy); ctx.lineTo(kp[b].x*sx,kp[b].y*sy);
    ctx.strokeStyle=glow+(bold?'0.9':'0.7')+')'; ctx.shadowColor=col; ctx.shadowBlur=bold?22:8; ctx.stroke();
  }
  for (const k of keypoints) {
    const x=k.x*sx, y=k.y*sy, isTip=k.name.endsWith('_tip');
    ctx.beginPath(); ctx.arc(x,y,isTip?5:3,0,Math.PI*2);
    ctx.fillStyle=isTip?col:glow+'0.5)'; ctx.shadowColor=col; ctx.shadowBlur=isTip?16:6; ctx.fill();
  }
  const xs=keypoints.map(k=>k.x*sx), ys=keypoints.map(k=>k.y*sy);
  const hx=Math.min(...xs)-12, hy=Math.min(...ys)-12;
  const hw=Math.max(...xs)-hx+24, hh=Math.max(...ys)-hy+24;
  ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.shadowColor=col; ctx.shadowBlur=bold?30:14; ctx.strokeRect(hx,hy,hw,hh);
  ctx.font='11px "Courier New"'; ctx.fillStyle=col; ctx.shadowBlur=10;
  ctx.fillText(bold?'FIST':`HAND  ${handState.count}F`,hx+4,hy-6);
  ctx.restore();
}

// ─── Scale helpers ────────────────────────────────────────────────────────────
const sX=x=>(x/PROC_W)*canvas.width, sY=y=>(y/PROC_H)*canvas.height;
const sW=w=>(w/PROC_W)*canvas.width, sH=h=>(h/PROC_H)*canvas.height;

// ─── Blob renderer ────────────────────────────────────────────────────────────
const MIN_BLOB_FRAC=0.008;
function drawBlobs(blobs,opacity) {
  if (opacity<=0.01) return;
  const minA=canvas.width*canvas.height*MIN_BLOB_FRAC;
  ctx.save(); ctx.globalAlpha=opacity; ctx.font='9px "Courier New"';
  const col=C().main, glow=C().glow;
  for (const b of blobs.values()) {
    if (b.miss>0) continue;
    const x=sX(b.x),y=sY(b.y),w=sW(b.w),h=sH(b.h);
    if (w*h<minA) continue;
    if (b.label==='person'&&w*h<minA*5) continue;
    const a=Math.min(1,b.age/5);
    ctx.fillStyle=glow+(0.05*a)+')'; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle=glow+(0.85*a)+')'; ctx.lineWidth=1; ctx.shadowColor=col; ctx.shadowBlur=6; ctx.strokeRect(x,y,w,h);
    const tk=7; ctx.lineWidth=2; ctx.strokeStyle=glow+a+')'; ctx.shadowBlur=10;
    for (const [cx2,cy2,dx,dy] of [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]]) {
      ctx.beginPath(); ctx.moveTo(cx2+dx*tk,cy2); ctx.lineTo(cx2,cy2); ctx.lineTo(cx2,cy2+dy*tk); ctx.stroke();
    }
    ctx.shadowBlur=0; ctx.fillStyle=glow+(0.8*a)+')';
    ctx.fillText(`#${String(b.id).padStart(3,'0')}`,x+3,y-3);
    if (b.label){ctx.font='10px "Courier New"';ctx.fillText(b.label.toUpperCase(),x+4,y+12);ctx.font='9px "Courier New"';}
  }
  ctx.restore();
}
function drawActiveCells(grid,cw,ch,opacity) {
  if (opacity<=0.01) return;
  const csx=canvas.width/cw, csy=canvas.height/ch;
  ctx.save(); ctx.globalAlpha=opacity; ctx.fillStyle=C().glow+'0.06)';
  for (let gy=0;gy<ch;gy++) for (let gx=0;gx<cw;gx++)
    if (grid[gy*cw+gx]) ctx.fillRect(gx*csx+.5,gy*csy+.5,csx-1,csy-1);
  ctx.restore();
}

// ─── Truth: big finger number ─────────────────────────────────────────────────
function drawFingerNumber(n) {
  const sz=Math.min(canvas.width*.52,canvas.height*.58), col=C().main, glow=C().glow;
  ctx.save(); ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font=`900 ${sz}px "Courier New"`;
  ctx.shadowColor=col; ctx.shadowBlur=90; ctx.strokeStyle=col; ctx.lineWidth=1.5;
  ctx.strokeText(String(n),canvas.width/2,canvas.height/2);
  ctx.fillStyle=glow+'0.07)'; ctx.shadowBlur=40;
  ctx.fillText(String(n),canvas.width/2,canvas.height/2);
  ctx.restore();
}

// ─── Truth: BTR strobe ────────────────────────────────────────────────────────
let strobeFrame=0;
function drawBTRStrobe() {
  const f=strobeFrame++, isOn=f%5<3, ci=Math.floor(f/3)%STROBE.length;
  const col=STROBE[ci], tc=STROBE[(ci+4)%STROBE.length];
  ctx.globalAlpha=isOn?.88:.93; ctx.fillStyle=isOn?col:'#000'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.globalAlpha=1;
  const sz=Math.min(canvas.width*.62,canvas.height*.52);
  const gx=isOn?(Math.random()-.5)*18:0, gy=isOn?(Math.random()-.5)*8:0;
  ctx.save(); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=`900 ${sz}px "Courier New"`;
  if (isOn) {
    ctx.globalAlpha=.45;
    ctx.fillStyle='#f00'; ctx.fillText('BTR',canvas.width/2+gx+10,canvas.height/2+gy);
    ctx.fillStyle='#0ff'; ctx.fillText('BTR',canvas.width/2+gx-10,canvas.height/2+gy);
    ctx.globalAlpha=1;
  }
  ctx.fillStyle=isOn?'#000':tc; ctx.shadowColor=tc; ctx.shadowBlur=60;
  ctx.fillText('BTR',canvas.width/2+gx,canvas.height/2+gy);
  ctx.globalAlpha=.04; ctx.fillStyle='#fff';
  const off=(f*10)%canvas.height;
  for (let i=0;i<20;i++) ctx.fillRect(0,(off+i*55)%canvas.height,canvas.width,18);
  ctx.globalAlpha=1; ctx.restore();
}

// ─── Truth: 4-finger psychedelic hold ─────────────────────────────────────────
let psycheIdx=0, psycheTimer=0;
function drawPsycheMode() {
  psycheTimer++;
  if (psycheTimer%40===0) psycheIdx=(psycheIdx+1)%PSYCHE.length;
  const col=PSYCHE[psycheIdx];
  const pulse=0.7+0.3*Math.sin(psycheTimer*.12);
  ctx.save(); ctx.globalCompositeOperation='color'; ctx.globalAlpha=0.28+Math.sin(psycheTimer*.08)*.1;
  ctx.fillStyle=col; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.restore();
  const sz=Math.min(canvas.width*.52,canvas.height*.58);
  ctx.save(); ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=`900 ${sz}px "Courier New"`;
  ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.shadowColor=col; ctx.shadowBlur=50+pulse*40; ctx.globalAlpha=pulse;
  ctx.strokeText('4',canvas.width/2,canvas.height/2); ctx.restore();
}

// ─── HUD ─────────────────────────────────────────────────────────────────────
function drawHUD(blobCount,fps) {
  ctx.save(); ctx.font='10px "Courier New"'; ctx.fillStyle=C().glow+'0.45)'; ctx.shadowBlur=0;
  const ts=new Date().toISOString().slice(11,19);
  ctx.fillText(`BLOBTRAK  //  ${ts}`,12,canvas.height-24);
  ctx.fillText(`${fps} FPS  //  ${blobCount} BLOBS${cfg.truthMode?'  //  TRUTH':''}`,12,canvas.height-12);
  ctx.restore();
}

// ─── State ────────────────────────────────────────────────────────────────────
let cocoModel=null, handDetector=null;
let blobTracker=new BlobTracker();
let currentHands=[];
let blobOpacity=1;
let frameCount=0, fps=0, fpsTime=0;

async function runModels() {
  if (video.readyState<2) return;
  try { currentHands=await handDetector.estimateHands(video,{flipHorizontal:false}); } catch(_){}
  if (frameCount%8===0&&cocoModel) {
    try {
      const dets=await cocoModel.detect(video,10,cfg.confidence);
      const sx=PROC_W/video.videoWidth, sy=PROC_H/video.videoHeight;
      for (const det of dets) {
        const [dx,dy,dw,dh]=det.bbox, cx=(dx+dw/2)*sx, cy=(dy+dh/2)*sy;
        let best=null, bestD=Infinity;
        for (const b of blobTracker.map.values()){const d=Math.hypot(cx-b.cx,cy-b.cy);if(d<bestD){bestD=d;best=b;}}
        if (best&&bestD<40) best.label=det.class;
      }
    } catch(_){}
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────
async function loop() {
  if (video.readyState<2) { requestAnimationFrame(loop); return; }
  const now=performance.now();
  frameCount++;
  if (now-fpsTime>1000) { fps=frameCount; frameCount=0; fpsTime=now; }

  if (canvas.width!==window.innerWidth||canvas.height!==window.innerHeight) {
    canvas.width=window.innerWidth; canvas.height=window.innerHeight; resizeSpirit();
  }

  pctx.drawImage(video,0,0,PROC_W,PROC_H);
  const frame=pctx.getImageData(0,0,PROC_W,PROC_H);
  updateBg(frame.data);
  const mask=bgModel?getFgMask(frame.data):new Uint8Array(PROC_W*PROC_H);
  const {blobs:raw,grid,cw,ch}=findBlobs(mask);
  const blobs=blobTracker.update(raw);

  runModels();

  let handState={count:-1,isFist:false};
  if (currentHands.length>0) {
    handState=analyzeHand(currentHands[0].keypoints);
    updateVelocity(currentHands[0].keypoints);
    spawnTipParticles(currentHands[0].keypoints);
  } else { wristHistory.length=0; handVelocity=0; }
  tickParticles();

  const inTruth    = cfg.truthMode;
  const showStrobe = inTruth && handState.isFist;
  const showPsyche = inTruth && handState.count===4;
  const fingerNum  = inTruth && !handState.isFist && handState.count>=1 && handState.count<=3 ? handState.count : 0;
  const showLaser  = !inTruth && handState.count===1;

  const targetOp=(inTruth&&(handState.isFist||handState.count>=4))?0:1;
  blobOpacity+=(targetOp-blobOpacity)*.14;

  document.body.classList.toggle('strobe-mode',showStrobe);
  document.body.classList.toggle('fist-mode',inTruth&&handState.isFist&&!showStrobe);

  ctx.clearRect(0,0,canvas.width,canvas.height);

  if (showStrobe) {
    drawBTRStrobe();
    for (const h of currentHands) drawHand(h.keypoints,handState);
  } else if (showPsyche) {
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,canvas.width,canvas.height);
    drawPsycheMode();
    for (const h of currentHands) drawHand(h.keypoints,handState);
  } else {
    ctx.fillStyle='rgba(0,0,0,0.48)'; ctx.fillRect(0,0,canvas.width,canvas.height);
    updateSpirit(grid,cw,ch); drawSpirit();
    drawActiveCells(grid,cw,ch,blobOpacity);
    drawBlobs(blobs,blobOpacity);
    drawWaveform(blobs.size);
    if (currentHands.length>0) {
      drawVelocityTrail(); drawParticles();
      if (showLaser) drawLaser(currentHands[0].keypoints);
      for (const h of currentHands) drawHand(h.keypoints,handState);
    } else { drawParticles(); }
    if (fingerNum>0) drawFingerNumber(fingerNum);
    drawCRT();
  }

  drawHUD(blobs.size,fps);
  fpsCtr.textContent=`${fps} fps`;
  blobCtr.textContent=`${blobs.size} blobs`;
  modePill.textContent=inTruth?(showStrobe?'BTR':showPsyche?'PSYCHE':fingerNum?`${fingerNum}F`:'TRUTH'):showLaser?'LASER':'';
  if (inTruth) {
    if (showStrobe)       gestureEl.textContent='BTR';
    else if (showPsyche)  gestureEl.textContent='4';
    else if (fingerNum)   gestureEl.textContent=`${fingerNum}`;
    else                  gestureEl.textContent='';
  } else { gestureEl.textContent=''; }

  requestAnimationFrame(loop);
}

// ─── Camera ───────────────────────────────────────────────────────────────────
async function startCamera(deviceId) {
  if (video.srcObject) video.srcObject.getTracks().forEach(t=>t.stop());
  try {
    video.srcObject=await navigator.mediaDevices.getUserMedia({
      video:{deviceId:deviceId?{exact:deviceId}:undefined,width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}}
    });
    await video.play(); bgModel=null;
  } catch(e){loaderTxt.textContent='Camera access denied.';}
}
async function populateCameras() {
  const sel=document.getElementById('camera-select');
  sel.innerHTML='';
  const devices=await navigator.mediaDevices.enumerateDevices();
  devices.filter(d=>d.kind==='videoinput').forEach((cam,i)=>{
    const opt=document.createElement('option');
    opt.value=cam.deviceId; opt.textContent=cam.label||`Camera ${i+1}`; sel.appendChild(opt);
  });
  sel.addEventListener('change',()=>startCamera(sel.value));
}

// ─── Controls ─────────────────────────────────────────────────────────────────
document.getElementById('toggle-controls').addEventListener('click',()=>
  document.getElementById('controls-panel').classList.toggle('hidden'));
document.getElementById('show-video').addEventListener('change',e=>{cfg.showVideo=e.target.checked;video.classList.toggle('hidden',!cfg.showVideo);});
document.getElementById('glow-slider').addEventListener('input',e=>cfg.motionThresh=+e.target.value);
document.getElementById('trail-slider').addEventListener('input',e=>{cfg.bgAlpha=+e.target.value/1000;bgModel=null;});
document.getElementById('confidence-slider').addEventListener('input',e=>cfg.confidence=+e.target.value/100);
document.querySelectorAll('.theme-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.theme-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); cfg.colorMode=btn.dataset.theme;
    document.body.className=`theme-${cfg.colorMode}`;
  });
});
document.querySelectorAll('.fx-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const fx=btn.dataset.fx; cfg.fx[fx]=!cfg.fx[fx]; btn.classList.toggle('active',cfg.fx[fx]);
  });
});
document.getElementById('truth-toggle').addEventListener('change',e=>{
  cfg.truthMode=e.target.checked;
  if (!cfg.truthMode){strobeFrame=0;blobOpacity=1;gestureEl.textContent='';document.body.classList.remove('strobe-mode','fist-mode');}
});
document.getElementById('fullscreen-btn').addEventListener('click',()=>
  document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen());

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown',e=>{
  if (e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
  switch(e.key.toLowerCase()) {
    case 't': { const tt=document.getElementById('truth-toggle'); tt.checked=!tt.checked; tt.dispatchEvent(new Event('change')); break; }
    case 'f': document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen(); break;
    case 'v': { const sv=document.getElementById('show-video'); sv.checked=!sv.checked; sv.dispatchEvent(new Event('change')); break; }
    case 'h': document.getElementById('controls-panel').classList.toggle('hidden'); break;
    case 'r': bgModel=null; if(spiritCtx)spiritCtx.clearRect(0,0,spiritCanvas.width,spiritCanvas.height); wristHistory.length=0; particles.length=0; break;
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
document.body.classList.add('theme-purple');
(async()=>{
  try {
    await startCamera(null); await populateCameras();
    loaderTxt.textContent='Loading COCO model...';
    cocoModel=await cocoSsd.load({base:'lite_mobilenet_v2'});
    loaderTxt.textContent='Loading Hand model...';
    handDetector=await handPoseDetection.createDetector(
      handPoseDetection.SupportedModels.MediaPipeHands,
      {runtime:'mediapipe',solutionPath:'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915',modelType:'full',maxHands:2}
    );
    loader.classList.add('hidden');
    canvas.width=window.innerWidth; canvas.height=window.innerHeight;
    resizeSpirit(); requestAnimationFrame(loop);
  } catch(e){loaderTxt.textContent=`Error: ${e.message}`;console.error(e);}
})();
