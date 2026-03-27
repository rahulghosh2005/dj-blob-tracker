// ─── DJ Blob Tracker — Truth Edition ────────────────────────────────────────

const video     = document.getElementById('webcam');
const canvas    = document.getElementById('canvas');
const ctx       = canvas.getContext('2d');
const loader    = document.getElementById('loader');
const loaderTxt = document.getElementById('loader-text');
const fpsCtr    = document.getElementById('fps-counter');
const blobCtr   = document.getElementById('blob-count');
const gestureEl = document.getElementById('gesture-display');

// ─── Processing canvas ───────────────────────────────────────────────────────
const PROC_W = 320, PROC_H = 240;
const proc = document.createElement('canvas');
proc.width = PROC_W; proc.height = PROC_H;
const pctx = proc.getContext('2d', { willReadFrequently: true });

// ─── Config ───────────────────────────────────────────────────────────────────
const cfg = {
  motionThresh: 22,
  bgAlpha:      0.04,
  minBlobCells: 12,   // higher = fewer small face-noise blobs
  cellSize:     10,
  confidence:   0.35,
  colorMode:    'purple',
  showVideo:    true,
  truthMode:    false,
};

const COLORS = {
  purple: { main: '#b400ff', light: '#d966ff', glow: 'rgba(180,0,255,' },
  white:  { main: '#ffffff', light: '#aaddff', glow: 'rgba(255,255,255,' },
  green:  { main: '#00ff66', light: '#44ffaa', glow: 'rgba(0,255,100,'  },
  fire:   { main: '#ff6600', light: '#ffaa00', glow: 'rgba(255,100,0,'  },
};
const C = () => COLORS[cfg.colorMode];

// ─── BTR Strobe palette ───────────────────────────────────────────────────────
const STROBE = [
  '#ff00ee', '#00ffff', '#eeff00', '#ff1100',
  '#00ff44', '#ffffff', '#aa00ff', '#ff6600',
];

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
    mask[i] = (Math.abs(data[p]-bgModel[p]) + Math.abs(data[p+1]-bgModel[p+1]) + Math.abs(data[p+2]-bgModel[p+2])) / 3 > t ? 1 : 0;
  }
  return mask;
}

// ─── Blob detection ───────────────────────────────────────────────────────────
function findBlobs(mask) {
  const cs = cfg.cellSize;
  const cw = Math.ceil(PROC_W / cs), ch = Math.ceil(PROC_H / cs);
  const grid = new Uint8Array(cw * ch);
  for (let gy = 0; gy < ch; gy++) {
    for (let gx = 0; gx < cw; gx++) {
      let on = 0, tot = 0;
      for (let dy = 0; dy < cs; dy++) for (let dx = 0; dx < cs; dx++) {
        const px = (gy*cs+dy)*PROC_W + (gx*cs+dx);
        if (px < mask.length) { on += mask[px]; tot++; }
      }
      grid[gy*cw+gx] = tot && on/tot > 0.35 ? 1 : 0;
    }
  }
  const labels = new Int32Array(cw*ch).fill(-1);
  const blobs  = [];
  let nextId   = 0;
  for (let gy = 0; gy < ch; gy++) {
    for (let gx = 0; gx < cw; gx++) {
      const idx = gy*cw+gx;
      if (!grid[idx] || labels[idx] !== -1) continue;
      const q = [[gx,gy]]; labels[idx] = nextId;
      let minX=gx, maxX=gx, minY=gy, maxY=gy, size=0;
      while (q.length) {
        const [cx,cy] = q.shift(); size++;
        minX=Math.min(minX,cx); maxX=Math.max(maxX,cx);
        minY=Math.min(minY,cy); maxY=Math.max(maxY,cy);
        for (const [nx,ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1],[cx-1,cy-1],[cx+1,cy-1],[cx-1,cy+1],[cx+1,cy+1]]) {
          if (nx>=0&&nx<cw&&ny>=0&&ny<ch) {
            const ni=ny*cw+nx;
            if (grid[ni]&&labels[ni]===-1) { labels[ni]=nextId; q.push([nx,ny]); }
          }
        }
      }
      if (size >= cfg.minBlobCells) {
        blobs.push({ id:nextId, x:minX*cs, y:minY*cs,
          w:(maxX-minX+1)*cs, h:(maxY-minY+1)*cs, area:size, miss:0, age:0 });
        nextId++;
      }
    }
  }
  return { blobs, grid, cw, ch };
}

