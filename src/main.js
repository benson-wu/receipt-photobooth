import "./style.css";

const app = document.querySelector("#app");

const TEMPLATES = [
  {
    id: "single",
    name: "1 Photo",
    shots: 1,
    // later: layout renderer
  },
  {
    id: "duo",
    name: "2 Photos",
    shots: 2,
  },
  {
    id: "trio",
    name: "3 Photos",
    shots: 3,
  },
  {
    id: "quad",
    name: "4 Photos",
    shots: 4,
  },
];

let stream = null;
let lastPhotoDataUrl = null;
let selectedTemplateId = null;
let shots = [];
let requiredShots = 2;

function renderTemplateSelect() {
  const cardsHtml = TEMPLATES.map(t => `
    <button class="templateCard ${selectedTemplateId === t.id ? "selected" : ""}" data-id="${t.id}">
      <div class="templateThumb">
        ${renderTemplateThumb(t.id)}
      </div>
      <div class="templateLabel">${t.name}</div>
    </button>
  `).join("");

  app.innerHTML = `
    <div class="screen mint">
      <div class="header">Pocha 31: Tiff's Birthday Edition</div>

      <div class="stage">
        <div class="card" style="padding:16px;">
          <div style="font-size:20px;font-weight:800;margin-bottom:10px;">Choose a template</div>
          <div class="templateGrid">
            ${cardsHtml}
          </div>
          <div class="small" style="margin-top:10px;">Slide/scroll if needed</div>
        </div>
      </div>

      <div class="footer">
        <button id="backBtn">Back</button>
        <button class="primary" id="confirmBtn" ${selectedTemplateId ? "" : "disabled"}>Confirm</button>
      </div>
    </div>
  `;

  document.querySelector("#backBtn").addEventListener("click", renderStart);

  document.querySelectorAll(".templateCard").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedTemplateId = btn.dataset.id;
      renderTemplateSelect(); // re-render to show selection
    });
  });

  document.querySelector("#confirmBtn").addEventListener("click", () => {
    if (!selectedTemplateId) return;
    const t = TEMPLATES.find(x => x.id === selectedTemplateId);
    requiredShots = t.shots;
    shots = [];
    startCameraForTemplate();
  });
}

function renderTemplateThumb(id) {
  if (id === "single") return `<div class="thumbBox full"></div>`;
  if (id === "duo") return `<div class="thumbBox half"></div><div class="thumbBox half"></div>`;
  if (id === "trio") return `<div class="thumbBox wide"></div><div class="thumbRow"><div class="thumbBox half"></div><div class="thumbBox half"></div></div>`;
  if (id === "quad") return `<div class="thumbRow"><div class="thumbBox half"></div><div class="thumbBox half"></div></div><div class="thumbRow"><div class="thumbBox half"></div><div class="thumbBox half"></div></div>`;
  return "";
}

async function startCameraForTemplate() {
  await startCamera();       // your existing function that sets `stream`
  renderCamera();            // show camera UI
  updateShotLabel();         // add “Shot 1 of N”
}

function renderStart() {
  app.innerHTML = `
    <div class="screen">
      <div class="header">Pocha 31: Tiff's Birthday Edition</div>
      <div class="stage">
        <div class="card" style="display:grid; place-items:center; padding:24px; text-align:center;">
          <div>
            <div style="font-size:44px; font-weight:800; margin-bottom:10px;">Tap to Start</div>
            <div class="small">We’ll ask for camera permission.</div>
          </div>
        </div>
      </div>
      <div class="footer">
        <button class="primary" id="startBtn">Start</button>
      </div>
    </div>
  `;

  document.querySelector("#startBtn").addEventListener("click", renderTemplateSelect);
}

