// ─── DJ Blob Tracker — Hand Gesture Edition ─────────────────────────────────

const video     = document.getElementById('webcam');
const canvas    = document.getElementById('canvas');
const ctx       = canvas.getContext('2d');
const loader    = document.getElementById('loader');
const loaderTxt = document.getElementById('loader-text');
const fpsCtr    = document.getElementById('fps-counter');
const blobCtr   = document.getElementById('blob-count');
const gestureEl = document.getElementById('gesture-display');

// ─── Processing canvas (downscaled for performance) ──────────────────────────
const PROC_W = 320, PROC_H = 240;
const proc = document.createElement('canvas');
proc.width = PROC_W; proc.height = PROC_H;
const pctx = proc.getContext('2d', { willReadFrequently: true });

// ─── Config ───────────────────────────────────────────────────────────────────
const cfg = {
  motionThresh: 22,
  bgAlpha:      0.04,
  minBlobCells: 4,
  cellSize:     10,
  confidence:   0.35,
  colorMode:    'purple',
  showVideo:    true,
};

const COLORS = {
  purple: { main: '#b400ff', light: '#d966ff', glow: 'rgba(180,0,255,' },
  white:  { main: '#ffffff', light: '#aaddff', glow: 'rgba(255,255,255,' },
  green:  { main: '#00ff66', light: '#44ffaa', glow: 'rgba(0,255,100,'  },
  fire:   { main: '#ff6600', light: '#ffaa00', glow: 'rgba(255,100,0,'  },
};
const C = () => COLORS[cfg.colorMode];

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

// ─── Blob detection (grid connected components) ───────────────────────────────
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

// ─── Hand Skeleton Connections ────────────────────────────────────────────────
const HAND_CONNECTIONS = [
  ['wrist','thumb_cmc'],['thumb_cmc','thumb_mcp'],['thumb_mcp','thumb_ip'],['thumb_ip','thumb_tip'],
  ['wrist','index_finger_mcp'],['index_finger_mcp','index_finger_pip'],['index_finger_pip','index_finger_dip'],['index_finger_dip','index_finger_tip'],
  ['wrist','middle_finger_mcp'],['middle_finger_mcp','middle_finger_pip'],['middle_finger_pip','middle_finger_dip'],['middle_finger_dip','middle_finger_tip'],
  ['wrist','ring_finger_mcp'],['ring_finger_mcp','ring_finger_pip'],['ring_finger_pip','ring_finger_dip'],['ring_finger_dip','ring_finger_tip'],
  ['wrist','pinky_finger_mcp'],['pinky_finger_mcp','pinky_finger_pip'],['pinky_finger_pip','pinky_finger_dip'],['pinky_finger_dip','pinky_finger_tip'],
  ['index_finger_mcp','middle_finger_mcp'],['middle_finger_mcp','ring_finger_mcp'],['ring_finger_mcp','pinky_finger_mcp'],
];

// ─── Gesture Detection ────────────────────────────────────────────────────────
const FINGERS = ['index_finger','middle_finger','ring_finger','pinky_finger'];

function detectGesture(keypoints) {
  const kp = {};
  for (const k of keypoints) kp[k.name] = k;
  if (!kp.wrist) return 'open';

  let curled = 0;
  for (const f of FINGERS) {
    const tip = kp[`${f}_tip`], mcp = kp[`${f}_mcp`];
    if (!tip || !mcp) continue;
    const tipD = Math.hypot(tip.x-kp.wrist.x, tip.y-kp.wrist.y);
    const mcpD = Math.hypot(mcp.x-kp.wrist.x, mcp.y-kp.wrist.y);
    if (tipD < mcpD * 1.25) curled++;
  }

  if (curled >= 3) return 'fist';

  // Peace sign: index + middle extended, others curled
  const idx = kp['index_finger_tip'], mid = kp['middle_finger_tip'];
  const rng = kp['ring_finger_tip'],  pnk = kp['pinky_finger_tip'];
  const idxMcp = kp['index_finger_mcp'], midMcp = kp['middle_finger_mcp'];
  const rngMcp = kp['ring_finger_mcp'],  pnkMcp = kp['pinky_finger_mcp'];
  if (idx && mid && rng && pnk && idxMcp && midMcp && rngMcp && pnkMcp) {
    const idxUp = Math.hypot(idx.x-kp.wrist.x, idx.y-kp.wrist.y) > Math.hypot(idxMcp.x-kp.wrist.x, idxMcp.y-kp.wrist.y);
    const midUp = Math.hypot(mid.x-kp.wrist.x, mid.y-kp.wrist.y) > Math.hypot(midMcp.x-kp.wrist.x, midMcp.y-kp.wrist.y);
    const rngCurl = Math.hypot(rng.x-kp.wrist.x, rng.y-kp.wrist.y) < Math.hypot(rngMcp.x-kp.wrist.x, rngMcp.y-kp.wrist.y)*1.2;
    const pnkCurl = Math.hypot(pnk.x-kp.wrist.x, pnk.y-kp.wrist.y) < Math.hypot(pnkMcp.x-kp.wrist.x, pnkMcp.y-kp.wrist.y)*1.2;
    if (idxUp && midUp && rngCurl && pnkCurl) return 'peace';
  }

  return 'open';
}

