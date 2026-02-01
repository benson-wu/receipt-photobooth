import "./style.css";
import QRCode from "qrcode";

const app = document.querySelector("#app");

// -------------------- Templates --------------------
const TEMPLATES = [
  { id: "single", name: "1 Photo", shots: 1 },
  { id: "duo", name: "2 Photos", shots: 2 },
  { id: "quad", name: "4 Photos", shots: 4 },
];

const IDLE_MS = 30_000;
const IDLE_WARNING_MS = 20_000; // Show warning 10s before reset

// countdown behavior (your request)
const COUNTDOWN_SECONDS = 5;
const BETWEEN_SHOTS_SECONDS = 5;
const PREVIEW_TIMEOUT_SECONDS = 30;

// -------------------- State --------------------
let stream = null;
let selectedTemplateId = null;
let shots = [];
let requiredShots = 0;

// Receipt metadata
let orderNumber = null;
let orderDate = null;

// Sequential order number counter (starts at 690000)
function getNextOrderNumber() {
  const STORAGE_KEY = "pocha31_orderCounter";
  const START_NUMBER = 690000;
  
  let counter = parseInt(localStorage.getItem(STORAGE_KEY) || START_NUMBER.toString(), 10);
  if (counter < START_NUMBER) counter = START_NUMBER;
  
  const orderNum = counter;
  counter++;
  localStorage.setItem(STORAGE_KEY, counter.toString());
  
  return String(orderNum);
}

// idle — only active on template select, preview, and print screens (not home or camera)
let idleTimer = null;
let idleWarningTimer = null;
let idleWarningOverlay = null;
let idleCountdownInterval = null;
let idleTimerEnabled = false;

// preview countdown timer
let previewCountdownTimer = null;

// public URL for QR codes (ngrok, etc.)
let publicBaseUrl = null;

// Print filters — developer-only constants, applied only when printing (not in preview)
const PRINT_FILTER_CONTRAST = 0.5;
const PRINT_FILTER_BRIGHTNESS = 2;
const PRINT_FILTER_SATURATION = 0.5;

// capture cancellation / concurrency
let captureToken = 0;
let isCapturing = false;

// NEW: for 2+ templates, user must press Start before first capture
let autoArmed = false;

function invalidateCaptureFlow() {
  captureToken += 1;
  isCapturing = false;
}

function isAutoMode() {
  return requiredShots >= 2;
}

// -------------------- Lantern HTML (fixed: unique filter IDs per lantern) --------------------
let lanternUid = 0;
let lanternContainer = null;

function lanternHtml({ leftPct, scale = 1, z = 3, opacity = 1, color = "#00ff41", delay = 0, duration = 6.2, rot = 4, tx = 5, stringLen = 160 }) {
  lanternUid += 1;
  const uid = `lantern_${lanternUid}`;
  return `
    <div class="lantern"
         style="
           left:${leftPct}%;
           transform: scale(${scale});
           z-index:${z};
           opacity:${opacity};
           animation-delay:${delay}s;
           animation-duration:${duration}s;
           --rot:${rot}deg;
           --tx:${tx}px;
           --string:${stringLen}px;
         ">
      <div class="string"></div>
      <svg width="76" height="92" viewBox="0 0 60 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <filter id="glow-${uid}" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d="M10 20 C10 10 50 10 50 20 L55 60 C55 70 5 70 5 60 Z"
          fill="${color}"
          fill-opacity="0.12"
          stroke="${color}"
          stroke-width="2"
          filter="url(#glow-${uid})"
        />
        <path d="M10 20 L50 20" stroke="${color}" stroke-width="1" opacity="0.85" />
        <path d="M5 60 L55 60" stroke="${color}" stroke-width="1" opacity="0.85" />
        <path d="M30 10 L30 70" stroke="${color}" stroke-width="1" opacity="0.55" />
        <path d="M30 70 L30 80" stroke="${color}" stroke-width="2" />
      </svg>
    </div>
  `;
}

function lanternSet() {
  // Rebuild with fresh unique IDs each render
  lanternUid = 0;

  return `
    ${lanternHtml({ leftPct: 12, scale: 1.02, color: "#00ff41", delay: 0.0, duration: 5.6, rot: 4.8, tx: 6, stringLen: 175 })}
    ${lanternHtml({ leftPct: 28, scale: 0.85, opacity: 0.90, color: "#ffea00", delay: 0.8, duration: 6.4, rot: 4.2, tx: 5, stringLen: 190 })}
    ${lanternHtml({ leftPct: 72, scale: 0.90, opacity: 0.95, color: "#00ff41", delay: 1.2, duration: 5.2, rot: 5.2, tx: 7, stringLen: 165 })}
    ${lanternHtml({ leftPct: 86, scale: 1.02, color: "#00d9ff", delay: 0.4, duration: 6.0, rot: 4.6, tx: 6, stringLen: 180 })}
  `;
}