async function startCamera() {
  try {
    // Prefer the back camera on iPad/iPhone
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false,
    });

    renderCamera();
  } catch (err) {
    app.innerHTML = `
      <div class="screen">
        <div class="header">
          Pocha 31: Tiff's Birthday Edition
          <span id="shotLabel" class="shotLabel"></span>
        </div>
        <div class="stage">
          <div class="card" style="display:grid; place-items:center; padding:24px; text-align:center;">
            <div>
              <div style="font-size:28px; font-weight:800; margin-bottom:10px;">Camera access failed</div>
              <div class="small">${escapeHtml(String(err))}</div>
              <div class="small" style="margin-top:10px;">
                On iPad, this must be served over HTTPS (GitHub Pages works great).
              </div>
            </div>
          </div>
        </div>
        <div class="footer">
          <button id="backBtn">Back</button>
        </div>
      </div>
    `;
    document.querySelector("#backBtn").addEventListener("click", renderStart);
  }
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

  updateShotLabel(); // <-- set "Shot X of N" text

  document.querySelector("#cancelBtn").addEventListener("click", () => {
    stopStream();
    renderStart();
  });

  document.querySelector("#captureBtn").addEventListener("click", () => {
    captureWithCountdown(video);
  });
}

function updateShotLabel() {
  const el = document.querySelector("#shotLabel");
  if (!el) return;

  if (!requiredShots) {
    el.textContent = "";
    return;
  }

  el.textContent = ` • Shot ${shots.length + 1} of ${requiredShots}`;
}

async function captureWithCountdown(videoEl) {
  const overlay = document.querySelector("#countdown");

  // 3..2..1 countdown
  overlay.style.display = "grid";
  for (let i = 3; i >= 1; i--) {
    overlay.textContent = String(i);
    await wait(650);
  }
  overlay.style.display = "none";

  // Capture current frame to a canvas
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
    renderFinalCompositePreview();
  }

}

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

  // Footer text
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

  let compositeDataUrl;
  try {
    compositeDataUrl = await buildCompositeDataUrl();
  } catch (e) {
    app.innerHTML = `
      <div class="screen">
        <div class="header">Final Preview</div>
        <div class="stage">
          <div class="card" style="display:grid; place-items:center; padding:24px; text-align:center;">
            <div>
              <div style="font-size:22px;font-weight:800;">Failed to render composite</div>
              <div class="small" style="margin-top:8px;">${String(e)}</div>
            </div>
          </div>
        </div>
        <div class="footer">
          <button id="restartBtn">Start Over</button>
        </div>
      </div>
    `;
    document.querySelector("#restartBtn").addEventListener("click", () => {
      shots = [];
      requiredShots = 0;
      stopStream();
      renderStart();
    });
    return;
  }

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
    // image is wider than box: crop left/right
    sh = img.height;
    sw = sh * boxAspect;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    // image is taller than box: crop top/bottom
    sw = img.width;
    sh = sw / boxAspect;
    sx = 0;
    sy = (img.height - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function buildCompositeDataUrl() {
  // Receipt-ish aspect ratio. You can tweak these later.
  const W = 900;
  const H = 1350;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header bar
  const pad = 30;
  const headerH = 120;
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, W, headerH);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 44px system-ui";
  ctx.fillText("Pocha 31", pad, 70);

  ctx.font = "600 26px system-ui";
  ctx.fillText("Tiff's Birthday Edition", pad, 105);

  // Photo area bounds
  const photoTop = headerH + 20;
  const photoBottomPad = 140; // space for footer text
  const photoH = H - photoTop - photoBottomPad;
  const photoW = W - pad * 2;
  const photoX = pad;
  const photoY = photoTop;

  // Load images
  const imgs = await Promise.all(shots.map(loadImage));

  // Layouts
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
    // fallback: just show the first photo full
    drawCover(ctx, imgs[0], photoX, photoY, photoW, photoH);
  }

  // Footer
  ctx.fillStyle = "#111827";
  ctx.font = "600 26px system-ui";
  const ts = new Date().toLocaleString();
  ctx.fillText(ts, pad, H - 70);

  ctx.font = "500 22px system-ui";
  ctx.fillStyle = "#6b7280";
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

  // Build composite
  const compositeDataUrl = await buildCompositeDataUrl();

  // Render final image
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
    renderStart(); // or renderTemplateSelect if you prefer
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


function savePhoto() {
  // Trigger a download. On iPad Safari, this may open the share sheet or show the image.
  const a = document.createElement("a");
  a.href = lastPhotoDataUrl;
  a.download = `photobooth_${new Date().toISOString().replaceAll(":", "-")}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

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

renderStart();
