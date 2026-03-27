# DJ Blob Tracker

Live ML-powered blob/object tracker for DJ booth projection.

## Deploy to GitHub Pages

1. Create a new repo on github.com (e.g. `dj-blob-tracker`)
2. In this folder, run:
   ```bash
   git init
   git add .
   git commit -m "initial"
   git remote add origin https://github.com/YOUR_USERNAME/dj-blob-tracker.git
   git push -u origin main
   ```
3. Go to your repo → **Settings → Pages → Source: Deploy from branch → main / root**
4. Your site will be live at `https://YOUR_USERNAME.github.io/dj-blob-tracker`

## Usage

- Open the site on any device with a camera
- Grant camera permission when prompted
- The ML model (COCO-SSD) loads in ~5 seconds
- Objects/people are tracked as glowing blobs
- Use the gear icon (bottom right) to:
  - Switch cameras
  - Change color theme (Neon / Fire / Ice / Void)
  - Toggle camera feed visibility
  - Adjust glow, trail length, and detection confidence
  - Enter fullscreen for booth display

## How it works

- **TensorFlow.js COCO-SSD** runs entirely in the browser — no server, no upload
- Detects 80 object classes (people, instruments, drinks, etc.)
- Custom blob tracker matches detections frame-to-frame with glowing trails
- Works on any device with a modern browser and camera