// Red panda SVG — Neopet-style animated, accurate face (white mask + tear stripes)
let pandaUid = 0;
function redPandaHtml() {
  pandaUid += 1;
  const uid = `panda_${pandaUid}`;
  const redOrange = "#e85d3a";
  const darkBrown = "#b83d28";
  const midBrown = "#d45a38";
  const white = "#ffffff";
  const cream = "#fff8f0";
  const black = "#2d1f1a";
  const tearStripe = "#8b4513";

  return `
    <div class="red-panda" style="position: absolute; bottom: 12%; left: 0; z-index: 2; pointer-events: none;">
      <svg width="100" height="90" viewBox="0 0 100 90" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="panda-head-grad-${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${redOrange}" stop-opacity="0.4" />
            <stop offset="100%" stop-color="${darkBrown}" stop-opacity="0.25" />
          </linearGradient>
          <linearGradient id="panda-body-grad-${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="${redOrange}" stop-opacity="0.35" />
            <stop offset="100%" stop-color="${darkBrown}" stop-opacity="0.4" />
          </linearGradient>
          <linearGradient id="panda-tail-grad-${uid}" x1="100%" y1="50%" x2="0%" y2="50%">
            <stop offset="0%" stop-color="${redOrange}" stop-opacity="0.5" />
            <stop offset="100%" stop-color="${darkBrown}" stop-opacity="0.4" />
          </linearGradient>
          <filter id="panda-glow-${uid}" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <!-- Tail (group for animation) -->
        <g class="panda-tail" transform-origin="28 70">
          <path d="M 26 66 Q 12 56, 6 44 Q 2 32, 4 20 Q 8 12, 16 10 Q 20 12, 20 18" 
                fill="url(#panda-tail-grad-${uid})" stroke="${redOrange}" stroke-width="2" stroke-linejoin="round" filter="url(#panda-glow-${uid})" />
          <ellipse cx="18" cy="58" rx="5" ry="3.5" fill="${darkBrown}" fill-opacity="0.9" transform="rotate(-12 18 58)" filter="url(#panda-glow-${uid})" />
          <ellipse cx="12" cy="50" rx="5" ry="3.5" fill="${cream}" fill-opacity="0.6" transform="rotate(-20 12 50)" filter="url(#panda-glow-${uid})" />
          <ellipse cx="8" cy="40" rx="5" ry="3.5" fill="${darkBrown}" fill-opacity="0.9" transform="rotate(-28 8 40)" filter="url(#panda-glow-${uid})" />
          <ellipse cx="6" cy="30" rx="4.5" ry="3" fill="${cream}" fill-opacity="0.6" transform="rotate(-35 6 30)" filter="url(#panda-glow-${uid})" />
          <ellipse cx="7" cy="22" rx="4" ry="2.8" fill="${darkBrown}" fill-opacity="0.9" transform="rotate(-42 7 22)" filter="url(#panda-glow-${uid})" />
        </g>

        <!-- Body -->
        <path d="M 32 50 Q 26 54, 26 60 L 26 74 Q 26 78, 32 80 L 68 80 Q 74 78, 74 74 L 74 60 Q 74 54, 68 50 Q 58 47, 50 48 Q 42 47, 32 50" 
              fill="url(#panda-body-grad-${uid})" stroke="${redOrange}" stroke-width="2" stroke-linejoin="round" filter="url(#panda-glow-${uid})" />

        <!-- Head (round, reddish) -->
        <path d="M 50 16 Q 72 16, 76 28 Q 78 40, 70 48 Q 58 54, 50 54 Q 42 54, 30 48 Q 22 40, 24 28 Q 28 16, 50 16" 
              fill="url(#panda-head-grad-${uid})" stroke="${redOrange}" stroke-width="2" stroke-linejoin="round" filter="url(#panda-glow-${uid})" />

        <!-- Ears (triangular, white inside) -->
        <g class="panda-ear panda-ear-left">
          <path d="M 36 14 L 28 8 L 26 16 Q 28 20, 34 18 Z" fill="${redOrange}" fill-opacity="0.6" stroke="${redOrange}" stroke-width="1.5" filter="url(#panda-glow-${uid})" />
          <path d="M 32 12 L 28 10 L 28 14 Z" fill="${white}" fill-opacity="0.7" filter="url(#panda-glow-${uid})" />
        </g>
        <g class="panda-ear panda-ear-right">
          <path d="M 64 14 L 72 8 L 74 16 Q 72 20, 66 18 Z" fill="${redOrange}" fill-opacity="0.6" stroke="${redOrange}" stroke-width="1.5" filter="url(#panda-glow-${uid})" />
          <path d="M 68 12 L 72 10 L 72 14 Z" fill="${white}" fill-opacity="0.7" filter="url(#panda-glow-${uid})" />
        </g>

        <!-- White face mask (red panda: white muzzle + cheeks) -->
        <path d="M 32 28 Q 40 24, 50 26 Q 60 24, 68 28 Q 72 36, 70 44 Q 66 50, 50 52 Q 34 50, 30 44 Q 28 36, 32 28" 
              fill="${white}" fill-opacity="0.95" stroke="${cream}" stroke-width="1" stroke-opacity="0.5" filter="url(#panda-glow-${uid})" />

        <!-- Tear stripes (moved away from eyes — outer cheeks) -->
        <path d="M 32 28 L 26 38 L 28 41" fill="none" stroke="${tearStripe}" stroke-width="1.8" stroke-opacity="0.5" stroke-linecap="round" filter="url(#panda-glow-${uid})" />
        <path d="M 68 28 L 74 38 L 72 41" fill="none" stroke="${tearStripe}" stroke-width="1.8" stroke-opacity="0.5" stroke-linecap="round" filter="url(#panda-glow-${uid})" />

        <!-- Dark eye patches (softer — friendly, not furrowed) -->
        <ellipse cx="42" cy="32" rx="4" ry="3.5" fill="${tearStripe}" fill-opacity="0.25" filter="url(#panda-glow-${uid})" />
        <ellipse cx="58" cy="32" rx="4" ry="3.5" fill="${tearStripe}" fill-opacity="0.25" filter="url(#panda-glow-${uid})" />

        <!-- Eyes (rounder = friendlier) -->
        <g class="panda-eyes">
          <circle class="panda-eye" cx="42" cy="32" r="2.5" fill="${black}" filter="url(#panda-glow-${uid})" />
          <circle class="panda-eye" cx="58" cy="32" r="2.5" fill="${black}" filter="url(#panda-glow-${uid})" />
          <circle cx="43" cy="31" r="0.8" fill="${white}" filter="url(#panda-glow-${uid})" />
          <circle cx="59" cy="31" r="0.8" fill="${white}" filter="url(#panda-glow-${uid})" />
        </g>

        <!-- Nose (small, black, round) -->
        <ellipse cx="50" cy="39" rx="2" ry="1.5" fill="${black}" filter="url(#panda-glow-${uid})" />

        <!-- Mouth (big happy smile) -->
        <path class="panda-mouth" d="M 42 41 Q 50 48, 58 41" stroke="${black}" stroke-width="1.5" fill="none" stroke-linecap="round" filter="url(#panda-glow-${uid})" />

        <!-- Whiskers -->
        <path d="M 36 36 L 20 34" stroke="${black}" stroke-width="0.5" stroke-opacity="0.5" filter="url(#panda-glow-${uid})" />
        <path d="M 36 38 L 18 38" stroke="${black}" stroke-width="0.5" stroke-opacity="0.5" filter="url(#panda-glow-${uid})" />
        <path d="M 36 40 L 20 42" stroke="${black}" stroke-width="0.5" stroke-opacity="0.5" filter="url(#panda-glow-${uid})" />
        <path d="M 64 36 L 80 34" stroke="${black}" stroke-width="0.5" stroke-opacity="0.5" filter="url(#panda-glow-${uid})" />
        <path d="M 64 38 L 82 38" stroke="${black}" stroke-width="0.5" stroke-opacity="0.5" filter="url(#panda-glow-${uid})" />
        <path d="M 64 40 L 80 42" stroke="${black}" stroke-width="0.5" stroke-opacity="0.5" filter="url(#panda-glow-${uid})" />

        <!-- Paws -->
        <ellipse cx="40" cy="74" rx="4" ry="6" fill="${darkBrown}" fill-opacity="0.5" stroke="${darkBrown}" stroke-width="1.5" filter="url(#panda-glow-${uid})" />
        <ellipse cx="60" cy="74" rx="4" ry="6" fill="${darkBrown}" fill-opacity="0.5" stroke="${darkBrown}" stroke-width="1.5" filter="url(#panda-glow-${uid})" />
      </svg>
    </div>
  `;
}

