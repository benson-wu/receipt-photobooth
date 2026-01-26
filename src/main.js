import "./style.css";
import QRCode from "qrcode";

const app = document.querySelector("#app");

// -------------------- Templates --------------------
const TEMPLATES = [
  { id: "single", name: "1 Photo", shots: 1 },
  { id: "duo", name: "2 Photos", shots: 2 },
  // We'll add 3-shot layout later
  { id: "quad", name: "4 Photos", shots: 4 },
];

const IDLE_MS = 30_000;

// -------------------- State --------------------
let stream = null;
let selectedTemplateId = null;
let shots = [];
let requiredShots = 0;

// Session metadata (for the "receipt")
let orderNumber = null;
let orderDate = null;
let idleTimer = null;

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
      renderTemplateSelect(); // re-render to show selection
    });
  });

  document.querySelector("#confirmBtn").addEventListener("click", async () => {
    if (!selectedTemplateId) return;

    // New "order" starts here
    orderNumber = String(Math.floor(100000 + Math.random() * 900000));
    orderDate = new Date();

    const t = TEMPLATES.find((x) => x.id === selectedTemplateId);
    requiredShots = t?.shots ?? 0;
    shots = [];

    await startCamera();
    renderCamera();
  });
}

function renderTemplateThumb(id) {
  if (id === "single") return `<div class="thumbBox full"></div>`;
  if (id === "duo") return `<div class="thumbBox half"></div><div class="thumbBox half"></div>`;
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

          <!-- Flash / "Nice!" overlay -->
          <div class="flash" id="flash" style="display:none;">Nice!</div>
        </div>
      </div>

      <div class="footer">
        <button id="cancelBtn">Cancel</button>
        ${shots.length > 0 ? `<button id="retakeBtn">Retake</button>` : ``}
        <button class="primary" id="captureBtn">Capture</button>
      </div>
    </div>
  `;

  const video = document.querySelector("#video");
  video.srcObject = stream;

  updateShotLabel();

  document.querySelector("#cancelBtn").addEventListener("click", () => {
    resetSession();
    stopStream();
    renderStart();
  });

  const retakeBtn = document.querySelector("#retakeBtn");
  if (retakeBtn) {
    retakeBtn.addEventListener("click", () => {
      shots.pop();
      renderCamera(); // re-render to refresh label + button visibility
    });
  }

  document.querySelector("#captureBtn").addEventListener("click", () => {
    captureWithCountdown(video);
  });

  // ✅ kiosk idle timer: any screen render should (re)arm it
  armIdleTimer();
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
              <div class="small" style="margin-top:10px;">
                On iPad, you must be on HTTPS (GitHub Pages works). In party mode, serve the app from your Mac.
              </div>
            </div>
          </div>
        </div>
        <div class="footer">
          <button id="backBtn">Back</button>
        </div>
      </div>
    `;
    document.querySelector("#backBtn").addEventListener("click", () => {
      resetSession();
      renderStart();
    });
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

  // Flash + "Nice!"
  const flash = document.querySelector("#flash");
  if (flash) {
    flash.style.display = "grid";
    await wait(500);
    flash.style.display = "none";
  }

  // Next step
  if (shots.length < requiredShots) {
    renderCamera();
  } else {
    await renderFinalCompositePreview();
  }
}

// -------------------- Composite rendering helpers --------------------
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

