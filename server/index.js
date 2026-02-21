// server/index.js
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const express = require("express");
const { promisify } = require("util");
const sharp = require("sharp");
const getPixels = require("get-pixels");
const escpos = require("escpos");
escpos.USB = require("escpos-usb");
const { addJob, waitForJob, setProcessor } = require("./print-queue");

const getPixelsAsync = promisify(getPixels);

const app = express();
const PORT = process.env.PORT || 3000;

// If set, share/QR links will use this public base (e.g. https://xxxx.ngrok-free.app)
// Otherwise the server will try to auto-discover from ngrok's local API (127.0.0.1:4040).
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL
  ? String(process.env.PUBLIC_BASE_URL).replace(/\/$/, "")
  : null;

let discoveredNgrokUrl = null;

function fetchNgrokPublicUrl() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:4040/api/tunnels", (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          const tunnels = data.tunnels || [];
          const httpsTunnel = tunnels.find((t) => t.proto === "https" && t.public_url);
          const url = httpsTunnel ? String(httpsTunnel.public_url).replace(/\/$/, "") : null;
          resolve(url);
        } catch (_) {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(3000, () => { req.destroy(); resolve(null); });
  });
}

async function ensureNgrokDiscovered() {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  if (discoveredNgrokUrl) return discoveredNgrokUrl;
  const url = await fetchNgrokPublicUrl();
  if (url) discoveredNgrokUrl = url;
  return url;
}

const DIST_DIR = path.join(__dirname, "..", "dist");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

const CERT_PATH = path.join(__dirname, "certs", "cert.pem");
const KEY_PATH = path.join(__dirname, "certs", "key.pem");