// Initialize persistent lantern container that never gets destroyed
function initPersistentLanterns() {
  // Create persistent container if it doesn't exist
  if (!lanternContainer) {
    lanternContainer = document.createElement('div');
    lanternContainer.className = 'lantern-container';
    lanternContainer.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 3;';
    
    // Create lanterns once
    lanternContainer.insertAdjacentHTML('beforeend', lanternSet());
    
    // Add red panda
    lanternContainer.insertAdjacentHTML('beforeend', redPandaHtml());
    
    // Append to body (outside app) so it persists across all page changes
    document.body.appendChild(lanternContainer);
  }
}

// -------------------- Public base URL (ngrok-aware) --------------------
async function getPublicBaseUrl() {
  if (publicBaseUrl) return publicBaseUrl;

  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      if (json?.publicBaseUrl) {
        publicBaseUrl = String(json.publicBaseUrl).replace(/\/$/, "");
        return publicBaseUrl;
      }
    }
  } catch (_) {}

  publicBaseUrl = window.location.origin;
  return publicBaseUrl;
}

// -------------------- Video readiness --------------------
async function waitForVideoReady(videoEl) {
  if (videoEl.readyState >= 2 && videoEl.videoWidth && videoEl.videoHeight) return;

  await new Promise((resolve) => {
    const onReady = () => {
      videoEl.removeEventListener("loadedmetadata", onReady);
      resolve();
    };
    videoEl.addEventListener("loadedmetadata", onReady);
  });

  try { await videoEl.play(); } catch {}
}

// -------------------- Shared Neon Shell Builder --------------------
function renderNeonShell({ topRightHtml = "", stageHtml = "", footerLeftHtml = "", footerRightHtml = "", stageClass = "", wrapClass = "" }) {
  // Ensure persistent lanterns are initialized (they stay in body, never destroyed)
  initPersistentLanterns();
  
  app.innerHTML = `
    <div class="neon-shell">
      <div class="bg-atmosphere"></div>
      <div class="neon-glow pink"></div>
      <div class="neon-glow blue"></div>
      <div class="scanlines"></div>

      <header class="neon-topbar">
        <div class="neon-topbar-inner">
          <div class="brand">
            <div class="title">Tiff's 31st Pocha</div>
            <div class="sub">Receipt Photobooth</div>
          </div>
          <div>${topRightHtml}</div>
        </div>
      </header>

      <main class="neon-stage-wrap ${wrapClass}" id="main-content" role="main" aria-label="Main content">
        <div class="neon-stage ${stageClass}">${stageHtml}</div>
      </main>

      <footer class="neon-footer">
        <div class="neon-footer-inner">
          <div>${footerLeftHtml}</div>
          <div class="footer-actions">${footerRightHtml}</div>
        </div>
      </footer>
    </div>
  `;
}

// -------------------- Screens --------------------
function renderStart() {
  invalidateCaptureFlow();
  armIdleTimer();

  // Ensure persistent lanterns are initialized (they stay in body, never destroyed)
  initPersistentLanterns();

  app.innerHTML = `
    <div class="neon-home">
      <div class="bg-atmosphere"></div>
      <div class="neon-glow pink"></div>
      <div class="neon-glow blue"></div>
      <div class="scanlines"></div>

      <div class="neon-content">
        <div class="ktext">서 울 의 밤</div>

        <h1 class="neon-title">
          <span class="line1">TIFF'S 31ST</span>
          <span class="line2">POCHA</span>
        </h1>

        </br></br>

        <button class="neon-cta" id="startBtn" aria-label="Start order and choose layout">
          START ORDER <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  `;

  document.querySelector("#startBtn").addEventListener("click", () => {
    // warm up audio (helps iOS)
    makeBeep({ freq: 1, duration: 0.001, volume: 0.0001 });

    selectedTemplateId = null;
    renderTemplateSelect();
  });
}

