// server/index.js
const fs = require("fs");
const path = require("path");
const https = require("https");
const express = require("express");
const { promisify } = require("util");
const sharp = require("sharp");
const getPixels = require("get-pixels");
const escpos = require("escpos");
escpos.USB = require("escpos-usb");

const getPixelsAsync = promisify(getPixels);

const app = express();
const PORT = process.env.PORT || 3000;

// If set, share/QR links will use this public base (e.g. https://xxxx.ngrok-free.app)
// Otherwise they fall back to LAN host (https://192.168.x.x:3000).
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL
  ? String(process.env.PUBLIC_BASE_URL).replace(/\/$/, "")
  : null;

const DIST_DIR = path.join(__dirname, "..", "dist");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

const CERT_PATH = path.join(__dirname, "certs", "cert.pem");
const KEY_PATH = path.join(__dirname, "certs", "key.pem");

// Where we save images on the Mac:
const SAVED_DIR = path.join(__dirname, "saved");
fs.mkdirSync(SAVED_DIR, { recursive: true });

// 80mm thermal receipt printable width in pixels (RP80: 48 chars = 384px avoids bleed)
const THERMAL_WIDTH_PX = 384;

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

    // Resize, grayscale, lighten, then Floyd-Steinberg dither for gray tones
    // (thermal printers are 1-bit; dithering simulates gray and shows detail)
    const bwPng = await sharp(imageBuffer)
      .resize(THERMAL_WIDTH_PX, null, { withoutEnlargement: true })
      .greyscale()
      .normalize()
      .linear(1, 45)
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

// -------------------- Middleware --------------------
app.use(express.json({ limit: "25mb" }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Helper: choose base URL for links (public if available)
function getBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const host = req.headers.host; // e.g. 192.168.12.230:3000
  return `https://${host}`;
}

// -------------------- API --------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, port: PORT });
});

// Frontend fetches this to know whether to use ngrok/public URL for QR codes
app.get("/api/config", (req, res) => {
  res.json({ publicBaseUrl: PUBLIC_BASE_URL });
});

// Save and optionally print (print only when user presses Print button)
app.post("/api/print", async (req, res) => {
  try {
    const { orderNumber, imageDataUrl, print: shouldPrint } = req.body || {};
    if (!imageDataUrl) return res.status(400).send("Missing imageDataUrl");

    // Extract base64 from data URL
    const match = imageDataUrl.match(/^data:image\/jpeg;base64,(.+)$/);
    if (!match) return res.status(400).send("imageDataUrl must be a JPEG data URL");

    const base64 = match[1];
    const buf = Buffer.from(base64, "base64");

    // Deterministic filename with date: server/saved/<orderNumber>_<yyyymmdd>.jpg
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
      printResult = await printToThermal(buf);
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
app.use(express.static(DIST_DIR));

// SPA fallback (serve index.html for any non-API route that isn't /share)
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).send("Not found");
  if (req.path.startsWith("/share/")) return res.status(404).send("Not found");
  return res.sendFile(INDEX_HTML);
});

// -------------------- HTTPS server --------------------
const httpsOptions = {
  cert: fs.readFileSync(CERT_PATH),
  key: fs.readFileSync(KEY_PATH),
};

https.createServer(httpsOptions, app).listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HTTPS Server listening on: https://localhost:${PORT}`);
  console.log(`ℹ️ PUBLIC_BASE_URL = ${PUBLIC_BASE_URL || "(not set, LAN-only links)"}`);
});