// ─── Blob Tracker ─────────────────────────────────────────────────────────────
class BlobTracker {
  constructor() { this.map = new Map(); this.nid = 0; }
  update(raw) {
    const matched = new Set(), result = new Map();
    for (const d of raw) {
      const cx=d.x+d.w/2, cy=d.y+d.h/2;
      let best=null, bestD=Infinity;
      for (const [id,b] of this.map) {
        if (matched.has(id)) continue;
        const dist=Math.hypot(cx-b.cx, cy-b.cy);
        if (dist < Math.max(b.w,b.h)*1.8 && dist<bestD) { bestD=dist; best=id; }
      }
      const id = best!==null ? best : this.nid++;
      matched.add(id);
      result.set(id, { ...d, id, cx, cy, miss:0,
        age: best!==null ? (this.map.get(best)?.age||0)+1 : 0,
        label: this.map.get(best)?.label||null });
    }
    for (const [id,b] of this.map) {
      if (!matched.has(id) && b.miss<5) result.set(id, {...b, miss:b.miss+1});
    }
    this.map = result; return result;
  }
}

// ─── Hand connections ─────────────────────────────────────────────────────────
const HAND_CONNECTIONS = [
  ['wrist','thumb_cmc'],['thumb_cmc','thumb_mcp'],['thumb_mcp','thumb_ip'],['thumb_ip','thumb_tip'],
  ['wrist','index_finger_mcp'],['index_finger_mcp','index_finger_pip'],['index_finger_pip','index_finger_dip'],['index_finger_dip','index_finger_tip'],
  ['wrist','middle_finger_mcp'],['middle_finger_mcp','middle_finger_pip'],['middle_finger_pip','middle_finger_dip'],['middle_finger_dip','middle_finger_tip'],
  ['wrist','ring_finger_mcp'],['ring_finger_mcp','ring_finger_pip'],['ring_finger_pip','ring_finger_dip'],['ring_finger_dip','ring_finger_tip'],
  ['wrist','pinky_finger_mcp'],['pinky_finger_mcp','pinky_finger_pip'],['pinky_finger_pip','pinky_finger_dip'],['pinky_finger_dip','pinky_finger_tip'],
  ['index_finger_mcp','middle_finger_mcp'],['middle_finger_mcp','ring_finger_mcp'],['ring_finger_mcp','pinky_finger_mcp'],
];
const FINGERS = ['index_finger','middle_finger','ring_finger','pinky_finger'];

// ─── Hand analysis: count extended fingers ────────────────────────────────────
function analyzeHand(keypoints) {
  const kp = {};
  for (const k of keypoints) kp[k.name] = k;
  if (!kp.wrist) return { count: -1, isFist: false };
  let extended = 0;
  for (const f of FINGERS) {
    const tip = kp[`${f}_tip`], mcp = kp[`${f}_mcp`];
    if (!tip || !mcp) continue;
    const tipD = Math.hypot(tip.x - kp.wrist.x, tip.y - kp.wrist.y);
    const mcpD = Math.hypot(mcp.x - kp.wrist.x, mcp.y - kp.wrist.y);
    if (tipD > mcpD * 1.25) extended++;
  }
  return { count: extended, isFist: extended === 0 };
}