function renderTemplateSelect() {
  invalidateCaptureFlow();
  idleTimerEnabled = true;
  armIdleTimer();

  const cardsHtml = TEMPLATES.map(
    (t) => `
      <button class="templateCard ${selectedTemplateId === t.id ? "selected" : ""}" data-id="${t.id}" aria-pressed="${selectedTemplateId === t.id}" aria-label="Choose ${t.name} layout">
        <div class="templateThumb">
          ${renderTemplateThumb(t.id)}
        </div>
        <div class="templateLabel">${selectedTemplateId === t.id ? "✓ " : ""}${t.name}</div>
        <div class="small" style="margin-top:6px;">
          ${t.shots >= 2 ? `Auto mode (press Start, then ${COUNTDOWN_SECONDS}s countdown)` : `Manual mode (tap Capture)`}
        </div>
      </button>
    `
  ).join("");

  renderNeonShell({
    topRightHtml: `<div class="badge"><b>1</b> / 3</div>`,
    stageHtml: `
      <div class="neon-card neon-card--layout">
        <h2>Choose your layout</h2>
        <div class="hint">Pick a template. For 2+ shots you'll press Start, then we'll auto-capture with a countdown.</div>
        <div class="templateGrid">${cardsHtml}</div>
      </div>
    `,
    footerRightHtml: `
      <button id="backBtn" class="btn-text" aria-label="Go back">Back</button>
      <button class="neon-primary" id="confirmBtn" ${selectedTemplateId ? "" : "disabled"} aria-label="Continue to camera">Continue</button>
    `,
  });

  document.querySelector("#backBtn").addEventListener("click", renderStart);

  document.querySelectorAll(".templateCard").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedTemplateId = btn.dataset.id;
      renderTemplateSelect();
    });
  });

  document.querySelector("#confirmBtn").addEventListener("click", async () => {
    if (!selectedTemplateId) return;

    makeBeep({ freq: 1, duration: 0.001, volume: 0.0001 });

    orderNumber = getNextOrderNumber();
    orderDate = new Date();

    const t = TEMPLATES.find((x) => x.id === selectedTemplateId);
    requiredShots = t?.shots ?? 0;

    shots = [];
    autoArmed = false;

    // Show loading state while camera starts (iPad-specific: avoids blank screen)
    renderNeonShell({
      topRightHtml: `<div class="badge"><b>2</b> / 3</div>`,
      stageHtml: `
        <div class="neon-card loading-card">
          <div class="loading-spinner" aria-hidden="true"></div>
          <h2 style="margin:0 0 8px;">Starting camera…</h2>
          <div class="hint">Please allow camera access when prompted.</div>
        </div>
      `,
      footerLeftHtml: ``,
      footerRightHtml: ``,
    });

    await startCamera();
    renderCamera();
  });
}

function renderTemplateThumb(id) {
  if (id === "single") return `<div class="thumbBox full"></div>`;
  if (id === "duo") return `<div class="thumbStack"><div class="thumbBox half"></div><div class="thumbBox half"></div></div>`;
  if (id === "quad")
    return `
      <div class="thumbGrid">
        <div class="thumbRow"><div class="thumbBox half"></div><div class="thumbBox half"></div></div>
        <div class="thumbRow"><div class="thumbBox half"></div><div class="thumbBox half"></div></div>
      </div>
    `;
  return "";
}

function renderCamera() {
  armIdleTimer();

  const token = captureToken;
  const auto = isAutoMode();
  const needsStart = auto && !autoArmed && shots.length === 0;

  renderNeonShell({
    topRightHtml: `<div class="badge badge--shot" id="shotBadge">Shot <b>${shots.length + 1}</b> of <b>${requiredShots}</b></div>`,
    stageHtml: `
      <div class="camera-stage">
        <div class="cameraCard" style="opacity: 0;">
          <video class="video" id="video" autoplay playsinline webkit-playsinline muted disablepictureinpicture style="opacity: 0;"></video>
          <div class="overlay" id="countdown" style="display:none;"></div>
          <div class="flash" id="flash" style="display:none;">Nice!</div>
          <div class="status" id="status" style="display:${needsStart ? "grid" : "none"};">
            ${needsStart ? "Press Start when you're ready 📸" : ""}
          </div>
        </div>
        <div class="camera-hint">
          ${auto ? `Auto mode • ${COUNTDOWN_SECONDS}s countdown` : `Manual mode • tap Capture`}
        </div>
        ${!auto ? `<button class="neon-primary camera-capture-btn" id="captureBtn" aria-label="Capture photo">Capture</button>` : ""}
      </div>
    `,
    footerLeftHtml: `<div class="small">Order # <b>${orderNumber ?? "--"}</b></div>`,
    footerRightHtml: `
      <button id="cancelBtn" class="btn-text" aria-label="Cancel and go back">Cancel</button>
      ${auto && needsStart ? `<button class="neon-primary" id="startAutoBtn" aria-label="Start countdown and capture">Start</button>` : ""}
    `,
  });

  const video = document.querySelector("#video");
  const cameraCard = document.querySelector(".cameraCard");
  // iPad Safari: ensure autoplay stays reliable across re-renders
  if (video) {
    video.muted = true;
    video.playsInline = true;
    try { video.disablePictureInPicture = true; } catch {}
    // Do not show controls (Safari may still show transient overlay if paused)
    video.controls = false;
    video.removeAttribute("controls");
    video.setAttribute("controlslist", "nodownload noplaybackrate noremoteplayback");
    video.setAttribute("disableremoteplayback", "");
    // Prevent taps from toggling Safari's native play/pause UI
    video.style.pointerEvents = "none";
  }
  
  // Update video preview: fit entire video within viewport (no cropping), may be smaller
  const updateVideoAspect = () => {
    if (video.videoWidth && video.videoHeight && cameraCard) {
      const videoAspect = video.videoWidth / video.videoHeight;
      const isLandscape = window.innerWidth > window.innerHeight;
      const maxH = isLandscape
        ? Math.min(window.innerHeight * 0.68, 600)
        : Math.min(window.innerHeight * 0.58, 520);
      const maxW = isLandscape
        ? Math.min(1100, window.innerWidth - 40)
        : Math.min(860, window.innerWidth - 32);
      // Fit within box: preserve aspect, show whole video (no crop)
      let w = maxW, h = maxW / videoAspect;
      if (h > maxH) {
        h = maxH;
        w = maxH * videoAspect;
      }
      cameraCard.style.width = `${w}px`;
      cameraCard.style.height = `${h}px`;
      cameraCard.style.aspectRatio = `${videoAspect}`;
      video.style.objectFit = "contain";
    }
  };

  // Attach stream after setting up the update handler
  video.srcObject = stream;
  // Aggressively keep playback running so iOS never shows the pause/play overlay.
  // If Safari pauses the video during load or re-render, immediately resume.
  const keepPlaying = () => {
    if (!video) return;
    if (video.paused) {
      try { video.play(); } catch {}
    }
  };
  video.addEventListener("pause", keepPlaying);
  video.addEventListener("ended", keepPlaying);

  // Only fade in once we are actually playing (prevents the initial overlay flash).
  const onPlaying = () => {
    video.removeEventListener("playing", onPlaying);
    requestAnimationFrame(() => {
      if (cameraCard) cameraCard.style.transition = "opacity 0.2s ease-in";
      video.style.transition = "opacity 0.2s ease-in";
      if (cameraCard) cameraCard.style.opacity = "1";
      video.style.opacity = "1";
    });
  };
  video.addEventListener("playing", onPlaying);

  // Kick playback immediately (and again shortly after) to survive iOS timing quirks
  try { video.play(); } catch {}
  setTimeout(keepPlaying, 0);
  setTimeout(keepPlaying, 200);

  // Update when video metadata loads
  video.addEventListener("loadedmetadata", updateVideoAspect);
  // Also try immediately in case it's already loaded
  updateVideoAspect();

  document.querySelector("#cancelBtn").addEventListener("click", () => {
    invalidateCaptureFlow();
    resetOrder();
  });

  if (!auto) {
    document.querySelector("#captureBtn").addEventListener("click", () => {
      captureWithCountdown(video, token);
    });
  } else {
    if (needsStart) {
      document.querySelector("#startAutoBtn").addEventListener("click", () => {
        autoArmed = true;
        // hide status overlay immediately
        const status = document.querySelector("#status");
        if (status) status.style.display = "none";
        captureWithCountdown(video, token);
      });
    } else {
      // after the first shot, continue automatically
      setTimeout(() => captureWithCountdown(video, token), 250);
    }
  }
}

