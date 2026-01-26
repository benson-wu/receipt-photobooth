import "./style.css";

const app = document.querySelector("#app");

// -------------------- Templates --------------------
const TEMPLATES = [
  { id: "single", name: "1 Photo", shots: 1 },
  { id: "duo", name: "2 Photos", shots: 2 },
  // We'll add 3-shot layout later
  { id: "quad", name: "4 Photos", shots: 4 },
];

// -------------------- State --------------------
let stream = null;
let selectedTemplateId = null;
let shots = [];
let requiredShots = 0;

// -------------------- Screens --------------------
function renderStart() {
  app.innerHTML = `
    <div class="screen mint">
      <div class="header">Pocha 31: Tiff's Birthday Edition</div>

      <div class="stage">
        <div class="card" style="display:grid; place-items:center; padding:24px; text-align:center;">
          <div>
            <div style="font-size:44px; font-weight:800; margin-bottom:10px;">Tap to Start</div>
            <div class="small">Choose a template, then we’ll take photos.</div>
          </div>
        </div>
      </div>

      <div class="footer">
        <button class="primary" id="startBtn">Start</button>
      </div>
    </div>
  `;

  document.querySelector("#startBtn").addEventListener("click", () => {
    selectedTemplateId = null;
    renderTemplateSelect();
  });
}

function renderTemplateSelect() {
  const cardsHtml = TEMPLATES.map(
    (t) => `
    <button class="templateCard ${selectedTemplateId === t.id ? "selected" : ""}" data-id="${t.id}">
      <div class="templateThumb">
        ${renderTemplateThumb(t.id)}
      </div>
      <div class="templateLabel">${t.name}</div>
    </button>
  `
  ).join("");

  app.innerHTML = `
    <div class="screen mint">
      <div class="header">Pocha 31: Tiff's Birthday Edition</div>

      <div class="stage">
        <div class="card" style="padding:16px;">
          <div style="font-size:20px; font-weight:800; margin-bottom:10px;">Choose a template</div>
          <div class="templateGrid">
            ${cardsHtml}
          </div>
          <div class="small" style="margin-top:10px;">Tap one, then Confirm</div>
        </div>
      </div>

      <div class="footer">
        <button id="backBtn">Back</button>
        <button class="primary" id="confirmBtn" ${selectedTemplateId ? "" : "disabled"}>Confirm</button>
      </div>
    </div>
  `;

  document.querySelector("#backBtn").addEventListener("click", renderStart);

  document.querySelectorAll(".templateCard").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedTemplateId = btn.dataset.id;
      renderTemplateSelect(); // re-render
    });
  });

  document.querySelector("#confirmBtn").addEventListener("click", async () => {
    if (!selectedTemplateId) return;
    const t = TEMPLATES.find((x) => x.id === selectedTemplateId);
    requiredShots = t.shots;
    shots = [];
    await startCamera();
    renderCamera();
  });
}

function renderTemplateThumb(id) {
  if (id === "single") return `<div class="thumbBox full"></div>`;
  if (id === "duo")
    return `<div class="thumbBox half"></div><div class="thumbBox half"></div>`;
  if (id === "quad")
    return `
      <div class="thumbRow"><div class="thumbBox half"></div><div class="thumbBox half"></div></div>
      <div class="thumbRow"><div class="thumbBox half"></div><div class="thumbBox half"></div></div>
    `;
  return "";
}

function renderCamera() {
  app.innerHTML = `
    <div class="screen">
      <div class="header">
        Pocha 31: Tiff's Birthday Edition
        <span id="shotLabel" class="shotLabel"></span>
      </div>

      <div class="stage">
        <div class="card">
          <video class="video" id="video" autoplay playsinline></video>
          <div class="overlay" id="countdown" style="display:none;"></div>
        </div>
      </div>

      <div class="footer">
        <button id="cancelBtn">Cancel</button>
        <button class="primary" id="captureBtn">Capture</button>
      </div>
    </div>
  `;

  const video = document.querySelector("#video");
  video.srcObject = stream;

  updateShotLabel();

  document.querySelector("#cancelBtn").addEventListener("click", () => {
    stopStream();
    requiredShots = 0;
    shots = [];
    renderStart();
  });

  document.querySelector("#captureBtn").addEventListener("click", () => {
    captureWithCountdown(video);
  });
}

function updateShotLabel() {
  const el = document.querySelector("#shotLabel");
  if (!el) return;
  el.textContent = requiredShots ? ` • Shot ${shots.length + 1} of ${requiredShots}` : "";
}