// ─── Draw hand skeleton ───────────────────────────────────────────────────────
function drawHand(keypoints, gesture) {
  if (!keypoints?.length) return;
  const kp = {};
  for (const k of keypoints) kp[k.name] = k;

  const sx = canvas.width / video.videoWidth;
  const sy = canvas.height / video.videoHeight;

  const col   = C().main;
  const glow  = C().glow;
  const alpha = gesture === 'fist' ? 1.0 : 0.9;

  ctx.save();

  // Draw connections
  ctx.lineWidth = gesture === 'fist' ? 3 : 1.8;
  for (const [a, b] of HAND_CONNECTIONS) {
    if (!kp[a] || !kp[b]) continue;
    ctx.beginPath();
    ctx.moveTo(kp[a].x * sx, kp[a].y * sy);
    ctx.lineTo(kp[b].x * sx, kp[b].y * sy);
    ctx.strokeStyle = glow + alpha * 0.8 + ')';
    ctx.shadowColor = col;
    ctx.shadowBlur  = gesture === 'fist' ? 20 : 8;
    ctx.stroke();
  }

  // Draw landmark dots
  for (const k of keypoints) {
    const x = k.x * sx, y = k.y * sy;
    const isTip = k.name.endsWith('_tip');
    const r = isTip ? 5 : 3;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.fillStyle = isTip ? col : glow + '0.5)';
    ctx.shadowColor = col;
    ctx.shadowBlur  = isTip ? 16 : 6;
    ctx.fill();

    // Tip labels
    if (isTip && cfg.colorMode !== 'fire') {
      ctx.font = '8px "Courier New"';
      ctx.fillStyle = glow + '0.7)';
      ctx.shadowBlur = 0;
      ctx.fillText(k.name.replace('_tip','').replace('_finger','').toUpperCase(), x+6, y-4);
    }
  }

  // Bounding box around hand
  const xs = keypoints.map(k => k.x * sx);
  const ys = keypoints.map(k => k.y * sy);
  const hx = Math.min(...xs) - 12, hy = Math.min(...ys) - 12;
  const hw = Math.max(...xs) - hx + 24, hh = Math.max(...ys) - hy + 24;

  ctx.strokeStyle = col;
  ctx.lineWidth   = 1.5;
  ctx.shadowColor = col;
  ctx.shadowBlur  = gesture === 'fist' ? 30 : 14;
  ctx.strokeRect(hx, hy, hw, hh);

  // Gesture label
  const GLYPH = { fist: '✊ FIST', peace: '✌ PEACE', open: '✋ HAND' };
  ctx.font = '12px "Courier New"';
  ctx.fillStyle = col;
  ctx.shadowBlur = 12;
  ctx.fillText(GLYPH[gesture] || '✋ HAND', hx, hy - 6);

  ctx.restore();
}

// ─── Render blobs ─────────────────────────────────────────────────────────────
function scaleX(x) { return (x / PROC_W) * canvas.width;  }
function scaleY(y) { return (y / PROC_H) * canvas.height; }
function scaleW(w) { return (w / PROC_W) * canvas.width;  }
function scaleH(h) { return (h / PROC_H) * canvas.height; }

function drawBlobs(blobs, opacity) {
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = '9px "Courier New"';
  const col  = C().main;
  const glow = C().glow;

  for (const b of blobs.values()) {
    if (b.miss > 0) continue;
    const x=scaleX(b.x), y=scaleY(b.y), w=scaleW(b.w), h=scaleH(b.h);
    const a = Math.min(1, b.age / 5);

    // Fill
    ctx.fillStyle = glow + (0.04 * a) + ')';
    ctx.fillRect(x, y, w, h);

    // Outline
    ctx.strokeStyle = glow + (0.85 * a) + ')';
    ctx.lineWidth   = 1;
    ctx.shadowColor = col;
    ctx.shadowBlur  = 6;
    ctx.strokeRect(x, y, w, h);

    // Corner ticks
    const tk = 7;
    ctx.lineWidth = 2;
    ctx.strokeStyle = glow + a + ')';
    ctx.shadowBlur = 10;
    for (const [cx2,cy2,dx,dy] of [[x,y,1,1],[x+w,y,-1,1],[x,y+h,1,-1],[x+w,y+h,-1,-1]]) {
      ctx.beginPath();
      ctx.moveTo(cx2+dx*tk, cy2); ctx.lineTo(cx2, cy2); ctx.lineTo(cx2, cy2+dy*tk);
      ctx.stroke();
    }

    // Label
    ctx.shadowBlur = 0;
    ctx.fillStyle  = glow + (0.8 * a) + ')';
    ctx.fillText(`#${String(b.id).padStart(3,'0')}`, x+3, y-3);
    if (b.label) {
      ctx.font = '10px "Courier New"';
      ctx.fillText(b.label.toUpperCase(), x+4, y+12);
      ctx.font = '9px "Courier New"';
    }
  }
  ctx.restore();
}