// ─── Draw hand skeleton ───────────────────────────────────────────────────────
function drawHand(keypoints, handState) {
  if (!keypoints?.length) return;
  const kp = {};
  for (const k of keypoints) kp[k.name] = k;
  const sx = canvas.width  / video.videoWidth;
  const sy = canvas.height / video.videoHeight;
  const col  = C().main;
  const glow = C().glow;
  const bold = handState.isFist;

  ctx.save();
  // Skeleton lines
  ctx.lineWidth = bold ? 3 : 1.8;
  for (const [a, b] of HAND_CONNECTIONS) {
    if (!kp[a] || !kp[b]) continue;
    ctx.beginPath();
    ctx.moveTo(kp[a].x*sx, kp[a].y*sy);
    ctx.lineTo(kp[b].x*sx, kp[b].y*sy);
    ctx.strokeStyle = glow + (bold ? '0.9' : '0.7') + ')';
    ctx.shadowColor = col;
    ctx.shadowBlur  = bold ? 20 : 8;
    ctx.stroke();
  }
  // Landmark dots
  for (const k of keypoints) {
    const x = k.x*sx, y = k.y*sy;
    const isTip = k.name.endsWith('_tip');
    ctx.beginPath();
    ctx.arc(x, y, isTip ? 5 : 3, 0, Math.PI*2);
    ctx.fillStyle  = isTip ? col : glow + '0.5)';
    ctx.shadowColor = col;
    ctx.shadowBlur  = isTip ? 16 : 6;
    ctx.fill();
  }
  // Bounding box
  const xs = keypoints.map(k => k.x*sx), ys = keypoints.map(k => k.y*sy);
  const hx = Math.min(...xs)-12, hy = Math.min(...ys)-12;
  const hw = Math.max(...xs)-hx+24, hh = Math.max(...ys)-hy+24;
  ctx.strokeStyle = col;
  ctx.lineWidth   = 1.5;
  ctx.shadowColor = col;
  ctx.shadowBlur  = bold ? 30 : 14;
  ctx.strokeRect(hx, hy, hw, hh);
  // Plain text label — no emojis
  ctx.font = '11px "Courier New"';
  ctx.fillStyle = col;
  ctx.shadowBlur = 10;
  const label = handState.isFist ? 'FIST' : `HAND  ${handState.count}F`;
  ctx.fillText(label, hx+4, hy-6);
  ctx.restore();
}

// ─── Scale helpers ────────────────────────────────────────────────────────────
function scaleX(x) { return (x / PROC_W) * canvas.width;  }
function scaleY(y) { return (y / PROC_H) * canvas.height; }
function scaleW(w) { return (w / PROC_W) * canvas.width;  }
function scaleH(h) { return (h / PROC_H) * canvas.height; }

// ─── Draw motion blobs ────────────────────────────────────────────────────────
// Min screen area to render (filters face-pixel noise)
const MIN_SCREEN_AREA_FRAC = 0.008; // 0.8% of screen

function drawBlobs(blobs, opacity) {
  if (opacity <= 0.01) return;
  const minArea = canvas.width * canvas.height * MIN_SCREEN_AREA_FRAC;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = '9px "Courier New"';
  const col  = C().main;
  const glow = C().glow;

  for (const b of blobs.values()) {
    if (b.miss > 0) continue;
    const x=scaleX(b.x), y=scaleY(b.y), w=scaleW(b.w), h=scaleH(b.h);
    // Skip tiny blobs (face noise)
    if (w * h < minArea) continue;
    // Skip person-labeled blobs that look face-sized (small + COCO said person)
    if (b.label === 'person' && w * h < minArea * 5) continue;
    const a = Math.min(1, b.age / 5);

    ctx.fillStyle   = glow + (0.05 * a) + ')';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = glow + (0.85 * a) + ')';
    ctx.lineWidth   = 1;
    ctx.shadowColor = col;
    ctx.shadowBlur  = 6;
    ctx.strokeRect(x, y, w, h);

    // Corner ticks
    const tk = 7;
    ctx.lineWidth = 2;
    ctx.strokeStyle = glow + a + ')';
    ctx.shadowBlur  = 10;
    for (const [cx2,cy2,dx,dy] of [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]]) {
      ctx.beginPath();
      ctx.moveTo(cx2+dx*tk, cy2); ctx.lineTo(cx2, cy2); ctx.lineTo(cx2, cy2+dy*tk);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle  = glow + (0.8 * a) + ')';
    ctx.fillText(`#${String(b.id).padStart(3,'0')}`, x+3, y-3);
    // COCO label — text only, no emoji
    if (b.label) {
      ctx.font = '10px "Courier New"';
      ctx.fillText(b.label.toUpperCase(), x+4, y+12);
      ctx.font = '9px "Courier New"';
    }
  }
  ctx.restore();
}