// -------------------- Camera + Capture --------------------
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" }, // front camera
      audio: false,
    });
  } catch (err) {
    app.innerHTML = `
      <div class="screen mint">
        <div class="header">Pocha 31: Tiff's Birthday Edition</div>
        <div class="stage">
          <div class="card" style="display:grid; place-items:center; padding:24px; text-align:center;">
            <div>
              <div style="font-size:26px; font-weight:800;">Camera access failed</div>
              <div class="small" style="margin-top:10px;">${escapeHtml(String(err))}</div>
              <div class="small" style="margin-top:10px;">On iPad, you must be on HTTPS (GitHub Pages is perfect).</div>
            </div>
          </div>
        </div>
        <div class="footer">
          <button id="backBtn">Back</button>
        </div>
      </div>
    `;
    document.querySelector("#backBtn").addEventListener("click", renderStart);
    throw err;
  }
}

async function captureWithCountdown(videoEl) {
  const overlay = document.querySelector("#countdown");

  // Countdown
  overlay.style.display = "grid";
  for (let i = 3; i >= 1; i--) {
    overlay.textContent = String(i);
    await wait(650);
  }
  overlay.style.display = "none";

  // Capture frame
  const canvas = document.createElement("canvas");
  const w = videoEl.videoWidth || 1280;
  const h = videoEl.videoHeight || 720;
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, w, h);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  shots.push(dataUrl);

  if (shots.length < requiredShots) {
    renderCamera();
  } else {
    await renderFinalCompositePreview();
  }
}

// -------------------- Composite rendering --------------------
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

async function buildCompositeDataUrl() {
  // Receipt-ish aspect ratio
  const W = 900;
  const H = 1350;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header
  const pad = 30;
  const headerH = 120;
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, W, headerH);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 44px system-ui";
  ctx.fillText("Pocha 31", pad, 70);
  ctx.font = "600 26px system-ui";
  ctx.fillText("Tiff's Birthday Edition", pad, 105);

  // Photo area
  const photoTop = headerH + 20;
  const footerH = 140;
  const photoH = H - photoTop - footerH;
  const photoW = W - pad * 2;
  const photoX = pad;
  const photoY = photoTop;

  const imgs = await Promise.all(shots.map(loadImage));

  if (requiredShots === 1) {
    drawCover(ctx, imgs[0], photoX, photoY, photoW, photoH);
  } else if (requiredShots === 2) {
    const gap = 20;
    const hEach = (photoH - gap) / 2;
    drawCover(ctx, imgs[0], photoX, photoY, photoW, hEach);
    drawCover(ctx, imgs[1], photoX, photoY + hEach + gap, photoW, hEach);
  } else if (requiredShots === 4) {
    const gap = 20;
    const wEach = (photoW - gap) / 2;
    const hEach = (photoH - gap) / 2;
    drawCover(ctx, imgs[0], photoX, photoY, wEach, hEach);
    drawCover(ctx, imgs[1], photoX + wEach + gap, photoY, wEach, hEach);
    drawCover(ctx, imgs[2], photoX, photoY + hEach + gap, wEach, hEach);
    drawCover(ctx, imgs[3], photoX + wEach + gap, photoY + hEach + gap, wEach, hEach);
  } else {
    drawCover(ctx, imgs[0], photoX, photoY, photoW, photoH);
  }

  // Footer
  ctx.fillStyle = "#111827";
  ctx.font = "600 26px system-ui";
  ctx.fillText(new Date().toLocaleString(), pad, H - 70);

  ctx.fillStyle = "#6b7280";
  ctx.font = "500 22px system-ui";
  ctx.fillText("Made with ❤️ for Tiff", pad, H - 35);

  return canvas.toDataURL("image/jpeg", 0.92);
}

async function renderFinalCompositePreview() {
  app.innerHTML = `
    <div class="screen">
      <div class="header">Final Preview</div>
      <div class="stage">
        <div class="card" style="display:grid; place-items:center; padding:24px;">
          <div class="small">Rendering...</div>
        </div>
      </div>
      <div class="footer">
        <button id="restartBtn">Start Over</button>
      </div>
    </div>
  `;

  const compositeDataUrl = await buildCompositeDataUrl();

  app.innerHTML = `
    <div class="screen">
      <div class="header">Final Preview</div>
      <div class="stage">
        <div class="card">
          <img class="photo" src="${compositeDataUrl}" alt="Final composite" />
        </div>
      </div>
      <div class="footer">
        <button id="restartBtn">Start Over</button>
        <button class="primary" id="saveBtn">Save</button>
      </div>
    </div>
  `;

  document.querySelector("#restartBtn").addEventListener("click", () => {
    shots = [];
    requiredShots = 0;
    stopStream();
    renderStart();
  });

  document.querySelector("#saveBtn").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = compositeDataUrl;
    a.download = `pocha31_${new Date().toISOString().replaceAll(":", "-")}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

// -------------------- Helpers --------------------
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

// Boot
renderStart();