// Where we save images on the Mac:
const SAVED_DIR = path.join(__dirname, "saved");
const DATA_DIR = path.join(__dirname, "data");
const MISSIONS_PATH = path.join(DATA_DIR, "missions.json");
const ISSUANCE_PATH = path.join(DATA_DIR, "issuance.json");
fs.mkdirSync(SAVED_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadMissions() {
  try {
    const raw = fs.readFileSync(MISSIONS_PATH, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (data && data.tier1 && data.tier2 && data.tier3 && data.bonus) {
      return data;
    }
    return [];
  } catch (e) {
    console.warn("Could not load missions.json:", e.message);
    return [];
  }
}

function loadMissionsTiers() {
  const data = loadMissions();
  if (!data || !data.tier1) return null;
  return {
    tier1: data.tier1,
    tier2: data.tier2,
    tier3: data.tier3,
    bonus: data.bonus,
  };
}

function getTodayDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function countTodayIssuances() {
  const today = getTodayDateKey();
  const list = loadIssuance();
  return list.filter((e) => {
    const t = e.timestamp || e.date || "";
    if (!t) return false;
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return false;
    const issuedDateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return issuedDateKey === today;
  }).length;
}

function loadIssuance() {
  try {
    if (!fs.existsSync(ISSUANCE_PATH)) return [];
    const raw = fs.readFileSync(ISSUANCE_PATH, "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function appendIssuance(entry) {
  const list = loadIssuance();
  list.push(entry);
  fs.writeFileSync(ISSUANCE_PATH, JSON.stringify(list, null, 2), "utf8");
}


// 80mm thermal receipt: scale to fit printable width (288px leaves margin so QR stays centered)
const THERMAL_WIDTH_PX = 288;

/**
 * Send image buffer to the first connected USB thermal printer (ESC/POS).
 * Resizes to THERMAL_WIDTH_PX, converts to 1-bit B&W for thermal, then prints.
 */
async function printToThermal(imageBuffer) {
  let device = null;
  try {
    const devices = escpos.USB.findPrinter();
    if (!devices || devices.length === 0) {
      return { printed: false, error: "No USB printer found" };
    }
    device = new escpos.USB(devices[0]);
    await new Promise((resolve, reject) => {
      device.open((err) => (err ? reject(err) : resolve()));
    });
    const printer = await escpos.Printer.create(device);

    // Resize to fit 80mm paper, grayscale, gamma (1–3) + brightness to lift shadows (decrease blacks)
    const bwPng = await sharp(imageBuffer)
      .resize(THERMAL_WIDTH_PX, null, { withoutEnlargement: true })
      .greyscale()
      .gamma(3.0)
      .modulate({ brightness: 1.08 })
      .png({ colours: 2, dither: 1 })
      .toBuffer();
    const pixels = await getPixelsAsync(bwPng, "image/png");
    const escposImage = new escpos.Image(pixels);

    printer.align("ct").raster(escposImage, "dwdh").feed(2).cut();
    await new Promise((resolve, reject) => {
      printer.flush((err) => (err ? reject(err) : resolve()));
    });
    await new Promise((resolve, reject) => {
      device.close((err) => (err ? reject(err) : resolve()));
    });
    return { printed: true };
  } catch (e) {
    if (device) {
      try {
        device.close(() => {});
      } catch (_) {}
    }
    return { printed: false, error: e && e.message ? e.message : String(e) };
  }
}

// 80mm thermal: wrap at word boundaries. 48 chars = typical max width for 80mm.
const RECEIPT_CHARS_PER_LINE = 48;

function wordWrapLine(line, maxLen = RECEIPT_CHARS_PER_LINE) {
  const trimmed = line.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/);
  const result = [];
  let current = "";
  for (const word of words) {
    const withSpace = current ? current + " " + word : word;
    if (withSpace.length <= maxLen) {
      current = withSpace;
    } else {
      if (current) result.push(current);
      if (word.length <= maxLen) {
        current = word;
      } else {
        for (let i = 0; i < word.length; i += maxLen) {
          result.push(word.slice(i, i + maxLen));
        }
        current = "";
      }
    }
  }
  if (current) result.push(current);
  return result;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Receipt paper width in px for mission image (match thermal print width). */
const MISSION_RECEIPT_WIDTH = THERMAL_WIDTH_PX;
const MISSION_LINE_HEIGHT = 14;
const MISSION_FONT_SIZE = 11;
const MISSION_PAD = 16;
/** Max chars per line so wrapped text fits in MISSION_RECEIPT_WIDTH (avoids mid-word clip). */
const MISSION_CHARS_PER_LINE = 38;

/**
 * Render mission receipt text to a PNG image buffer. Uses the same print path as the
 * photobooth (raster image) so the receipt is never cut off by text buffer limits.
 */
async function receiptTextToImageBuffer(textContent) {
  const inputLines = String(textContent).split(/\r?\n/).filter(Boolean);
  const lines = inputLines.flatMap((line) => wordWrapLine(line, MISSION_CHARS_PER_LINE));
  const height = Math.max(200, lines.length * MISSION_LINE_HEIGHT + MISSION_PAD * 2);
  const width = MISSION_RECEIPT_WIDTH;

  const tspans = lines
    .map((line, i) => {
      const y = i === 0 ? MISSION_PAD + MISSION_FONT_SIZE : MISSION_LINE_HEIGHT;
      return `<tspan x="${MISSION_PAD}" ${i === 0 ? `y="${MISSION_PAD + MISSION_FONT_SIZE}"` : `dy="${MISSION_LINE_HEIGHT}"`}>${escapeXml(line)}</tspan>`;
    })
    .join("\n    ");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="white"/>
  <text font-family="monospace, Courier, sans-serif" font-size="${MISSION_FONT_SIZE}" fill="black" xml:space="preserve">
    ${tspans}
  </text>
</svg>`;

  const png = await sharp(Buffer.from(svg))
    .png()
    .toBuffer();
  return png;
}

// -------------------- Print queue: single processor for image + text --------------------
setProcessor(async (job) => {
  if (job.type === "image") return printToThermal(job.payload);
  return { printed: false, error: "Unknown job type" };
});

// -------------------- Middleware --------------------
app.use(express.json({ limit: "25mb" }));

// CORS: allow frontend on Netlify (pocha31.netlify.app) to call this backend when running via ngrok
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Helper: choose base URL for links (public if available). Use sync value; /api/config may refresh discovery.
function getBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  if (discoveredNgrokUrl) return discoveredNgrokUrl;
  const host = req.headers.host; // e.g. 192.168.12.230:3000
  return `https://${host}`;
}

// -------------------- API --------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, port: PORT });
});

// Diagnostic: list USB printers seen by escpos-usb (helps debug "No USB printer found")
app.get("/api/printers", (req, res) => {
  try {
    const devices = escpos.USB.findPrinter();
    const count = devices && devices.length ? devices.length : 0;
    const list = (devices || []).map((d, i) => ({
      index: i,
      vendorId: d.vendorId || d.deviceDescriptor?.idVendor,
      productId: d.productId || d.deviceDescriptor?.idProduct,
    }));
    res.json({ ok: true, found: count, devices: list });
  } catch (e) {
    res.json({ ok: false, error: e?.message || String(e), found: 0, devices: [] });
  }
});

// Frontend fetches this to know whether to use ngrok/public URL for QR codes
app.get("/api/config", async (req, res) => {
  await ensureNgrokDiscovered();
  res.json({ publicBaseUrl: PUBLIC_BASE_URL || discoveredNgrokUrl || null });
});

// -------------------- Missions API --------------------
function formatMissionReceipt(name, missions, timeStr) {
  const lines = [
    "POCHA 31 - CONFIDENTIAL",
    "Player: " + name,
    "Time: " + timeStr,
    "MISSION 1: " + (missions[0] || ""),
    "MISSION 2: " + (missions[1] || ""),
    "MISSION 3: " + (missions[2] || ""),
    "BONUS MISSION: " + (missions[3] || ""),
    "If you complete a mission, say \"I GOT YOU\" to the person and scratch off (literally with your nail) the mission on this receipt.",
    "Do not show anyone.",
  ];
  return lines.join("\n");
}

function pickMissionCombination(tiers, dayIndex) {
  const len = 20;
  const t1 = tiers.tier1 || [];
  const t2 = tiers.tier2 || [];
  const t3 = tiers.tier3 || [];
  const bonus = tiers.bonus || [];
  if (t1.length < len || t2.length < len || t3.length < len || bonus.length < len) {
    return null;
  }
  let i1, i2, i3, i4;
  if (dayIndex < len) {
    i1 = i2 = i3 = i4 = dayIndex;
  } else {
    i1 = Math.floor(Math.random() * len);
    i2 = Math.floor(Math.random() * len);
    i3 = Math.floor(Math.random() * len);
    i4 = Math.floor(Math.random() * len);
  }
  return [t1[i1], t2[i2], t3[i3], bonus[i4]];
}

app.get("/api/missions/list", (req, res) => {
  res.json(loadMissions());
});

app.post("/api/missions/submit", async (req, res) => {
  try {
    const rawName = (req.body && req.body.name) ? String(req.body.name).trim() : "";
    if (!rawName) {
      return res.status(400).json({ error: "Name is required" });
    }
    const nameKey = rawName.toLowerCase();
    const issuance = loadIssuance();
    const alreadyUsed = issuance.some((e) => e.name.toLowerCase() === nameKey);
    if (alreadyUsed) {
      return res.status(200).json({
        blocked: true,
        message: "Nice try. Ask the host if you need help.",
      });
    }

    const tiers = loadMissionsTiers();
    if (!tiers) {
      return res.status(500).json({ error: "Missions not configured (need tier1, tier2, tier3, bonus)" });
    }
    const dayIndex = countTodayIssuances();
    const missions = pickMissionCombination(tiers, dayIndex);
    if (!missions) {
      return res.status(500).json({ error: "Not enough missions in tiers (need 20 per tier)" });
    }
    const timeStr = new Date().toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit" });

    appendIssuance({ name: rawName, timestamp: new Date().toISOString(), missions });

    const receiptText = formatMissionReceipt(rawName, missions, timeStr);
    const receiptImageBuffer = await receiptTextToImageBuffer(receiptText);
    const { jobId } = addJob({ type: "image", payload: receiptImageBuffer, source: "missions", meta: { name: rawName } });

    res.json({ missions, jobId, printed: "queued" });
  } catch (e) {
    console.error("Missions submit error:", e);
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// Save and optionally print (print only when user presses Print button).
// imageDataUrl = saved to file and used for share/ngrok download (preview quality, no print filter).
// printDataUrl = optional; when provided and shouldPrint, this image is sent to the printer (filtered for thermal).
app.post("/api/print", async (req, res) => {
  try {
    const { orderNumber, imageDataUrl, printDataUrl, print: shouldPrint } = req.body || {};
    if (!imageDataUrl) return res.status(400).send("Missing imageDataUrl");

    const match = imageDataUrl.match(/^data:image\/jpeg;base64,(.+)$/);
    if (!match) return res.status(400).send("imageDataUrl must be a JPEG data URL");

    const base64 = match[1];
    const buf = Buffer.from(base64, "base64");

    const safeOrder = String(orderNumber || "demo").replace(/[^0-9A-Za-z_-]/g, "");
    const today = new Date();
    const dateStr = today.getFullYear().toString() + 
                    String(today.getMonth() + 1).padStart(2, '0') + 
                    String(today.getDate()).padStart(2, '0');
    const filename = `${safeOrder}_${dateStr}.jpg`;
    const filepath = path.join(SAVED_DIR, filename);

    fs.writeFileSync(filepath, buf);
    console.log("✅ Saved image:", filepath, `(${buf.length} bytes)`);

    let printResult = { printed: false, error: undefined };
    if (shouldPrint === true) {
      let printBuf = buf;
      if (printDataUrl) {
        const printMatch = printDataUrl.match(/^data:image\/jpeg;base64,(.+)$/);
        if (printMatch) printBuf = Buffer.from(printMatch[1], "base64");
      }
      const { jobId } = addJob({ type: "image", payload: printBuf, source: "photobooth", meta: { orderNumber: safeOrder } });
      printResult = await waitForJob(jobId);
      if (printResult.printed) {
        console.log("✅ Printed to thermal printer");
      } else {
        console.warn("⚠️ Print skipped or failed:", printResult.error);
      }
    }

    const base = getBaseUrl(req);
    const shareUrl = `${base}/share/${safeOrder}`;

    res.json({
      ok: true,
      savedAs: filename,
      shareUrl,
      printed: printResult.printed,
      printError: printResult.error || undefined,
    });
  } catch (e) {
    console.error("Print error:", e);
    res.status(500).send(String(e?.message ?? e));
  }
});

// -------------------- Share routes --------------------

// Share page (HTML): guests open this from QR
app.get("/share/:order", (req, res) => {
  const order = String(req.params.order || "").replace(/[^0-9A-Za-z_-]/g, "");
  // Try to find the file with today's date first, then fall back to any matching order number
  const today = new Date();
  const dateStr = today.getFullYear().toString() + 
                  String(today.getMonth() + 1).padStart(2, '0') + 
                  String(today.getDate()).padStart(2, '0');
  let imgPath = path.join(SAVED_DIR, `${order}_${dateStr}.jpg`);
  
  // If file with today's date doesn't exist, try to find any file with this order number
  if (!fs.existsSync(imgPath)) {
    const files = fs.readdirSync(SAVED_DIR);
    const matchingFile = files.find(f => f.startsWith(`${order}_`) && f.endsWith('.jpg'));
    if (matchingFile) {
      imgPath = path.join(SAVED_DIR, matchingFile);
    }
  }

  if (!fs.existsSync(imgPath)) {
    return res.status(404).send("Not found");
  }

  const base = getBaseUrl(req);
  const imageUrl = `${base}/share/${order}/image`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pocha 31 Photo</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; padding: 18px; text-align:center; background:#f9fafb; }
      .card { max-width: 520px; margin: 0 auto; background: white; padding: 16px; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
      img { width: 100%; height: auto; border-radius: 12px; display:block; }
      a.button {
        display:inline-block; margin-top:14px; padding:12px 16px;
        background:#111827; color:white; border-radius:14px; text-decoration:none; font-weight:700;
      }
      .small { color:#6b7280; margin-top:10px; font-size: 14px; line-height: 1.4; }
      h2 { margin: 6px 0 14px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Pocha 31 📸</h2>
      <img src="${imageUrl}" alt="Photo strip" />
      <div>
        <a class="button" href="${imageUrl}" download="pocha31_${order}.jpg">Download</a>
      </div>
      <div class="small">
        Tip: On iPhone/iPad you can also long-press the image → “Save to Photos”.
      </div>
      <div class="small">Order # <b>${order}</b></div>
    </div>
  </body>
</html>`);
});

// Raw image endpoint
app.get("/share/:order/image", (req, res) => {
  const order = String(req.params.order || "").replace(/[^0-9A-Za-z_-]/g, "");
  // Try to find the file with today's date first, then fall back to any matching order number
  const today = new Date();
  const dateStr = today.getFullYear().toString() + 
                  String(today.getMonth() + 1).padStart(2, '0') + 
                  String(today.getDate()).padStart(2, '0');
  let imgPath = path.join(SAVED_DIR, `${order}_${dateStr}.jpg`);
  
  // If file with today's date doesn't exist, try to find any file with this order number
  if (!fs.existsSync(imgPath)) {
    const files = fs.readdirSync(SAVED_DIR);
    const matchingFile = files.find(f => f.startsWith(`${order}_`) && f.endsWith('.jpg'));
    if (matchingFile) {
      imgPath = path.join(SAVED_DIR, matchingFile);
    }
  }

  if (!fs.existsSync(imgPath)) {
    return res.status(404).send("Not found");
  }

  res.sendFile(imgPath);
});

// -------------------- Frontend hosting --------------------
// Missions app (DON'T GET GOT) – same host, same style as photobooth
const MISSIONS_HTML = path.join(DIST_DIR, "missions.html");
app.get("/missions", (req, res) => {
  if (fs.existsSync(MISSIONS_HTML)) {
    return res.sendFile(MISSIONS_HTML);
  }
  res.status(404).send("Missions app not built. Run: npm run build");
});

app.use(express.static(DIST_DIR));

// SPA fallback (serve index.html for any non-API route that isn't /share or /missions)
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).send("Not found");
  if (req.path.startsWith("/share/")) return res.status(404).send("Not found");
  if (req.path === "/missions") return res.status(404).send("Not found");
  return res.sendFile(INDEX_HTML);
});

// -------------------- Server --------------------
// Always run BOTH HTTP (3000) and HTTPS (3001) on LAN:
// - HTTP :3000 — missions, share links (no cert; works on phones in Safari).
// - HTTPS :3001 — photobooth on iPad (camera needs secure context).
// ngrok forwards to HTTP 3000; public URL is auto-discovered from ngrok API (127.0.0.1:4040) if not set.
const httpsOpts = { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) };

const httpServer = http.createServer(app);
const httpsServer = https.createServer(httpsOpts, app);

function startNgrokDiscoveryLoop() {
  if (PUBLIC_BASE_URL || discoveredNgrokUrl) return;
  let attempts = 0;
  const maxAttempts = 10;
  const interval = 2000;
  const tryOnce = () => {
    fetchNgrokPublicUrl().then((url) => {
      if (url) {
        discoveredNgrokUrl = url;
        console.log(`ℹ️ ngrok URL (auto): ${discoveredNgrokUrl}`);
        return;
      }
      attempts++;
      if (attempts < maxAttempts) setTimeout(tryOnce, interval);
    });
  };
  setTimeout(tryOnce, 1500);
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HTTP on :${PORT} (missions / share — use on phone: http://<your-ip>:${PORT}/missions)`);
  console.log(`✅ HTTPS on :${PORT + 1} (photobooth on iPad: https://<your-ip>:${PORT + 1})`);
  if (PUBLIC_BASE_URL) {
    console.log(`ℹ️ PUBLIC_BASE_URL = ${PUBLIC_BASE_URL}`);
  } else {
    console.log(`ℹ️ Checking for ngrok... (QR will use ngrok URL when available)`);
    startNgrokDiscoveryLoop();
  }
  httpsServer.listen(PORT + 1, "0.0.0.0");
});
