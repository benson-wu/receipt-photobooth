import "./missions.css";

const app = document.getElementById("missions-app");
// When hosted on Netlify, set VITE_API_BASE_URL to your backend (e.g. ngrok URL).
const apiBase = typeof import.meta.env.VITE_API_BASE_URL === "string" ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "") : "";

function renderForm() {
  app.innerHTML = `
    <div class="missions-bg" aria-hidden="true"></div>
    <div class="missions-card">
      <h1 class="missions-title">DON'T GET GOT</h1>
      <p class="missions-subtitle">Pocha 31 – Confidential</p>
      <form class="missions-form" id="missions-form" novalidate>
        <label for="name">Your name</label>
        <input type="text" id="name" name="name" placeholder="Enter your name" required autocomplete="name" />
        <button type="submit" class="missions-cta" id="submit-btn">REVEAL MY FATE</button>
      </form>
      <p class="missions-reminder">Do not show anyone.</p>
    </div>
  `;

  const form = document.getElementById("missions-form");
  const submitBtn = document.getElementById("submit-btn");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = (document.getElementById("name").value || "").trim();
    if (!name) return;
    submitBtn.disabled = true;
    submitBtn.textContent = "…";
    try {
      const res = await fetch(`${apiBase}/api/missions/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.blocked) {
        renderBlocked(data.message || "Nice try. Ask the host if you need help.");
        return;
      }
      if (data.error) {
        renderResult(data.missions || [], "error", data.error);
        return;
      }
      renderResult(data.missions || [], "queued", null);
    } catch (err) {
      renderResult([], "error", err.message || "Network error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "REVEAL MY FATE";
    }
  });
}

function renderBlocked(message) {
  app.innerHTML = `
    <div class="missions-bg" aria-hidden="true"></div>
    <div class="missions-card">
      <h1 class="missions-title">DON'T GET GOT</h1>
      <p class="missions-subtitle">Pocha 31 – Confidential</p>
      <div class="missions-blocked">${escapeHtml(message)}</div>
    </div>
  `;
}

function renderResult(missions, printStatus, printError) {
  const statusText =
    printStatus === "queued"
      ? "Your receipt is printing!"
      : printError
        ? "Print failed — but here are your missions. Screenshot this!"
        : "Your receipt is printing!";
  const statusClass = printError ? "error" : "success";

  app.innerHTML = `
    <div class="missions-bg" aria-hidden="true"></div>
    <div class="missions-card">
      <h1 class="missions-title">DON'T GET GOT</h1>
      <p class="missions-subtitle">Pocha 31 – Confidential</p>
      <h2 class="missions-result-title">Your missions</h2>
      <ul class="missions-list">
        ${missions.map((m, i) => `<li><span class="mission-num">MISSION ${i + 1}</span><br/>${escapeHtml(m)}</li>`).join("")}
      </ul>
      <p class="missions-print-status ${statusClass}">${escapeHtml(statusText)}</p>
      <p class="missions-screenshot-hint">Screenshot this page as a backup.</p>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

renderForm();
