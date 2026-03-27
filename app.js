// ─── DJ Blob Tracker ────────────────────────────────────────────────────────

const video   = document.getElementById('webcam');
const canvas  = document.getElementById('canvas');
const ctx     = canvas.getContext('2d');
const loader  = document.getElementById('loader');
const loaderText = document.getElementById('loader-text');
const fpsCtr  = document.getElementById('fps-counter');
const blobCtr = document.getElementById('blob-count');

// ─── Config ──────────────────────────────────────────────────────────────────
const cfg = {
  glow: 30,
  trailLen: 20,
  confidence: 0.40,
  showVideo: true,
  theme: 'neon',
};

// Per-theme color palettes
const THEMES = {
  neon: ['#ff00ff','#00ffff','#ff6600','#00ff66','#ff0066','#6600ff','#ffff00'],
  fire: ['#ff4400','#ff8800','#ffcc00','#ff0044','#ff2200','#ffaa00','#cc2200'],
  ice:  ['#00ccff','#aaddff','#0066ff','#44ffee','#0099cc','#88ccff','#00ffcc'],
  void: ['#9900ff','#cc44ff','#ff00aa','#6600cc','#ff44cc','#aa00ff','#cc00ff'],
};

// ─── Blob Tracker State ───────────────────────────────────────────────────────
class Blob {
  constructor(id, det) {
    this.id    = id;
    this.age   = 0;
    this.miss  = 0;
    this.trail = [];
    this.color = null; // assigned on first render
    this.phase = Math.random() * Math.PI * 2;
    this.update(det);
  }

  update(det) {
    const [x, y, w, h] = det.bbox;
    this.x = x + w / 2;
    this.y = y + h / 2;
    this.w = w;
    this.h = h;
    this.label = det.class;
    this.score = det.score;
    this.age++;
    this.miss = 0;
  }

  pushTrail() {
    this.trail.push({ x: this.x, y: this.y, w: this.w, h: this.h });
    if (this.trail.length > cfg.trailLen) this.trail.shift();
  }
}

class BlobTracker {
  constructor() {
    this.blobs  = new Map();
    this.nextId = 0;
  }