function drawActiveCells(grid, cw, ch, opacity) {
  if (opacity <= 0.01) return;
  const csx = canvas.width/cw, csy = canvas.height/ch;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle   = C().glow + '0.06)';
  for (let gy=0; gy<ch; gy++) for (let gx=0; gx<cw; gx++) {
    if (grid[gy*cw+gx]) ctx.fillRect(gx*csx+0.5, gy*csy+0.5, csx-1, csy-1);
  }
  ctx.restore();
}

// ─── Truth Mode: big finger number ───────────────────────────────────────────
function drawFingerNumber(n) {
  const fontSize = Math.min(canvas.width * 0.52, canvas.height * 0.58);
  const col  = C().main;
  const glow = C().glow;
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = `900 ${fontSize}px "Courier New"`;
  // Outer stroke glow
  ctx.shadowColor  = col;
  ctx.shadowBlur   = 90;
  ctx.strokeStyle  = col;
  ctx.lineWidth    = 1.5;
  ctx.strokeText(String(n), canvas.width/2, canvas.height/2);
  // Transparent fill so it looks outlined
  ctx.shadowBlur   = 40;
  ctx.fillStyle    = glow + '0.08)';
  ctx.fillText(String(n), canvas.width/2, canvas.height/2);
  ctx.restore();
}

// ─── Truth Mode: BTR strobe ───────────────────────────────────────────────────
let strobeFrame = 0;

