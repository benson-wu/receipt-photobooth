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

// idle
let idleTimer = null;

// preview countdown timer
let previewCountdownTimer = null;

// public URL for QR codes (ngrok, etc.)
let publicBaseUrl = null;

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

// Red panda SVG in neon line style with natural colors
let pandaUid = 0;
function redPandaHtml() {
  pandaUid += 1;
  const uid = `panda_${pandaUid}`;
  // Colors matching the red panda drawing: reddish-orange, darker brown, white, black
  const redOrange = "#ff6b35"; // Vibrant reddish-orange for head/back
  const darkBrown = "#cc4125"; // Darker reddish-brown for underbelly/legs/face
  const whiteGlow = "#ffffff"; // White for face patches
  const black = "#000000"; // Black for eyes/nose
  
  return `
    <div class="red-panda" style="position: absolute; bottom: 12%; left: 0; z-index: 2; pointer-events: none;">
      <svg width="100" height="90" viewBox="0 0 100 90" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <filter id="panda-glow-red-${uid}" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="panda-glow-white-${uid}" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        
        <!-- Red panda in neon line style with natural colors -->
        <!-- Head (reddish-orange) -->
        <path d="M 50 20 Q 65 20, 70 30 Q 70 40, 65 45 Q 50 50, 35 45 Q 30 40, 30 30 Q 30 20, 50 20" 
              fill="${redOrange}" fill-opacity="0.15" stroke="${redOrange}" stroke-width="2" filter="url(#panda-glow-red-${uid})" />
        <!-- Face section (darker brown) -->
        <path d="M 40 30 Q 50 35, 60 30 Q 60 42, 50 45 Q 40 42, 40 30" 
              fill="${darkBrown}" fill-opacity="0.2" stroke="${darkBrown}" stroke-width="1.8" filter="url(#panda-glow-red-${uid})" />
        <!-- Left ear (rounded, positioned on side of head) -->
        <path d="M 38 18 Q 35 15, 32 18 Q 32 22, 35 25 Q 38 25, 40 22 Z" 
              fill="${redOrange}" fill-opacity="0.15" stroke="${redOrange}" stroke-width="1.5" filter="url(#panda-glow-red-${uid})" />
        <ellipse cx="36" cy="21" rx="2.5" ry="3" fill="${whiteGlow}" fill-opacity="0.3" stroke="${whiteGlow}" stroke-width="1" filter="url(#panda-glow-white-${uid})" />
        <!-- Right ear (rounded, positioned on side of head) -->
        <path d="M 62 18 Q 65 15, 68 18 Q 68 22, 65 25 Q 62 25, 60 22 Z" 
              fill="${redOrange}" fill-opacity="0.15" stroke="${redOrange}" stroke-width="1.5" filter="url(#panda-glow-red-${uid})" />
        <ellipse cx="64" cy="21" rx="2.5" ry="3" fill="${whiteGlow}" fill-opacity="0.3" stroke="${whiteGlow}" stroke-width="1" filter="url(#panda-glow-white-${uid})" />
        <!-- Body (reddish-orange top, darker brown bottom) -->
        <path d="M 35 50 Q 30 50, 30 55 L 30 70 Q 30 75, 35 75 L 65 75 Q 70 75, 70 70 L 70 55 Q 70 50, 65 50 Z" 
              fill="${redOrange}" fill-opacity="0.15" stroke="${redOrange}" stroke-width="2" filter="url(#panda-glow-red-${uid})" />
        <path d="M 35 60 L 65 60 L 65 75 L 35 75 Z" 
              fill="${darkBrown}" fill-opacity="0.2" stroke="${darkBrown}" stroke-width="1.5" filter="url(#panda-glow-red-${uid})" />
        <!-- Fluffy tail with striped pattern (bushy, filled shape) -->
        <!-- Tail base (wider, connects to body) -->
        <ellipse cx="30" cy="65" rx="6" ry="4" fill="${redOrange}" fill-opacity="0.2" stroke="${redOrange}" stroke-width="2" filter="url(#panda-glow-red-${uid})" transform="rotate(-10 30 65)" />
        <!-- Tail main body (curved, fluffy shape) -->
        <path d="M 26 63 Q 15 58, 10 50 Q 6 42, 7 34 Q 9 26, 14 20 Q 18 16, 22 18" 
              fill="${redOrange}" fill-opacity="0.2" stroke="${redOrange}" stroke-width="2.5" filter="url(#panda-glow-red-${uid})" />
        <!-- Fluffy tail outline (wider, more voluminous) -->
        <path d="M 34 63 Q 18 56, 12 46 Q 8 38, 9 30 Q 11 22, 16 18 Q 20 14, 24 16" 
              fill="none" stroke="${redOrange}" stroke-width="2" stroke-opacity="0.6" filter="url(#panda-glow-red-${uid})" />
        <!-- Tail stripes as bands (darker brown rings - more prominent) -->
        <!-- First stripe band (near base) -->
        <ellipse cx="22" cy="61" rx="6" ry="4" fill="${darkBrown}" fill-opacity="0.7" stroke="${darkBrown}" stroke-width="2.5" filter="url(#panda-glow-red-${uid})" transform="rotate(-12 22 61)" />
        <!-- Second stripe band -->
        <ellipse cx="17" cy="56" rx="6" ry="4" fill="${darkBrown}" fill-opacity="0.7" stroke="${darkBrown}" stroke-width="2.5" filter="url(#panda-glow-red-${uid})" transform="rotate(-18 17 56)" />
        <!-- Third stripe band -->
        <ellipse cx="13" cy="50" rx="6" ry="4" fill="${darkBrown}" fill-opacity="0.7" stroke="${darkBrown}" stroke-width="2.5" filter="url(#panda-glow-red-${uid})" transform="rotate(-24 13 50)" />
        <!-- Fourth stripe band -->
        <ellipse cx="10" cy="43" rx="6" ry="4" fill="${darkBrown}" fill-opacity="0.7" stroke="${darkBrown}" stroke-width="2.5" filter="url(#panda-glow-red-${uid})" transform="rotate(-28 10 43)" />
        <!-- Fifth stripe band -->
        <ellipse cx="8" cy="36" rx="6" ry="4" fill="${darkBrown}" fill-opacity="0.7" stroke="${darkBrown}" stroke-width="2.5" filter="url(#panda-glow-red-${uid})" transform="rotate(-32 8 36)" />
        <!-- Sixth stripe band -->
        <ellipse cx="8" cy="29" rx="6" ry="4" fill="${darkBrown}" fill-opacity="0.7" stroke="${darkBrown}" stroke-width="2.5" filter="url(#panda-glow-red-${uid})" transform="rotate(-36 8 29)" />
        <!-- Seventh stripe band (near tip) -->
        <ellipse cx="11" cy="23" rx="5" ry="3.5" fill="${darkBrown}" fill-opacity="0.7" stroke="${darkBrown}" stroke-width="2.5" filter="url(#panda-glow-red-${uid})" transform="rotate(-40 11 23)" />
        <!-- Face features (black eyes with white outline only) -->
        <ellipse cx="46" cy="32" rx="3" ry="2.5" fill="${whiteGlow}" fill-opacity="0.3" stroke="${whiteGlow}" stroke-width="1.5" filter="url(#panda-glow-white-${uid})" />
        <ellipse cx="54" cy="32" rx="3" ry="2.5" fill="${whiteGlow}" fill-opacity="0.3" stroke="${whiteGlow}" stroke-width="1.5" filter="url(#panda-glow-white-${uid})" />
        <circle cx="46" cy="32" r="2" fill="${black}" fill-opacity="0.9" filter="url(#panda-glow-red-${uid})" />
        <circle cx="54" cy="32" r="2" fill="${black}" fill-opacity="0.9" filter="url(#panda-glow-red-${uid})" />
        <!-- Nose (small triangle/ellipse) -->
        <ellipse cx="50" cy="37" rx="1.5" ry="1" fill="${black}" fill-opacity="0.8" filter="url(#panda-glow-red-${uid})" />
        <!-- Mouth (subtle upward-curving smile) -->
        <path d="M 47 39 Q 50 40.5, 53 39" 
              stroke="${black}" stroke-width="1.5" fill="none" stroke-linecap="round" filter="url(#panda-glow-red-${uid})" />
        <!-- Front legs (darker brown) -->
        <ellipse cx="42" cy="68" rx="3" ry="6" fill="${darkBrown}" fill-opacity="0.2" stroke="${darkBrown}" stroke-width="1.5" filter="url(#panda-glow-red-${uid})" />
        <ellipse cx="58" cy="68" rx="3" ry="6" fill="${darkBrown}" fill-opacity="0.2" stroke="${darkBrown}" stroke-width="1.5" filter="url(#panda-glow-red-${uid})" />
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
function renderNeonShell({ topRightHtml = "", stageHtml = "", footerLeftHtml = "", footerRightHtml = "" }) {
  // Ensure persistent lanterns are initialized (they stay in body, never destroyed)
  initPersistentLanterns();
  
  app.innerHTML = `
    <div class="neon-shell">
      <div class="bg-atmosphere"></div>
      <div class="neon-glow pink"></div>
      <div class="neon-glow blue"></div>
      <div class="scanlines"></div>

      <div class="neon-wrap">
        <div class="neon-topbar">
          <div class="brand">
            <div class="title">Tiff's 31st Pocha</div>
            <div class="sub">Receipt Photobooth</div>
          </div>
          <div>${topRightHtml}</div>
        </div>

        <div class="neon-stage">
          ${stageHtml}
        </div>

        <div class="neon-footer">
          <div>${footerLeftHtml}</div>
          <div style="display:flex; gap:10px; align-items:center;">${footerRightHtml}</div>
        </div>
      </div>
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

        <button class="neon-cta" id="startBtn">
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
  armIdleTimer();

  const cardsHtml = TEMPLATES.map(
    (t) => `
      <button class="templateCard ${selectedTemplateId === t.id ? "selected" : ""}" data-id="${t.id}">
        <div class="templateThumb">
          ${renderTemplateThumb(t.id)}
        </div>
        <div class="templateLabel">${t.name}</div>
        <div class="small" style="margin-top:6px;">
          ${t.shots >= 2 ? `Auto mode (press Start, then ${COUNTDOWN_SECONDS}s countdown)` : `Manual mode (tap Capture)`}
        </div>
      </button>
    `
  ).join("");

  renderNeonShell({
    topRightHtml: `<div class="badge">Step <b>1</b> of <b>3</b></div>`,
    stageHtml: `
      <div class="neon-card">
        <h2>Choose your layout</h2>
        <div class="hint">Pick a template. For 2+ shots you'll press Start, then we'll auto-capture with a countdown.</div>
        <div class="templateGrid">${cardsHtml}</div>
      </div>
    `,
    // footerLeftHtml: `<div class="small">Tip: iPad landscape is best.</div>`,
    footerRightHtml: `
      <button id="backBtn">Back</button>
      <button class="neon-primary" id="confirmBtn" ${selectedTemplateId ? "" : "disabled"}>Confirm</button>
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
    autoArmed = false; // NEW: require Start for 2+ templates

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
    topRightHtml: `<div class="badge" id="shotBadge">Shot <b>${shots.length + 1}</b> of <b>${requiredShots}</b></div>`,
    stageHtml: `
      <div class="cameraCard" style="opacity: 0;">
        <video class="video" id="video" autoplay playsinline webkit-playsinline muted disablepictureinpicture style="opacity: 0;"></video>
        <div class="overlay" id="countdown" style="display:none;"></div>
        <div class="flash" id="flash" style="display:none;">Nice!</div>
        <div class="status" id="status" style="display:${needsStart ? "grid" : "none"};">
          ${needsStart ? "Press Start when you're ready 📸" : ""}
        </div>
      </div>
      <div class="small" style="margin-top:12px; text-align:center;">
        ${auto ? `Auto mode • ${COUNTDOWN_SECONDS}s countdown` : `Manual mode • tap Capture`}
      </div>
    `,
    footerLeftHtml: `<div class="small">Order # <b>${orderNumber ?? "--"}</b></div>`,
    footerRightHtml: `
      <button id="cancelBtn">Cancel</button>
      ${
        auto
          ? (needsStart ? `<button class="neon-primary" id="startAutoBtn">Start</button>` : ``)
          : `<button class="neon-primary" id="captureBtn">Capture</button>`
      }
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
  
  // Update video preview to match video aspect ratio exactly (no black bars)
  const updateVideoAspect = () => {
    if (video.videoWidth && video.videoHeight) {
      const videoAspect = video.videoWidth / video.videoHeight;
      
      // Set cameraCard to match the video's aspect ratio exactly
      if (cameraCard) {
        // Remove any height constraints that might interfere
        cameraCard.style.maxHeight = "none";
        cameraCard.style.height = "auto";
        
        // Set aspect ratio to match video exactly
        cameraCard.style.aspectRatio = `${videoAspect}`;
        
        // Ensure width doesn't exceed container, let height adjust naturally based on aspect ratio
        cameraCard.style.width = "min(860px, 100%)";
        cameraCard.style.maxWidth = "100%";
      }
      
      // Use object-fit: contain to show full video without cropping
      // Since container aspect ratio matches video, there will be no black bars
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
      footerRightHtml: `<button id="backBtn">Back</button>`,
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

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    shots.push(dataUrl);

    // Flash
    const flash = document.querySelector("#flash");
    if (flash) {
      flash.style.display = "grid";
      await wait(420);
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
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

// -------------------- Build receipt composite --------------------
async function buildCompositeDataUrl() {
  // 80mm thermal printer width: render at higher resolution for better quality
  // 80mm at 203 DPI (typical thermal printer) = ~640px, but we'll use 900px for crisp rendering
  // The server can scale down to actual printer resolution when printing
  const W = 900;
  const H = 1750; // Increased to accommodate buffer space below QR code (will grow as needed)

  const dtStr = (orderDate ?? new Date()).toLocaleString();
  const orderStr = orderNumber ?? "------";

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 3000; // Start with large height, will be trimmed at the end
  const ctx = canvas.getContext("2d");

  // Fill the entire canvas with white background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, 3000);

  // Scale padding and text sizes proportionally for higher resolution
  const pad = 36; // Scaled up from 12 (3x)
  let y = 60; // Scaled up from 20

  drawText(ctx, "TIFF'S 31ST POCHA", pad, y, { size: 42, weight: "900" }); // Scaled from 14
  y += 36; // Scaled from 12
  // drawText(ctx, "Tiff's Birthday Edition", pad, y, { size: 30, weight: "700" }); // Scaled from 10
  // y += 36; // Scaled from 12

  drawText(ctx, `DATE: ${dtStr}`, pad, y, { size: 27, weight: "600" }); // Scaled from 9
  y += 30; // Scaled from 10
  drawText(ctx, `ORDER #: ${orderStr}`, pad, y, { size: 27, weight: "600" }); // Scaled from 9
  y += 30; // Scaled from 10

  y += 15; // Scaled from 5
  drawDashedLine(ctx, pad, y, W - pad);
  y += 36; // Scaled from 12

  const items = [
    ["FRIED CHICKEN", "1", "8.49"],
    ["TTEOKBOKKI", "1", "7.25"],
    ["DYNAMITE SPRITZ", "1", "6.96"],
    ["KOGI DOG", "1", "8.99"],
  ];

  // Calculate total from items
  const total = items.reduce((sum, [, , price]) => sum + parseFloat(price), 0);
  const totalStr = total.toFixed(2);

  drawText(ctx, "ITEM             QTY     PRICE", pad, y, { size: 24, weight: "800" }); // Scaled from 8
  y += 30; // Scaled from 10

  for (const [name, qty, price] of items) {
    const left = String(name).padEnd(16, " ");
    const mid = String(qty).padStart(3, " ");
    const right = String(price).padStart(8, " ");
    drawText(ctx, `${left}  ${mid}  ${right}`, pad, y, { size: 24, weight: "600" }); // Scaled from 8
    y += 27; // Scaled from 9
  }

  y += 15; // Scaled from 5
  drawDashedLine(ctx, pad, y, W - pad);
  y += 36; // Scaled from 12

  const photoBoxX = pad;
  const photoBoxY = y;
  const photoBoxW = W - pad * 2;
  // Photo box height will be calculated based on template

  const imgs = await Promise.all(shots.map(loadImage));

  let photoBoxH = 0; // Will be calculated based on layout

  if (requiredShots === 1 && imgs[0]) {
    // Single photo: use aspect ratio to determine height
    const imgAspect = imgs[0].width / imgs[0].height;
    photoBoxH = photoBoxW / imgAspect;
    drawCover(ctx, imgs[0], photoBoxX, photoBoxY, photoBoxW, photoBoxH);
  } else if (requiredShots === 2 && imgs.length >= 2) {
    // Two photos: vertical stack (photo strip layout)
    const gap = 12; // Scaled from 4
    // Calculate height for each photo based on aspect ratio
    const imgAspect = imgs[0].width / imgs[0].height;
    const hEach = photoBoxW / imgAspect;
    photoBoxH = hEach * 2 + gap;
    drawCover(ctx, imgs[0], photoBoxX, photoBoxY, photoBoxW, hEach);
    drawCover(ctx, imgs[1], photoBoxX, photoBoxY + hEach + gap, photoBoxW, hEach);
  } else if (requiredShots === 4 && imgs.length >= 4) {
    // Four photos: 2x2 grid
    const gap = 12; // Scaled from 4
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

  // Ensure photoBoxH is valid (fallback if no images)
  if (photoBoxH === 0) {
    photoBoxH = 600; // Default height if no photos (scaled from 200)
  }

  y = photoBoxY + photoBoxH + 36; // Scaled from 12
  drawDashedLine(ctx, pad, y, W - pad);
  y += 36; // Scaled from 12

  drawText(ctx, "TOTAL".padEnd(22, " ") + `$${totalStr}`, pad, y, { size: 30, weight: "900" }); // Scaled from 10
  y += 36; // Scaled from 12
  drawText(ctx, "THANK YOU FOR CELEBRATING!", pad, y, { size: 27, weight: "700" }); // Scaled from 9
  y += 45; // Scaled from 15

  const base = await getPublicBaseUrl();
  const shareUrl = `${base}/share/${orderNumber}`;

  // Scale QR code proportionally (larger for higher resolution)
  const qrSize = 240; // Scaled from 80 (3x)
  const qrDataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, width: qrSize });
  const qrImg = await loadImage(qrDataUrl);

  // Center the QR code horizontally
  const qrX = (W - qrSize) / 2;
  ctx.drawImage(qrImg, qrX, y, qrSize, qrSize);
  y += qrSize;

  // Center "SCAN TO DOWNLOAD" text below QR code
  const scanText = "SCAN TO DOWNLOAD";
  ctx.font = "800 24px ui-monospace, SFMono-Regular, Menlo, monospace"; // Scaled from 8
  const scanTextWidth = ctx.measureText(scanText).width;
  const scanTextX = (W - scanTextWidth) / 2;
  // Draw text with some spacing below QR code
  y += 24; // Space between QR code and text (scaled from 8)
  drawText(ctx, scanText, scanTextX, y, { size: 24, weight: "800" }); // Scaled from 8
  
  // Add significant white space buffer below text (before bottom of receipt)
  y += 36; // Space for text height (scaled from 12)
  y += 60; // Buffer space below QR code section (scaled from 20)

  // Create a new canvas with the correct final height and copy the content
  const finalCanvas = document.createElement("canvas");
  finalCanvas.width = W;
  finalCanvas.height = y;
  const finalCtx = finalCanvas.getContext("2d");
  
  // Fill the final canvas with white background first
  finalCtx.fillStyle = "#ffffff";
  finalCtx.fillRect(0, 0, W, y);
  
  // Copy the drawn content to the final canvas
  finalCtx.drawImage(canvas, 0, 0);

  return finalCanvas.toDataURL("image/jpeg", 0.92);
}

// -------------------- Print (send to Mac) --------------------
async function sendToMacAndPrint(compositeDataUrl) {
  const res = await fetch("/api/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderNumber: orderNumber ?? "------",
      imageDataUrl: compositeDataUrl,
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
      footerRightHtml: `<button class="neon-primary" id="restartBtn">Start Over</button>`,
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
    footerRightHtml: `<button id="cancelBtn">Cancel</button>`,
  });

  document.querySelector("#cancelBtn")?.addEventListener("click", resetOrder);

  try {
    // This endpoint already saves on the Mac; printing can remain a later step.
    await sendToMacAndPrint(compositeDataUrl);
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
  armIdleTimer();
  clearPreviewCountdown(); // Clear any existing timer

  let secondsLeft = PREVIEW_TIMEOUT_SECONDS;

  renderNeonShell({
    topRightHtml: `<div class="badge">Step <b>2</b> of <b>3</b></div>`,
    stageHtml: `
      <div class="neon-card previewCard">
        <div>
          <h2 style="margin:0 0 6px;">Preview</h2>
          <div class="hint" style="margin:0 0 12px;">
            Scroll the receipt inside the card if needed. (The page itself won't scroll.)
          </div>
        </div>

        <div class="previewScroll">
          <img src="${compositeDataUrl}" alt="Final composite" />
        </div>

        <div class="small">
          Order # <b>${orderNumber ?? "--"}</b> • ${orderDate ? orderDate.toLocaleString() : new Date().toLocaleString()}
        </div>
      </div>
    `,
    footerLeftHtml: `<div class="small">Retake clears shots but keeps template.</div>`,
    footerRightHtml: `
      <button id="retakeBtn">Retake</button>
      <button class="neon-primary" id="printBtn">Print (${secondsLeft}s)</button>
    `,
  });

  const printBtn = document.querySelector("#printBtn");

  // Start countdown timer
  previewCountdownTimer = setInterval(() => {
    secondsLeft--;
    if (printBtn) {
      printBtn.textContent = `Print (${secondsLeft}s)`;
    }

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

  printBtn.addEventListener("click", () => {
    clearPreviewCountdown();
    doPrint(compositeDataUrl);
  });
}

async function doPrint(compositeDataUrl) {
  armIdleTimer();

  renderNeonShell({
    topRightHtml: `<div class="badge">Step <b>3</b> of <b>3</b></div>`,
    stageHtml: `
      <div class="neon-card" style="text-align:center;">
        <h2>Printing...</h2>
        <div class="hint">Please wait while we save and print your strip.</div>
        <div style="margin-top:12px; font-size:34px;">🧾</div>
      </div>
    `,
    footerRightHtml: `<button id="cancelBtn">Cancel</button>`,
  });

  document.querySelector("#cancelBtn").addEventListener("click", resetOrder);

  try {
    const result = await sendToMacAndPrint(compositeDataUrl);
    const shareUrl = result?.shareUrl;

    renderNeonShell({
      topRightHtml: `<div class="badge">Done</div>`,
      stageHtml: `
        <div class="neon-card" style="text-align:center;">
          <h2>✅ Printed!</h2>
          <div class="hint">
            ${shareUrl ? `Saved: <a href="${shareUrl}" target="_blank">${shareUrl}</a>` : `Saved on the Mac`}
          </div>
          <div class="hint">Resetting for next guest...</div>
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
        <button id="restartBtn">Start Over</button>
        <button class="neon-primary" id="backBtn">Back to Preview</button>
      `,
    });

    document.querySelector("#restartBtn").addEventListener("click", resetOrder);
    document.querySelector("#backBtn").addEventListener("click", () => showPreview(compositeDataUrl));
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

// -------------------- Idle timer --------------------
function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function armIdleTimer() {
  clearIdleTimer();
  idleTimer = setTimeout(() => resetOrder(), IDLE_MS);
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

// -------------------- Boot --------------------
// Initialize persistent lanterns first (they'll persist across all page changes)
initPersistentLanterns();
attachIdleListeners();
armIdleTimer();
renderStart();