// -------------------- Build receipt-style composite --------------------
async function buildCompositeDataUrl() {
  const W = 900;
  const H = 1650;

  const dtStr = (orderDate ?? new Date()).toLocaleString();
  const orderStr = orderNumber ?? "------";

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Paper background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const pad = 40;
  let y = 70;

  // Header
  drawText(ctx, "POCHA 31", pad, y, { size: 44, weight: "900" });
  y += 38;
  drawText(ctx, "Tiff's Birthday Edition", pad, y, { size: 24, weight: "700" });
  y += 40;

  drawText(ctx, `DATE: ${dtStr}`, pad, y, { size: 22, weight: "600" });
  y += 30;
  drawText(ctx, `ORDER #: ${orderStr}`, pad, y, { size: 22, weight: "600" });
  y += 30;

  y += 10;
  drawDashedLine(ctx, pad, y, W - pad);
  y += 35;

  // Fun line items
  const items = [
    ["SOJU ROUND", "1", "12.00"],
    ["TTEOKBOKKI", "1", "9.00"],
    ["KBBQ VIBES", "1", "0.00"],
    ["BIRTHDAY TAX", "1", "31.00"],
  ];

  drawText(ctx, "ITEM             QTY     PRICE", pad, y, { size: 22, weight: "800" });
  y += 30;

  for (const [name, qty, price] of items) {
    const left = String(name).padEnd(16, " ");
    const mid = String(qty).padStart(3, " ");
    const right = String(price).padStart(8, " ");
    drawText(ctx, `${left}  ${mid}  ${right}`, pad, y, { size: 22, weight: "600" });
    y += 28;
  }

  y += 10;
  drawDashedLine(ctx, pad, y, W - pad);
  y += 40;

  // Photo area
  const photoBoxX = pad;
  const photoBoxY = y;
  const photoBoxW = W - pad * 2;
  const photoBoxH = 850;

  const imgs = await Promise.all(shots.map(loadImage));

  if (requiredShots === 1 && imgs[0]) {
    drawCover(ctx, imgs[0], photoBoxX, photoBoxY, photoBoxW, photoBoxH);
  } else if (requiredShots === 2 && imgs.length >= 2) {
    const gap = 20;
    const hEach = (photoBoxH - gap) / 2;
    drawCover(ctx, imgs[0], photoBoxX, photoBoxY, photoBoxW, hEach);
    drawCover(ctx, imgs[1], photoBoxX, photoBoxY + hEach + gap, photoBoxW, hEach);
  } else if (requiredShots === 4 && imgs.length >= 4) {
    const gap = 20;
    const wEach = (photoBoxW - gap) / 2;
    const hEach = (photoBoxH - gap) / 2;
    drawCover(ctx, imgs[0], photoBoxX, photoBoxY, wEach, hEach);
    drawCover(ctx, imgs[1], photoBoxX + wEach + gap, photoBoxY, wEach, hEach);
    drawCover(ctx, imgs[2], photoBoxX, photoBoxY + hEach + gap, wEach, hEach);
    drawCover(ctx, imgs[3], photoBoxX + wEach + gap, photoBoxY + hEach + gap, wEach, hEach);
  } else if (imgs[0]) {
    // fallback
    drawCover(ctx, imgs[0], photoBoxX, photoBoxY, photoBoxW, photoBoxH);
  }

  y = photoBoxY + photoBoxH + 40;
  drawDashedLine(ctx, pad, y, W - pad);
  y += 40;

  // Total + footer
  drawText(ctx, "TOTAL".padEnd(22, " ") + "$52.00", pad, y, { size: 26, weight: "900" });
  y += 40;
  drawText(ctx, "THANK YOU FOR CELEBRATING!", pad, y, { size: 22, weight: "700" });
  y += 30;

  // QR (LAN / hosted link placeholder)
  // In party mode (served by your Mac), this will point to the Mac server page for this order.
  const shareUrl = `${location.origin}/p/${orderStr}`;
  const qrDataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, width: 220 });
  const qrImg = await loadImage(qrDataUrl);

  ctx.drawImage(qrImg, W - pad - 220, y, 220, 220);

  drawText(ctx, "SCAN TO VIEW ORDER", pad, y + 40, { size: 22, weight: "800" });
  drawText(ctx, `URL: /p/${orderStr}`, pad, y + 70, { size: 18, weight: "600", color: "#6b7280" });

  return canvas.toDataURL("image/jpeg", 0.92);
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