// -------------------- Camera --------------------
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });
  } catch (err) {
    renderNeonShell({
      topRightHtml: `<div class="badge">Camera</div>`,
      stageHtml: `
        <div class="neon-card">
          <h2>Camera access failed</h2>
          <div class="hint">${escapeHtml(String(err))}</div>
          <div class="hint">iPad requires HTTPS. Use your Mac HTTPS server (or ngrok) and accept the certificate.</div>
        </div>
      `,
      footerRightHtml: `<button id="backBtn" class="btn-text">Back</button>`,
    });

    document.querySelector("#backBtn").addEventListener("click", () => {
      resetSessionOnly();
      renderStart();
    });

    throw err;
  }
}

// -------------------- Capture with countdown (5 seconds) --------------------
async function captureWithCountdown(videoEl, tokenFromRender) {
  if (isCapturing) return;

  const myToken = tokenFromRender;
  if (myToken !== captureToken) return;

  isCapturing = true;

  try {
    await waitForVideoReady(videoEl);
    if (myToken !== captureToken) return;

    const overlay = document.querySelector("#countdown");
    const status = document.querySelector("#status");
    if (!overlay) return;

    const auto = isAutoMode();

    // Main countdown: 5 seconds
    overlay.style.display = "grid";
    for (let i = COUNTDOWN_SECONDS; i >= 1; i--) {
      if (myToken !== captureToken) return;
      overlay.textContent = String(i);
      beepTick();
      await wait(1000);
    }
    overlay.style.display = "none";
    if (myToken !== captureToken) return;

    // Capture
    beepShutter();

    const canvas = document.createElement("canvas");
    const w = videoEl.videoWidth || 1280;
    const h = videoEl.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    // Un-mirror the image (video preview is mirrored, but final image should be normal)
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoEl, 0, 0, w, h);

    // PNG preserves exact pixels (like camera-filter-demo); JPEG lossy would change filter input
    const dataUrl = canvas.toDataURL("image/png");
    shots.push(dataUrl);

    // Success feedback (iPad: clear confirmation each shot was captured)
    const flash = document.querySelector("#flash");
    if (flash) {
      flash.textContent = requiredShots > 1 ? `Shot ${shots.length} ✓` : "Captured ✓";
      flash.style.display = "grid";
      await wait(500);
      flash.style.display = "none";
    }

    if (myToken !== captureToken) return;

    // Next shot
    if (shots.length < requiredShots) {
      const auto = isAutoMode();

      // For auto (2+ shots), do NOT re-render the camera UI between shots.
      // Re-rendering causes iPad Safari to briefly show its native play/pause overlay.
      if (auto) {
        // Update badge for next shot
        const badge = document.querySelector("#shotBadge");
        if (badge) badge.innerHTML = `Shot <b>${shots.length + 1}</b> of <b>${requiredShots}</b>`;

        isCapturing = false;
        // Small delay so the UI can settle before next countdown
        setTimeout(() => captureWithCountdown(videoEl, myToken), 200);
        return;
      }

      // For manual mode (1 shot), fall back to re-render (shouldn't happen anyway)
      isCapturing = false;
      renderCamera();
      return;
    }

    isCapturing = false;
    await renderFinalCompositePreview();
  } finally {
    if (myToken === captureToken) isCapturing = false;
  }
}

// -------------------- Photo filters (exact copy from camera-filter-demo) --------------------
function applyFilters(imageData) {
  const data = imageData.data;
  const contrast = filterContrast;
  const brightness = filterBrightness;
  const saturation = filterSaturation;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Brightness: scale around 0
    r = r * brightness;
    g = g * brightness;
    b = b * brightness;

    // Contrast: (p - 128) * factor + 128
    const contrastFactor = contrast;
    r = (r - 128) * contrastFactor + 128;
    g = (g - 128) * contrastFactor + 128;
    b = (b - 128) * contrastFactor + 128;

    // Saturation: blend with luminance
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * saturation;
    g = gray + (g - gray) * saturation;
    b = gray + (b - gray) * saturation;

    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
  return imageData;
}

function applyPrintFiltersToImage(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  applyPrintFilters(imageData);
  ctx.putImageData(imageData, 0, 0);
  return c;
}

