const fs = require("fs");
const path = require("path");
const https = require("https");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const DIST_DIR = path.join(__dirname, "..", "dist");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

const CERT_PATH = path.join(__dirname, "certs", "cert.pem");
const KEY_PATH = path.join(__dirname, "certs", "key.pem");

// Where we save images on the Mac:
const SAVED_DIR = path.join(__dirname, "saved");
fs.mkdirSync(SAVED_DIR, { recursive: true });

app.use(express.json({ limit: "25mb" }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, port: PORT });
});

// Save + (later) print
app.post("/api/print", async (req, res) => {
  try {
    const { orderNumber, imageDataUrl } = req.body || {};
    if (!imageDataUrl) return res.status(400).send("Missing imageDataUrl");

    // Extract base64 from data URL
    const match = imageDataUrl.match(/^data:image\/jpeg;base64,(.+)$/);
    if (!match) return res.status(400).send("imageDataUrl must be a JPEG data URL");

    const base64 = match[1];
    const buf = Buffer.from(base64, "base64");

    const safeOrder = String(orderNumber || "demo").replace(/[^0-9A-Za-z_-]/g, "");
    const filename = `order_${safeOrder}_${Date.now()}.jpg`;
    const filepath = path.join(SAVED_DIR, filename);

    fs.writeFileSync(filepath, buf);

    console.log("✅ Saved image:", filepath, `(${buf.length} bytes)`);

    // IMPORTANT: share URL must be reachable from iPad (NOT localhost)
    const host = req.headers.host; // e.g. 192.168.12.230:3000
    const shareUrl = `https://${host}/share/${filename}`;

    res.json({ ok: true, savedAs: filename, shareUrl });
  } catch (e) {
    console.error("Print error:", e);
    res.status(500).send(String(e?.message ?? e));
  }
});

// Serve saved images by filename
app.get("/share/:filename", (req, res) => {
  const f = req.params.filename;
  const full = path.join(SAVED_DIR, f);
  if (!full.startsWith(SAVED_DIR)) return res.status(400).send("Bad filename");
  if (!fs.existsSync(full)) return res.status(404).send("Not found");
  res.sendFile(full);
});

app.use(express.static(DIST_DIR));

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).send("Not found");
  return res.sendFile(INDEX_HTML);
});

const httpsOptions = {
  cert: fs.readFileSync(CERT_PATH),
  key: fs.readFileSync(KEY_PATH),
};

https.createServer(httpsOptions, app).listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HTTPS Server listening on: https://localhost:${PORT}`);
});