// -------------------- Final screen: print + auto reset --------------------
async function renderFinalCompositePreview() {
  // Build composite first
  let compositeDataUrl;
  try {
    compositeDataUrl = await buildCompositeDataUrl();
  } catch (e) {
    app.innerHTML = `
      <div class="screen mint">
        <div class="header">Preview Failed</div>
        <div class="stage">
          <div class="card" style="padding:24px; text-align:center;">
            <div style="font-size:26px; font-weight:900; margin-bottom:10px;">❌ Could not build image</div>
            <div class="small">${escapeHtml(String(e))}</div>
          </div>
        </div>
        <div class="footer">
          <button id="restartBtn">Start Over</button>
        </div>
      </div>
    `;
    document.querySelector("#restartBtn").addEventListener("click", resetOrder);
    return;
  }

  // Preview screen (user confirms printing)
  app.innerHTML = `
    <div class="screen mint">
      <div class="header">Preview</div>
      <div class="stage">
        <div class="card" style="padding:14px;">
          <img class="photo" src="${compositeDataUrl}" alt="Final composite" style="width:100%; display:block; border-radius:12px;" />
          <div class="small" style="margin-top:10px; text-align:center;">
            Order # <b>${orderNumber ?? "—"}</b> • ${orderDate ? orderDate.toLocaleString() : new Date().toLocaleString()}
          </div>
        </div>
      </div>
      <div class="footer">
        <button id="restartBtn">Retake</button>
        <button class="primary" id="printBtn">Print</button>
      </div>
    </div>
  `;

  document.querySelector("#restartBtn").addEventListener("click", () => {
    // Retake: keep same template/order, clear shots only
    shots = [];
    renderCamera();
  });

  document.querySelector("#printBtn").addEventListener("click", async () => {
    // Show printing screen
    app.innerHTML = `
      <div class="screen mint">
        <div class="header">Printing…</div>
        <div class="stage">
          <div class="card" style="padding:24px; text-align:center;">
            <div style="font-size:30px; font-weight:900; margin-bottom:10px;">🧾 Printing your strip</div>
            <div class="small">Please wait…</div>
          </div>
        </div>
        <div class="footer">
          <button id="restartBtn">Cancel</button>
        </div>
      </div>
    `;

    document.querySelector("#restartBtn").addEventListener("click", resetOrder);

    try {
      const result = await sendToMacAndPrint(compositeDataUrl);
      const shareUrl = result?.shareUrl;

      app.innerHTML = `
        <div class="screen mint">
          <div class="header">Done!</div>
          <div class="stage">
            <div class="card" style="padding:24px; text-align:center;">
              <div style="font-size:34px; font-weight:900; margin-bottom:10px;">✅ Printed!</div>
              <div class="small" style="margin-top:8px;">
                ${shareUrl ? `Saved: <a href="${shareUrl}" target="_blank">${shareUrl}</a>` : `Saved on the Mac`}
              </div>
              <div class="small" style="margin-top:12px;">Resetting for next guest…</div>
            </div>
          </div>
        </div>
      `;

      await wait(1500);
      resetOrder();
    } catch (e) {
      app.innerHTML = `
        <div class="screen mint">
          <div class="header">Print Failed</div>
          <div class="stage">
            <div class="card" style="padding:24px; text-align:center;">
              <div style="font-size:26px; font-weight:900; margin-bottom:10px;">❌ Could not print</div>
              <div class="small">${escapeHtml(String(e))}</div>
            </div>
          </div>
          <div class="footer">
            <button id="restartBtn">Start Over</button>
            <button class="primary" id="backPreviewBtn">Back to Preview</button>
          </div>
        </div>
      `;

      document.querySelector("#restartBtn").addEventListener("click", resetOrder);
      document.querySelector("#backPreviewBtn").addEventListener("click", () => {
        // Return to preview without rebuilding
        renderPreviewScreen(compositeDataUrl);
      });
    }
  });

  // Helper: re-render preview without recomputing
  function renderPreviewScreen(dataUrl) {
    app.innerHTML = `
      <div class="screen mint">
        <div class="header">Preview</div>
        <div class="stage">
          <div class="card" style="padding:14px;">
            <img class="photo" src="${dataUrl}" alt="Final composite" style="width:100%; display:block; border-radius:12px;" />
          </div>
        </div>
        <div class="footer">
          <button id="restartBtn">Retake</button>
          <button class="primary" id="printBtn">Print</button>
        </div>
      </div>
    `;
    document.querySelector("#restartBtn").addEventListener("click", () => {
      shots = [];
      renderCamera();
    });
    document.querySelector("#printBtn").addEventListener("click", async () => {
      // call the same print flow
      await renderFinalCompositePreview(); // rebuild is fine for now
    });
  }
}

function resetOrder() {
  shots = [];
  requiredShots = 0;
  selectedTemplateId = null;
  orderNumber = null;
  orderDate = null;
  stopStream();
  renderStart();
}

// -------------------- Helpers --------------------
function resetSession() {
  shots = [];
  requiredShots = 0;
  selectedTemplateId = null;
  orderNumber = null;
  orderDate = null;
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

function resetToStart() {
  resetSession();
  stopStream();
  renderStart();
}

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function armIdleTimer() {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    resetToStart();
  }, IDLE_MS);
}

function attachIdleListeners() {
  // Any interaction should reset the idle timer
  ["click", "touchstart", "touchmove", "keydown"].forEach((evt) => {
    window.addEventListener(evt, armIdleTimer, { passive: true });
  });
}
// Boot
attachIdleListeners();
armIdleTimer();
renderStart();
