import "./style.css";

const app = document.querySelector("#app");

let stream = null;
let lastPhotoDataUrl = null;

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

  document.querySelector("#startBtn").addEventListener("click", startCamera);
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
        <div class="header">Receipt Photobooth</div>
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
      <div class="header">Pocha 31: Tiff's Birthday Edition</div>
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

  // ✅ click handlers go here (AFTER innerHTML)
  document.querySelector("#cancelBtn").addEventListener("click", () => {
    stopStream();
    renderStart();
  });

  document.querySelector("#captureBtn").addEventListener("click", () => {
    captureWithCountdown(video);
  });
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

  lastPhotoDataUrl = canvas.toDataURL("image/jpeg", 0.92);
  renderPreview();
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
