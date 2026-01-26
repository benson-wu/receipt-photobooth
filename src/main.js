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
let requiredShots = 0;

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

function renderPreview() {
  app.innerHTML = `
    <div class="screen">
      <div class="header">Preview</div>
      <div class="stage">
        <div class="card">
          <img class="photo" src="${lastPhotoDataUrl}" alt="Captured photo" />
        </div>
      </div>
      <div class="footer">
        <button id="retakeBtn">Retake</button>
        <button class="primary" id="saveBtn">Save</button>
      </div>
    </div>
  `;

  document.querySelector("#retakeBtn").addEventListener("click", renderCamera);
  document.querySelector("#saveBtn").addEventListener("click", savePhoto);
}

function renderFinalCompositePreview() {
  app.innerHTML = `
    <div class="screen">
      <div class="header">Done!</div>
      <div class="stage">
        <div class="card" style="display:grid; place-items:center; padding:24px; text-align:center;">
          <div>
            <div style="font-size:28px; font-weight:800;">Captured ${shots.length} photos</div>
            <div class="small" style="margin-top:8px;">Next: stitch into one image</div>
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
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
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