// -------------------- Composite helpers --------------------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawCover(ctx, img, x, y, w, h) {
  const imgAspect = img.width / img.height;
  const boxAspect = w / h;

  let sx, sy, sw, sh;
  if (imgAspect > boxAspect) {
    sh = img.height;
    sw = sh * boxAspect;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / boxAspect;
    sx = 0;
    sy = (img.height - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawText(ctx, text, x, y, opts = {}) {
  const {
    size = 26,
    weight = "600",
    color = "#111827",
    font = "ui-monospace, SFMono-Regular, Menlo, monospace",
  } = opts;

  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillText(text, x, y);
}

function drawDashedLine(ctx, x1, y, x2) {
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

// -------------------- Build receipt composite --------------------
// 80mm thermal: 384px width, larger fonts for legibility on print
const RECEIPT_WIDTH_PX = 384;

async function buildCompositeDataUrl(applyPrintFilter = false) {
  const W = RECEIPT_WIDTH_PX;
  const pad = 14;
  const maxContentWidth = W - pad * 2;

  const dtStr = (orderDate ?? new Date()).toLocaleString();
  const orderStr = orderNumber ?? "------";

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 3000;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, 3000);

  let y = 24;

  drawText(ctx, "TIFF'S 31ST POCHA", pad, y, { size: 24, weight: "900" });
  y += 22;

  drawText(ctx, `DATE: ${dtStr}`, pad, y, { size: 16, weight: "600" });
  y += 18;
  drawText(ctx, `ORDER #: ${orderStr}`, pad, y, { size: 16, weight: "600" });
  y += 18;

  y += 8;
  drawDashedLine(ctx, pad, y, W - pad);
  y += 18;

  const items = [
    ["FRIED CHICKEN", "1", "8.49"],
    ["TTEOKBOKKI", "1", "7.25"],
    ["DYNAMITE SPRITZ", "1", "6.96"],
    ["KOGI DOG", "1", "8.99"],
  ];

  const total = items.reduce((sum, [, , price]) => sum + parseFloat(price), 0);
  const totalStr = total.toFixed(2);

  drawText(ctx, "ITEM         QTY   PRICE", pad, y, { size: 14, weight: "800" });
  y += 18;

  for (const [name, qty, price] of items) {
    const left = String(name).slice(0, 14).padEnd(14, " ");
    const mid = String(qty).padStart(2, " ");
    const right = String(price).padStart(5, " ");
    drawText(ctx, `${left} ${mid}  ${right}`, pad, y, { size: 14, weight: "600" });
    y += 16;
  }

  y += 8;
  drawDashedLine(ctx, pad, y, W - pad);
  y += 18;

  const photoBoxX = pad;
  const photoBoxY = y;
  const photoBoxW = maxContentWidth;
  // Photo box height will be calculated based on template

  const rawImgs = await Promise.all(shots.map(loadImage));
  const imgs = applyPrintFilter
    ? rawImgs.map((img) => applyPrintFiltersToImage(img))
    : rawImgs;

  let photoBoxH = 0; // Will be calculated based on layout

  if (requiredShots === 1 && imgs[0]) {
    // Single photo: use aspect ratio to determine height
    const imgAspect = imgs[0].width / imgs[0].height;
    photoBoxH = photoBoxW / imgAspect;
    drawCover(ctx, imgs[0], photoBoxX, photoBoxY, photoBoxW, photoBoxH);
  } else if (requiredShots === 2 && imgs.length >= 2) {
    const gap = 5;
    // Calculate height for each photo based on aspect ratio
    const imgAspect = imgs[0].width / imgs[0].height;
    const hEach = photoBoxW / imgAspect;
    photoBoxH = hEach * 2 + gap;
    drawCover(ctx, imgs[0], photoBoxX, photoBoxY, photoBoxW, hEach);
    drawCover(ctx, imgs[1], photoBoxX, photoBoxY + hEach + gap, photoBoxW, hEach);
  } else if (requiredShots === 4 && imgs.length >= 4) {
    const gap = 5;
    const wEach = (photoBoxW - gap) / 2;
    const imgAspect = imgs[0].width / imgs[0].height;
    const hEach = wEach / imgAspect;
    photoBoxH = hEach * 2 + gap;
    drawCover(ctx, imgs[0], photoBoxX, photoBoxY, wEach, hEach);
    drawCover(ctx, imgs[1], photoBoxX + wEach + gap, photoBoxY, wEach, hEach);
    drawCover(ctx, imgs[2], photoBoxX, photoBoxY + hEach + gap, wEach, hEach);
    drawCover(ctx, imgs[3], photoBoxX + wEach + gap, photoBoxY + hEach + gap, wEach, hEach);
  } else if (imgs[0]) {
    const imgAspect = imgs[0].width / imgs[0].height;
    photoBoxH = photoBoxW / imgAspect;
    drawCover(ctx, imgs[0], photoBoxX, photoBoxY, photoBoxW, photoBoxH);
  }

  if (photoBoxH === 0) {
    photoBoxH = 256;
  }

  y = photoBoxY + photoBoxH + 18;
  drawDashedLine(ctx, pad, y, W - pad);
  y += 18;

  drawText(ctx, "TOTAL".padEnd(18, " ") + `$${totalStr}`, pad, y, { size: 18, weight: "900" });
  y += 20;
  drawText(ctx, "THANK YOU FOR CELEBRATING!", pad, y, { size: 15, weight: "700" });
  y += 22;

  const base = await getPublicBaseUrl();
  const shareUrl = `${base}/share/${orderNumber}`;

  const qrSize = 96; // Multiple of 8 for thermal printer byte alignment
  const qrDataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, width: qrSize });
  const qrImg = await loadImage(qrDataUrl);

  const centerX = W / 2;
  const qrX = Math.floor(centerX - qrSize / 2);
  ctx.drawImage(qrImg, qrX, y, qrSize, qrSize);
  y += qrSize;

  const scanText = "SCAN TO DOWNLOAD";
  ctx.font = "800 15px ui-monospace, SFMono-Regular, Menlo, monospace";
  const scanTextX = Math.floor(centerX - ctx.measureText(scanText).width / 2);
  drawText(ctx, scanText, scanTextX, y + 12, { size: 15, weight: "800" });
  y += 22;
  y += 24;

  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = W;
  finalCanvas.height = y;
  const finalCtx = finalCanvas.getContext("2d");
  finalCtx.fillStyle = "#ffffff";
  finalCtx.fillRect(0, 0, W, y);
  finalCtx.drawImage(canvas, 0, 0);

  return finalCanvas.toDataURL("image/jpeg", 0.92);
}

// -------------------- Save / Print (send to Mac) --------------------
async function sendToMacAndPrint(compositeDataUrl, { print = true } = {}) {
  const res = await fetch("/api/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderNumber: orderNumber ?? "------",
      imageDataUrl: compositeDataUrl,
      print,
    }),
  });

  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

