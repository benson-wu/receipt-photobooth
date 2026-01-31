# Pocha 31 Receipt Photobooth

Web-based photobooth for iPad Safari that generates a **receipt-style photo strip** and saves/prints via a **Mac-hosted Node HTTPS server**. Photos print on a **Rongta RP80 (80mm) thermal printer** over USB. QR codes point to a share page for downloading the strip.

> **Important:** Don’t put personal IPs/ngrok URLs in this file.  
> Use `README_LOCAL.md` for your copy/paste “game day” commands (it is ignored by git).

## Requirements

- **Mac** running the server
- **iPad Safari** (HTTPS required for camera)
- **Node.js** (for `npm`)
- **Rongta RP80** thermal printer (80mm) connected via USB, with [driver installed](https://www.rongtatech.com/category/downloads/1)
- **ngrok** (optional but recommended for QR codes to work off-LAN)

---

## One-time setup (do once)

### 1) Install dependencies

```bash
cd receipt-photobooth
npm install

cd server
npm install
```

### 2) Generate local HTTPS certs (required for server)

The server uses HTTPS so the iPad camera works. Run once from the **repo root**:

```bash
mkdir -p server/certs
openssl req -x509 -newkey rsa:4096 -keyout server/certs/key.pem -out server/certs/cert.pem -days 365 -nodes -subj "/CN=localhost"
```

### 3) Install ngrok + login (for QR links off Wi‑Fi)

```bash
brew install ngrok
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
```

---

## Start the app (exact commands)

From the **repo root** (`receipt-photobooth/`):

**1. Build the frontend**

```bash
npm run build
```

**2. Start the HTTPS server**

```bash
cd server && npm start
```

You should see:

```
✅ HTTPS Server listening on: https://localhost:3000
ℹ️ PUBLIC_BASE_URL = (not set, LAN-only links)
```

Then open **https://localhost:3000** (or your Mac’s LAN IP) on the iPad. QR codes will point to the LAN URL; they won’t work off Wi‑Fi unless you use ngrok (below).

---

## Start the app with ngrok (QR codes work off Wi‑Fi)

Use **two terminals**. QR codes will use the public ngrok URL so guests can scan and open the share link from anywhere.

**Terminal 1 — start ngrok**

```bash
ngrok http 3000
```

Leave this running. In the ngrok output, copy the **HTTPS** URL (e.g. `https://abc123def.ngrok-free.app`).

**Terminal 2 — build and start the server with that URL**

Replace `https://YOUR_NGROK_URL.ngrok-free.app` with the URL from Terminal 1 (no trailing slash).

```bash
cd /Users/bensonwu/Documents/Git/receipt-photobooth
npm run build
cd server && PUBLIC_BASE_URL=https://YOUR_NGROK_URL.ngrok-free.app npm start
```

Example (use your actual ngrok URL):

```bash
cd server && PUBLIC_BASE_URL=https://abc123def.ngrok-free.app npm start
```

You should see:

```
✅ HTTPS Server listening on: https://localhost:3000
ℹ️ PUBLIC_BASE_URL = https://abc123def.ngrok-free.app
```

**Open the app:** On the iPad (or any device), open the **ngrok URL** from Terminal 1 (e.g. `https://abc123def.ngrok-free.app`). The receipt QR codes will point to that same URL so share links work off Wi‑Fi.

---

## Test if print works

1. **Connect the Rongta RP80** to your Mac via USB and ensure the [Rongta driver](https://www.rongtatech.com/category/downloads/1) is installed (80mm Thermal Receipt Printer Driver for Mac).

2. **Keep the server running** (from the “Start the app” steps above).

3. **Open the app in a browser:**
   - On the **Mac**: `https://localhost:3000` (accept the self-signed cert if prompted).
   - On **iPad** (same Wi‑Fi): `https://<YOUR_MAC_LAN_IP>:3000` (get IP with `ipconfig getifaddr en0`).

4. **Run a full photobooth flow:**
   - Allow camera access.
   - Take the required photos (template flow).
   - Wait for the **Preview** screen (Step 2).
   - Click **Print** (Step 3).

5. **Check:**
   - **Printer:** A receipt strip should print from the RP80.
   - **Server terminal:** You should see `✅ Printed to thermal printer` (if you see `⚠️ Print skipped or failed: ...`, the printer wasn’t found or USB access failed).

If print fails, the image is still saved and the share link works; the UI will show “Saved” and a printer-unavailable message.

---

## Printing (Rongta RP80)

- **Paper:** 80mm thermal receipt paper.
- **Driver:** [Rongta downloads](https://www.rongtatech.com/category/downloads/1) — use “80mm Thermal Receipt Printer Driver (Mac)” for RP80.
- **Connection:** USB. The app uses the first USB printer found; disconnect other USB printers if you have multiple.
- **macOS:** If you get `LIBUSB_ERROR_ACCESS` or “No USB printer found”, ensure the Rongta driver is installed and the printer is powered on and connected. You may need to allow the terminal (or Node) access in **System Settings → Privacy & Security**.

---

## iPad Safari URL to open

On the iPad, open **one** of these (HTTPS required):

- **LAN (local Wi‑Fi)**:
  - `https://<YOUR_MAC_LAN_IP>:3000`
  - Example format: `https://192.168.x.x:3000`
  - If you change Wi‑Fi networks, your Mac’s LAN IP will likely change — re-check it (see “Get your Mac LAN IP address” below).

- **Public (via ngrok)**:
  - `https://<YOUR_NGROK_HOSTNAME>.ngrok-free.dev`

If you use ngrok, start the server with:
- `PUBLIC_BASE_URL=https://<YOUR_NGROK_HOSTNAME>.ngrok-free.dev`

---

## Game day runbook

Use `README_LOCAL.md` for exact copy/paste commands tailored to your machine and current ngrok URL.

### Running with MacBook lid closed (clamshell mode)

If you want to close your MacBook lid during the party:
- Mac must be **plugged into power**
- Use `caffeinate` to prevent sleep (see `README_LOCAL.md` for exact commands)
- Without `caffeinate`, macOS will sleep when the lid closes and your server will stop

---

## iPad / iOS HTTPS note (camera permissions)

iOS Safari requires HTTPS for camera. If you’re using a self-signed cert:
- open your local HTTPS site once on iPad
- accept/trust the certificate (Device Management / Profiles as needed)

---

## QR / Share flow

- The receipt image is **saved during Preview (Step 2)** so the QR link should work **before** pressing Print.
- QR codes point to: `https://<PUBLIC_BASE_URL>/share/<orderNumber>`

---

## Useful commands

### Get your Mac LAN IP address

Use this whenever you switch to a different Wi‑Fi network.

```bash
ipconfig getifaddr en0
```

If that prints nothing:

```bash
ipconfig getifaddr en1
```

What you’re looking for: an IP like `192.168.x.x` or `10.0.x.x`.  
Then the iPad URL is: `https://<THAT_IP>:3000`