function drawActiveCells(grid, cw, ch, opacity) {
  if (opacity <= 0) return;
  const csx = canvas.width / cw, csy = canvas.height / ch;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle   = C().glow + '0.06)';
  for (let gy=0; gy<ch; gy++) for (let gx=0; gx<cw; gx++) {
    if (grid[gy*cw+gx]) ctx.fillRect(gx*csx+0.5, gy*csy+0.5, csx-1, csy-1);
  }
  ctx.restore();
}

function drawHUD(blobCount, fps) {
  ctx.save();
  ctx.font = '10px "Courier New"';
  ctx.fillStyle = C().glow + '0.5)';
  ctx.shadowBlur = 0;
  const ts = new Date().toISOString().slice(11,19);
  ctx.fillText(`BLOBTRAK  //  ${ts}`, 12, canvas.height - 24);
  ctx.fillText(`${fps} FPS  //  ${blobCount} BLOBS  //  ${cfg.colorMode.toUpperCase()}`, 12, canvas.height - 12);
  ctx.restore();
}

// ─── State ────────────────────────────────────────────────────────────────────
let cocoModel  = null;
let handDetector = null;
let blobTracker  = new BlobTracker();
let lastGesture  = 'open';
let blobOpacity  = 1;         // smoothly fades to 0 on fist
let currentHands = [];
let frameCount = 0, fps = 0, fpsTime = 0;

async function runModels() {
  if (video.readyState < 2) return;
  // Hand detection every frame
  try {
    currentHands = await handDetector.estimateHands(video, { flipHorizontal: false });
  } catch (_) {}
  // COCO every 8 frames
  if (frameCount % 8 === 0 && cocoModel) {
    try {
      const dets = await cocoModel.detect(video, 10, cfg.confidence);
      // stamp labels on blobs
      const sx = PROC_W / video.videoWidth, sy = PROC_H / video.videoHeight;
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

  // Motion blob detection
  pctx.drawImage(video, 0, 0, PROC_W, PROC_H);
  const frame = pctx.getImageData(0, 0, PROC_W, PROC_H);
  updateBg(frame.data);
  const mask = bgModel ? getFgMask(frame.data) : new Uint8Array(PROC_W*PROC_H);
  const { blobs: raw, grid, cw, ch } = findBlobs(mask);
  const blobs = blobTracker.update(raw);

  // Run ML models async
  runModels();

  // Gesture → state
  let gesture = 'open';
  if (currentHands.length > 0) {
    gesture = detectGesture(currentHands[0].keypoints);
  }

  if (gesture !== lastGesture) {
    lastGesture = gesture;
    gestureEl.textContent = gesture === 'fist' ? '✊ FIST — BLOBS CLEARED'
                          : gesture === 'peace' ? '✌ PEACE'
                          : '';
    document.body.classList.toggle('fist-mode', gesture === 'fist');
    setTimeout(() => { if (gestureEl.textContent !== '') gestureEl.textContent=''; }, 2000);
  }

  // Smooth blob opacity: fist → 0, open → 1
  const targetOpacity = gesture === 'fist' ? 0 : 1;
  blobOpacity += (targetOpacity - blobOpacity) * 0.12;

  // ── Render ──────────────────────────────────────────────────────────────────
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawActiveCells(grid, cw, ch, blobOpacity);
  drawBlobs(blobs, blobOpacity);

  // Draw all detected hands
  for (const hand of currentHands) {
    drawHand(hand.keypoints, gesture);
  }

  drawHUD(blobs.size, fps);
  fpsCtr.textContent = `${fps} fps`;
  blobCtr.textContent = `${blobs.size} blobs`;

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
      {
        runtime: 'mediapipe',
        solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915',
        modelType: 'full',
        maxHands: 2,
      }
    );

    loader.classList.add('hidden');
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    requestAnimationFrame(loop);
  } catch (e) {
    loaderTxt.textContent = `Error: ${e.message}`;
    console.error(e);
  }
})();