  update(detections) {
    const matched = new Set();

    // Match each detection to nearest existing blob
    for (const det of detections) {
      const [dx, dy, dw, dh] = det.bbox;
      const cx = dx + dw / 2, cy = dy + dh / 2;

      let bestId   = null;
      let bestDist = Infinity;

      for (const [id, blob] of this.blobs) {
        if (matched.has(id)) continue;
        const dist = Math.hypot(cx - blob.x, cy - blob.y);
        const maxDist = Math.max(blob.w, blob.h) * 1.5;
        if (dist < maxDist && dist < bestDist) {
          bestDist = dist;
          bestId   = id;
        }
      }

      if (bestId !== null) {
        this.blobs.get(bestId).update(det);
        matched.add(bestId);
      } else {
        const id   = this.nextId++;
        const blob = new Blob(id, det);
        this.blobs.set(id, blob);
        matched.add(id);
      }
    }

    // Age-out blobs not seen this frame
    for (const [id, blob] of this.blobs) {
      if (!matched.has(id)) {
        blob.miss++;
        if (blob.miss > 8) this.blobs.delete(id);
      }
    }

    // Push trail for all live blobs
    for (const blob of this.blobs.values()) {
      blob.pushTrail();
    }

    return this.blobs;
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────
const colorCache = new Map();

function getColor(blobId) {
  if (!colorCache.has(blobId)) {
    const palette = THEMES[cfg.theme];
    colorCache.set(blobId, palette[blobId % palette.length]);
  }
  return colorCache.get(blobId);
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

function drawBlob(blob, now) {
  const col  = getColor(blob.id);
  const rgb  = hexToRgb(col);
  const glow = cfg.glow;
  const pulse = 0.85 + 0.15 * Math.sin(now * 0.003 + blob.phase);
  const sx   = canvas.width  / video.videoWidth  || 1;
  const sy   = canvas.height / video.videoHeight || 1;

  const x = blob.x * sx;
  const y = blob.y * sy;
  const w = blob.w * sx * pulse;
  const h = blob.h * sy * pulse;

  ctx.save();

  // Trail
  if (blob.trail.length > 1) {
    for (let i = 0; i < blob.trail.length - 1; i++) {
      const t    = blob.trail[i];
      const tx   = t.x * sx;
      const ty   = t.y * sy;
      const frac = i / blob.trail.length;
      const alpha = frac * 0.45;
      const tw   = t.w * sx * frac * 0.6;
      const th   = t.h * sy * frac * 0.6;

      ctx.beginPath();
      roundRect(ctx, tx - tw/2, ty - th/2, tw, th, Math.min(tw,th)/2);
      ctx.fillStyle = `rgba(${rgb},${alpha})`;
      ctx.fill();
    }
  }

  // Outer glow ring
  ctx.shadowColor = col;
  ctx.shadowBlur  = glow * pulse;

  ctx.beginPath();
  roundRect(ctx, x - w/2, y - h/2, w, h, 18);
  ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Second inner ring
  ctx.shadowBlur = glow * 0.5;
  ctx.beginPath();
  roundRect(ctx, x - w/2 + 5, y - h/2 + 5, w - 10, h - 10, 14);
  ctx.strokeStyle = `rgba(${rgb}, 0.4)`;
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Fill with low-alpha gradient
  const grad = ctx.createRadialGradient(x, y, 0, x, y, Math.max(w,h)/2);
  grad.addColorStop(0,   `rgba(${rgb}, 0.18)`);
  grad.addColorStop(0.6, `rgba(${rgb}, 0.06)`);
  grad.addColorStop(1,   `rgba(${rgb}, 0)`);
  ctx.beginPath();
  roundRect(ctx, x - w/2, y - h/2, w, h, 18);
  ctx.fillStyle = grad;
  ctx.shadowBlur = 0;
  ctx.fill();

  // Corner dots
  ctx.shadowColor = col;
  ctx.shadowBlur  = 10;
  const corners = [
    [x - w/2, y - h/2],
    [x + w/2, y - h/2],
    [x - w/2, y + h/2],
    [x + w/2, y + h/2],
  ];
  for (const [cx2, cy2] of corners) {
    ctx.beginPath();
    ctx.arc(cx2, cy2, 3, 0, Math.PI*2);
    ctx.fillStyle = col;
    ctx.fill();
  }

  // Label
  ctx.shadowBlur = 0;
  ctx.font = '11px "Courier New"';
  ctx.fillStyle = `rgba(${rgb},0.9)`;
  ctx.letterSpacing = '2px';
  const label = `${blob.label}  ${Math.round(blob.score * 100)}%`;
  ctx.fillText(label.toUpperCase(), x - w/2 + 6, y - h/2 - 6);

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w/2, h/2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

// Scanline / vignette overlay for DJ aesthetic
function drawOverlay() {
  // Vignette
  const vg = ctx.createRadialGradient(
    canvas.width/2, canvas.height/2, canvas.height*0.3,
    canvas.width/2, canvas.height/2, canvas.height*0.85
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Scanlines (subtle)
  ctx.fillStyle = 'rgba(0,0,0,0.04)';
  for (let y = 0; y < canvas.height; y += 3) {
    ctx.fillRect(0, y, canvas.width, 1);
  }
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
let model    = null;
let tracker  = new BlobTracker();
let lastTime = 0;
let frameCount = 0;
let fpsTime  = 0;
let fps      = 0;

async function detect() {
  if (!model || video.readyState < 2) {
    requestAnimationFrame(detect);
    return;
  }

  const now = performance.now();
  frameCount++;
  if (now - fpsTime > 1000) {
    fps      = frameCount;
    frameCount = 0;
    fpsTime  = now;
    fpsCtr.textContent = `${fps} fps`;
  }

  // Resize canvas to window
  if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  // Run model every ~3 frames to keep it smooth
  if (frameCount % 3 === 0) {
    try {
      const raw = await model.detect(video, undefined, cfg.confidence);
      tracker.update(raw);
    } catch (_) {}
  }

  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background fade for trail persistence
  ctx.fillStyle = 'rgba(0,0,10,0.55)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw blobs
  const blobs = tracker.blobs;
  blobCtr.textContent = `${blobs.size} blob${blobs.size !== 1 ? 's' : ''}`;

  for (const blob of blobs.values()) {
    if (blob.miss === 0) drawBlob(blob, now);
  }

  drawOverlay();

  requestAnimationFrame(detect);
}

// ─── Camera Setup ─────────────────────────────────────────────────────────────
async function startCamera(deviceId) {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
  }
  const constraints = {
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    }
  };
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia(constraints);
    await video.play();
  } catch (e) {
    loaderText.textContent = 'Camera access denied. Please allow camera.';
    console.error(e);
  }
}

async function populateCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams    = devices.filter(d => d.kind === 'videoinput');
  const sel     = document.getElementById('camera-select');
  sel.innerHTML = '';
  cams.forEach((cam, i) => {
    const opt   = document.createElement('option');
    opt.value   = cam.deviceId;
    opt.textContent = cam.label || `Camera ${i + 1}`;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => startCamera(sel.value));
}

// ─── Controls ─────────────────────────────────────────────────────────────────
document.getElementById('toggle-controls').addEventListener('click', () => {
  document.getElementById('controls-panel').classList.toggle('hidden');
});

document.getElementById('show-video').addEventListener('change', e => {
  cfg.showVideo = e.target.checked;
  video.classList.toggle('hidden', !cfg.showVideo);
});

document.getElementById('glow-slider').addEventListener('input', e => {
  cfg.glow = +e.target.value;
});

document.getElementById('trail-slider').addEventListener('input', e => {
  cfg.trailLen = +e.target.value;
});

document.getElementById('confidence-slider').addEventListener('input', e => {
  cfg.confidence = +e.target.value / 100;
});

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    cfg.theme = btn.dataset.theme;
    colorCache.clear();
    document.body.className = `theme-${cfg.theme}`;
  });
});

document.getElementById('fullscreen-btn').addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
});

// Hide controls panel initially on small screens
if (window.innerWidth < 600) {
  document.getElementById('controls-panel').classList.add('hidden');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.body.classList.add('theme-neon');

(async () => {
  try {
    await startCamera(null);
    await populateCameras();

    loaderText.textContent = 'Loading ML Model...';
    model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });

    loader.classList.add('hidden');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    requestAnimationFrame(detect);
  } catch (e) {
    loaderText.textContent = `Error: ${e.message}`;
    console.error(e);
  }
})();