// -------------------- Preview + print flow (scroll receipt inside card) --------------------
async function renderFinalCompositePreview() {
  invalidateCaptureFlow();
  armIdleTimer();

  let compositeDataUrl;
  try {
    compositeDataUrl = await buildCompositeDataUrl();
  } catch (e) {
    renderNeonShell({
      topRightHtml: `<div class="badge">Preview</div>`,
      stageHtml: `
        <div class="neon-card">
          <h2>Could not build image</h2>
          <div class="hint">${escapeHtml(String(e))}</div>
        </div>
      `,
      footerRightHtml: `<button class="neon-primary" id="restartBtn" aria-label="Start over">Start Over</button>`,
    });
    document.querySelector("#restartBtn").addEventListener("click", resetOrder);
    return;
  }

  // Save immediately so the QR/share link works BEFORE Print
  renderNeonShell({
    topRightHtml: `<div class="badge">Saving</div>`,
    stageHtml: `
      <div class="neon-card" style="text-align:center;">
        <h2>Saving...</h2>
        <div class="hint">Preparing your QR download link.</div>
        <div style="margin-top:12px; font-size:34px;">🧾</div>
      </div>
    `,
    footerRightHtml: `<button id="cancelBtn" class="btn-text" aria-label="Cancel">Cancel</button>`,
  });

  document.querySelector("#cancelBtn")?.addEventListener("click", resetOrder);

  try {
    // Save only; printing happens when user presses Print
    await sendToMacAndPrint(compositeDataUrl, { print: false });
  } catch (e) {
    renderNeonShell({
      topRightHtml: `<div class="badge">Error</div>`,
      stageHtml: `
        <div class="neon-card">
          <h2>Could not save image</h2>
          <div class="hint">${escapeHtml(String(e))}</div>
          <div class="hint">Without saving, the QR link won't work yet.</div>
        </div>
      `,
      footerRightHtml: `
        <button id="retrySaveBtn">Retry</button>
        <button class="neon-primary" id="backToPreviewBtn">Continue anyway</button>
      `,
    });

    document.querySelector("#retrySaveBtn")?.addEventListener("click", () => renderFinalCompositePreview());
    document.querySelector("#backToPreviewBtn")?.addEventListener("click", () => showPreview(compositeDataUrl));
    return;
  }

  showPreview(compositeDataUrl);
}

function clearPreviewCountdown() {
  if (previewCountdownTimer) {
    clearInterval(previewCountdownTimer);
    previewCountdownTimer = null;
  }
}

function showPreview(compositeDataUrl) {
  idleTimerEnabled = true;
  armIdleTimer();
  clearPreviewCountdown();

  let secondsLeft = PREVIEW_TIMEOUT_SECONDS;
  const totalSeconds = PREVIEW_TIMEOUT_SECONDS;

  renderNeonShell({
    topRightHtml: `<div class="badge"><b>2</b> / 3</div>`,
    stageClass: "neon-stage--preview",
    wrapClass: "neon-stage-wrap--preview",
    stageHtml: `
      <div class="preview-screen">
        <div class="preview-header">
          <h2 class="preview-title">Preview</h2>
          <div class="preview-timeout-bar">
            <div class="preview-timeout-fill" id="previewTimeoutFill" style="width: 100%"></div>
          </div>
          <div class="hint preview-countdown" id="previewCountdownHint">Print or retake within ${secondsLeft}s</div>
        </div>
        <div class="preview-image-wrap">
          <img src="${compositeDataUrl}" alt="Receipt photo strip" class="preview-receipt-img" />
        </div>
      </div>
    `,
    footerLeftHtml: `<div class="small">Order # <b>${orderNumber ?? "--"}</b></div>`,
    footerRightHtml: `
      <button id="retakeBtn" class="btn-text" aria-label="Retake photos">Retake</button>
      <button class="neon-primary" id="printBtn" aria-label="Print receipt">Print</button>
    `,
  });

  const printBtn = document.querySelector("#printBtn");
  const timeoutFill = document.querySelector("#previewTimeoutFill");
  const countdownHint = document.querySelector("#previewCountdownHint");

  previewCountdownTimer = setInterval(() => {
    secondsLeft--;
    const pct = Math.max(0, (secondsLeft / totalSeconds) * 100);
    if (timeoutFill) timeoutFill.style.width = `${pct}%`;
    if (countdownHint) countdownHint.textContent = secondsLeft > 0 ? `Print or retake within ${secondsLeft}s` : "Resetting…";
    if (printBtn) printBtn.textContent = secondsLeft > 0 ? "Print" : "Print";
    if (secondsLeft <= 0) {
      clearPreviewCountdown();
      resetOrder();
    }
  }, 1000);

  document.querySelector("#retakeBtn").addEventListener("click", () => {
    clearPreviewCountdown();
    invalidateCaptureFlow();
    shots = [];
    autoArmed = isAutoMode() ? false : autoArmed;
    renderCamera();
  });

  printBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (printBtn.disabled) return;
    clearPreviewCountdown();

    printBtn.disabled = true;
    printBtn.textContent = "Printing…";

    try {
      const compositeForPrint = await buildCompositeDataUrl(true);
      await doPrint(compositeForPrint, compositeDataUrl);
    } catch (err) {
      console.error("Print error:", err);
      await doPrint(compositeDataUrl, compositeDataUrl);
    } finally {
      printBtn.disabled = false;
      printBtn.textContent = "Print";
    }
  });
}