function drawBTRStrobe() {
  const f   = strobeFrame++;
  const isOn = f % 5 < 3;                              // 3 frames color, 2 frames black
  const ci   = Math.floor(f / 3) % STROBE.length;
  const col  = STROBE[ci];
  const textCol = STROBE[(ci + 4) % STROBE.length];

  // BG flash
  ctx.globalAlpha = isOn ? 0.88 : 0.92;
  ctx.fillStyle   = isOn ? col : '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;

  // BTR — chromatic aberration + glitch offset
  const fontSize = Math.min(canvas.width * 0.63, canvas.height * 0.52);
  const gx = isOn ? (Math.random()-0.5)*18 : 0;
  const gy = isOn ? (Math.random()-0.5)*8  : 0;

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = `900 ${fontSize}px "Courier New"`;

  // Chromatic split
  if (isOn) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle   = '#ff0000';
    ctx.fillText('BTR', canvas.width/2+gx+10, canvas.height/2+gy);
    ctx.fillStyle   = '#00ffff';
    ctx.fillText('BTR', canvas.width/2+gx-10, canvas.height/2+gy);
    ctx.globalAlpha = 1;
  }

  // Main text
  ctx.shadowColor  = textCol;
  ctx.shadowBlur   = 60;
  ctx.fillStyle    = isOn ? '#000000' : textCol;
  ctx.fillText('BTR', canvas.width/2+gx, canvas.height/2+gy);

  // Scan bars
  ctx.globalAlpha = 0.04;
  ctx.fillStyle   = '#ffffff';
  const offset = (f * 10) % canvas.height;
  for (let i = 0; i < 20; i++) {
    ctx.fillRect(0, (offset + i*55) % canvas.height, canvas.width, 18);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ─── HUD ─────────────────────────────────────────────────────────────────────
function drawHUD(blobCount, fps) {
  ctx.save();
  ctx.font      = '10px "Courier New"';
  ctx.fillStyle = C().glow + '0.45)';
  ctx.shadowBlur = 0;
  const ts = new Date().toISOString().slice(11,19);
  ctx.fillText(`BLOBTRAK  //  ${ts}`, 12, canvas.height - 24);
  ctx.fillText(`${fps} FPS  //  ${blobCount} BLOBS${cfg.truthMode ? '  //  TRUTH' : ''}`, 12, canvas.height - 12);
  ctx.restore();
}

// ─── State ────────────────────────────────────────────────────────────────────
let cocoModel    = null;
let handDetector = null;
let blobTracker  = new BlobTracker();
let currentHands = [];
let blobOpacity  = 1;
let frameCount   = 0, fps = 0, fpsTime = 0;

async function runModels() {
  if (video.readyState < 2) return;
  try { currentHands = await handDetector.estimateHands(video, { flipHorizontal: false }); } catch (_) {}
  if (frameCount % 8 === 0 && cocoModel) {
    try {
      const dets = await cocoModel.detect(video, 10, cfg.confidence);
      const sx = PROC_W/video.videoWidth, sy = PROC_H/video.videoHeight;
      for (const det of dets) {
        const [dx,dy,dw,dh] = det.bbox;
        const cx=(dx+dw/2)*sx, cy=(dy+dh/2)*sy;
        let best=null, bestD=Infinity;
        for (const b of blobTracker.map.values()) {
          const d=Math.hypot(cx-b.cx, cy-b.cy);
          if (d<bestD) { bestD=d; best=b; }
        }
        if (best && bestD<40) best.label = det.class;
      }
    } catch (_) {}
  }
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
async function loop() {
  if (video.readyState < 2) { requestAnimationFrame(loop); return; }

  const now = performance.now();
  frameCount++;
  if (now - fpsTime > 1000) { fps=frameCount; frameCount=0; fpsTime=now; }

  if (canvas.width!==window.innerWidth||canvas.height!==window.innerHeight) {
    canvas.width=window.innerWidth; canvas.height=window.innerHeight;
  }

  // Motion blobs
  pctx.drawImage(video, 0, 0, PROC_W, PROC_H);
  const frame = pctx.getImageData(0, 0, PROC_W, PROC_H);
  updateBg(frame.data);
  const mask = bgModel ? getFgMask(frame.data) : new Uint8Array(PROC_W*PROC_H);
  const { blobs: raw, grid, cw, ch } = findBlobs(mask);
  const blobs = blobTracker.update(raw);

  runModels(); // async, non-blocking

  // Analyze hand
  let handState = { count: -1, isFist: false };
  if (currentHands.length > 0) handState = analyzeHand(currentHands[0].keypoints);

  // Truth-mode gesture state machine
  const inTruth     = cfg.truthMode;
  const showStrobe  = inTruth && handState.isFist;
  const fingerCount = inTruth && !handState.isFist && handState.count >= 1 && handState.count <= 3
                      ? handState.count : 0;

  // Blob opacity: hide blobs on fist (Truth), normal otherwise
  const targetOpacity = (inTruth && handState.isFist) ? 0 : 1;
  blobOpacity += (targetOpacity - blobOpacity) * 0.14;

  // Body class for CSS
  document.body.classList.toggle('strobe-mode', showStrobe);
  document.body.classList.toggle('fist-mode',   inTruth && handState.isFist && !showStrobe);

  // ── Render ──────────────────────────────────────────────────────────────────
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (showStrobe) {
    // BTR strobe completely takes over
    drawBTRStrobe();
    // Hand skeleton still visible on top
    for (const hand of currentHands) drawHand(hand.keypoints, handState);
  } else {
    // Normal tracker render
    ctx.fillStyle = 'rgba(0,0,0,0.48)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawActiveCells(grid, cw, ch, blobOpacity);
    drawBlobs(blobs, blobOpacity);

    // Finger count number (Truth mode, 1–3 fingers)
    if (fingerCount > 0) drawFingerNumber(fingerCount);

    // Hand skeleton
    for (const hand of currentHands) drawHand(hand.keypoints, handState);
  }

  drawHUD(blobs.size, fps);
  fpsCtr.textContent = `${fps} fps`;
  blobCtr.textContent = `${blobs.size} blobs`;

  // Gesture HUD text — no emojis
  if (inTruth) {
    if (showStrobe)        gestureEl.textContent = 'BTR';
    else if (fingerCount)  gestureEl.textContent = `${fingerCount}`;
    else if (handState.count > 3) gestureEl.textContent = 'OPEN';
    else                   gestureEl.textContent = '';
  } else {
    gestureEl.textContent = '';
  }

  requestAnimationFrame(loop);
}

// ─── Camera ───────────────────────────────────────────────────────────────────
async function startCamera(deviceId) {
  if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: deviceId ? { exact: deviceId } : undefined,
               width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:30} }
    });
    await video.play();
    bgModel = null;
  } catch (e) { loaderTxt.textContent = 'Camera access denied.'; }
}