async function doPrint(compositeDataUrl, previewDataUrl = null) {
  armIdleTimer();

  renderNeonShell({
    topRightHtml: `<div class="badge"><b>3</b> / 3</div>`,
    stageHtml: `
      <div class="neon-card" style="text-align:center;">
        <h2>Printing...</h2>
        <div class="hint">Please wait while we save and print your strip.</div>
        <div style="margin-top:12px; font-size:34px;">🧾</div>
      </div>
    `,
    footerRightHtml: `<button id="cancelBtn" class="btn-text" aria-label="Cancel">Cancel</button>`,
  });

  document.querySelector("#cancelBtn").addEventListener("click", resetOrder);

  try {
    const result = await sendToMacAndPrint(compositeDataUrl);
    const shareUrl = result?.shareUrl;
    const printed = result?.printed === true;
    const printError = result?.printError;

    const title = printed ? "✅ Printed!" : "Saved";
    const subHint = printed
      ? "Resetting for next guest..."
      : "Printer unavailable — check USB and try again. Resetting for next guest...";
    const errHint = printError ? `<div class="hint" style="color:var(--hint);font-size:0.9em;">${escapeHtml(printError)}</div>` : "";

    renderNeonShell({
      topRightHtml: `<div class="badge">Done</div>`,
      stageHtml: `
        <div class="neon-card" style="text-align:center;">
          <h2>${title}</h2>
          <div class="hint">
            ${shareUrl ? `Saved: <a href="${shareUrl}" target="_blank">${shareUrl}</a>` : "Saved on the Mac"}
          </div>
          ${errHint}
          <div class="hint">${subHint}</div>
        </div>
      `,
      footerRightHtml: ``,
    });

    await wait(1500);
    resetOrder();
  } catch (e) {
    renderNeonShell({
      topRightHtml: `<div class="badge">Error</div>`,
      stageHtml: `
        <div class="neon-card">
          <h2>Print failed</h2>
          <div class="hint">${escapeHtml(String(e))}</div>
        </div>
      `,
      footerRightHtml: `
        <button id="restartBtn" aria-label="Start over">Start Over</button>
        <button class="neon-primary" id="backBtn">Back to Preview</button>
      `,
    });

    document.querySelector("#restartBtn").addEventListener("click", resetOrder);
    document.querySelector("#backBtn").addEventListener("click", () => showPreview(previewDataUrl ?? compositeDataUrl));
  }
}

// -------------------- Reset helpers --------------------
function resetSessionOnly() {
  shots = [];
  requiredShots = 0;
  selectedTemplateId = null;
  orderNumber = null;
  orderDate = null;
  autoArmed = false;
}

function resetOrder() {
  invalidateCaptureFlow();
  clearPreviewCountdown();
  resetSessionOnly();
  stopStream();
  renderStart();
}

// -------------------- Utilities --------------------
function stopStream() {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
  stream = null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// -------------------- Idle timer (iPad: warn before reset) --------------------
function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (idleWarningTimer) clearTimeout(idleWarningTimer);
  idleWarningTimer = null;
  if (idleCountdownInterval) clearInterval(idleCountdownInterval);
  idleCountdownInterval = null;
  hideIdleWarning();
}

function hideIdleWarning() {
  if (idleCountdownInterval) clearInterval(idleCountdownInterval);
  idleCountdownInterval = null;
  if (idleWarningOverlay) {
    idleWarningOverlay.remove();
    idleWarningOverlay = null;
  }
}

function showIdleWarning() {
  hideIdleWarning();
  idleWarningOverlay = document.createElement("div");
  idleWarningOverlay.className = "idle-warning-overlay";
  idleWarningOverlay.setAttribute("role", "alert");
  idleWarningOverlay.innerHTML = `
    <div class="idle-warning-card">
      <h3>Resetting in <span id="idleCountdown" class="idle-countdown-num">10</span> seconds</h3>
      <p class="hint">Tap anywhere to stay</p>
      <button class="neon-primary" id="idleStayBtn">Stay</button>
    </div>
  `;
  const dismissAndRearm = () => {
    clearIdleTimer(); /* clears both warning and reset timers */
    armIdleTimer();
  };

  idleWarningOverlay.addEventListener("click", (e) => {
    if (e.target.id === "idleStayBtn" || e.target.closest("#idleStayBtn")) return;
    dismissAndRearm();
  });
  document.getElementById("idleStayBtn")?.addEventListener("click", dismissAndRearm);
  document.body.appendChild(idleWarningOverlay);

  let secondsLeft = 10;
  const countdownEl = document.getElementById("idleCountdown");
  idleCountdownInterval = setInterval(() => {
    secondsLeft--;
    if (countdownEl) countdownEl.textContent = String(Math.max(0, secondsLeft));
    if (secondsLeft <= 0) clearInterval(idleCountdownInterval);
  }, 1000);
}

function armIdleTimer() {
  if (!idleTimerEnabled) {
    clearIdleTimer();
    return;
  }
  clearIdleTimer();
  idleWarningTimer = setTimeout(() => {
    idleWarningTimer = null;
    showIdleWarning();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      hideIdleWarning();
      resetOrder();
    }, 10_000);
  }, IDLE_WARNING_MS);
}

function attachIdleListeners() {
  ["click", "touchstart", "touchmove", "keydown"].forEach((evt) => {
    window.addEventListener(evt, armIdleTimer, { passive: true });
  });
}

// -------------------- Sounds --------------------
function makeBeep({ freq = 880, duration = 0.08, type = "sine", volume = 0.06 } = {}) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (!window.__beepCtx) window.__beepCtx = new AudioCtx();
    const ctx = window.__beepCtx;

    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = volume;

    o.connect(g);
    g.connect(ctx.destination);

    o.start();
    o.stop(ctx.currentTime + duration);
  } catch {
    // ignore
  }
}

function beepTick() {
  makeBeep({ freq: 880, duration: 0.06, type: "sine", volume: 0.06 });
}

function beepShutter() {
  makeBeep({ freq: 520, duration: 0.10, type: "triangle", volume: 0.08 });
}

// -------------------- Orientation (optimized for landscape) --------------------
function initOrientationOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "orientation-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="orientation-prompt">
      <span class="orientation-icon" aria-hidden="true">🔄</span>
      <p>Rotate your iPad to landscape for the best experience</p>
    </div>
  `;
  document.body.appendChild(overlay);

  const mq = window.matchMedia("(orientation: portrait)");
  const update = () => {
    overlay.classList.toggle("visible", mq.matches);
    overlay.setAttribute("aria-hidden", mq.matches ? "false" : "true");
  };
  mq.addEventListener("change", update);
  update();
}

// -------------------- Boot --------------------
initPersistentLanterns();
initOrientationOverlay();
attachIdleListeners();
renderStart();