async function populateCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const sel = document.getElementById('camera-select');
  sel.innerHTML = '';
  devices.filter(d=>d.kind==='videoinput').forEach((cam,i)=>{
    const opt = document.createElement('option');
    opt.value = cam.deviceId;
    opt.textContent = cam.label || `Camera ${i+1}`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => startCamera(sel.value));
}

// ─── Controls ─────────────────────────────────────────────────────────────────
document.getElementById('toggle-controls').addEventListener('click', () =>
  document.getElementById('controls-panel').classList.toggle('hidden'));

document.getElementById('show-video').addEventListener('change', e => {
  cfg.showVideo = e.target.checked;
  video.classList.toggle('hidden', !cfg.showVideo);
});
document.getElementById('glow-slider').addEventListener('input', e =>
  cfg.motionThresh = +e.target.value);
document.getElementById('trail-slider').addEventListener('input', e => {
  cfg.bgAlpha = +e.target.value / 1000; bgModel = null;
});
document.getElementById('confidence-slider').addEventListener('input', e =>
  cfg.confidence = +e.target.value / 100);

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    cfg.colorMode = btn.dataset.theme;
    document.body.className = `theme-${cfg.colorMode}`;
  });
});

document.getElementById('truth-toggle').addEventListener('change', e => {
  cfg.truthMode = e.target.checked;
  if (!cfg.truthMode) {
    strobeFrame = 0;
    blobOpacity = 1;
    gestureEl.textContent = '';
    document.body.classList.remove('strobe-mode','fist-mode');
  }
});

document.getElementById('fullscreen-btn').addEventListener('click', () =>
  document.fullscreenElement ? document.exitFullscreen()
                              : document.documentElement.requestFullscreen());

// ─── Init ─────────────────────────────────────────────────────────────────────
document.body.classList.add('theme-purple');

(async () => {
  try {
    await startCamera(null);
    await populateCameras();
    loaderTxt.textContent = 'Loading COCO model...';
    cocoModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    loaderTxt.textContent = 'Loading Hand model...';
    handDetector = await handPoseDetection.createDetector(
      handPoseDetection.SupportedModels.MediaPipeHands,
      { runtime: 'mediapipe',
        solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915',
        modelType: 'full', maxHands: 2 }
    );
    loader.classList.add('hidden');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    requestAnimationFrame(loop);
  } catch (e) {
    loaderTxt.textContent = `Error: ${e.message}`;
    console.error(e);
  }
})();
