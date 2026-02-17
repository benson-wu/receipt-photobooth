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
   - On the **Mac**: `https://localhost:3001` for photobooth (accept the self-signed cert if prompted).
   - On **iPad** (same Wi‑Fi): `https://<YOUR_MAC_LAN_IP>:3001` for photobooth (get IP with `ipconfig getifaddr en0`).

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

## URLs (two ports on LAN)

The server always listens on **two ports** so you can avoid certificate issues on phones:

| Port | Protocol | Use |
|------|----------|-----|
| **3000** | HTTP | Missions, share links — use on **phones** (no cert prompt). |
| **3001** | HTTPS | Photobooth — use on **iPad** (camera needs secure context). |

- **Missions / share on phone (same Wi‑Fi):** `http://<YOUR_MAC_LAN_IP>:3000/missions` (e.g. `http://192.168.12.230:3000/missions`)
- **Photobooth on iPad:** `https://<YOUR_MAC_LAN_IP>:3001` (e.g. `https://192.168.12.230:3001`)
- **With ngrok:** Use the ngrok URL for share QR codes; missions can be `https://<ngrok-host>/missions` or still `http://<IP>:3000/missions` on LAN.

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

## Missions app (DON'T GET GOT)

A second product for Pocha night: guests scan a QR, enter their name, get **3 random missions** printed on the same receipt printer. Same server and port; photobooth and missions share a **single print queue** (FIFO) so prints never collide.

### Build (include missions page)

```bash
npm run build
```

This builds both the photobooth app and the missions app. The missions page is at **`/missions`**.

### Missions URL for guests (QR code)

- **LAN (no ngrok):** `http://<YOUR_MAC_LAN_IP>:3000/missions` (e.g. `http://192.168.12.230:3000/missions`) — **HTTP** so phones don’t hit a cert error.
- **With ngrok:** `https://<YOUR_NGROK_HOSTNAME>.ngrok-free.app/missions`

Create a QR code pointing to one of these so guests can open the missions page (LAN = same Wi‑Fi; ngrok works from anywhere).

### How to test missions

1. **Start the server** (after `npm run build`):
   ```bash
   cd server && npm start
   ```

2. **Open the missions page** on your phone or laptop:
   - `http://localhost:3000/missions` (Mac), or
   - `http://<MAC_LAN_IP>:3000/missions` (phone on same Wi‑Fi).  
   Use **HTTP** (port 3000) so the phone doesn’t show a certificate error.

3. **Submit a mission:**
   - Enter a name (e.g. "Benson").
   - Tap **REVEAL MY FATE**.
   - You should see 3 random missions and "Your receipt is printing!" A receipt should print from the same Rongta printer.

4. **Test anti-spam:** Submit the same name again (same spelling, any case). You should see: "Nice try. Ask the host if you need help."

5. **Test shared queue:** While the server is running, use the **photobooth** (iPad) to take a photo and press Print, and use **missions** (phone) to submit a name. Both jobs should print one after the other in order, with no collision.

### Missions data

- **Mission list:** `server/data/missions.json` — edit to add or change missions (one string per line).
- **Issuance log:** `server/data/issuance.json` — created automatically; records each name and assigned missions (gitignored).

### Boot order (party day)

1. Start the server (one process serves both photobooth and missions).
2. Open photobooth on iPad: `https://<IP>:3001`.
3. QR / missions for guests: `http://<IP>:3000/missions` (or ngrok URL + `/missions`).

---

## Deploy to Netlify (public URL, no Wi‑Fi required)

You can host the **static frontend** on Netlify (e.g. **pocha31.netlify.app**) so guests can open the app without joining your Wi‑Fi. The **backend** (printer, API) still runs on your Mac; when you run the party you start the server (e.g. `pocha` with ngrok) and point the frontend at it.

### 1. Connect the repo to Netlify

1. In [Netlify](https://app.netlify.com), add a new site → **Import an existing project** → connect your Git provider and select the **receipt-photobooth** repo.
2. Netlify will read **netlify.toml**: build command `npm run build`, publish directory `dist`. Leave those as-is.
3. Deploy. The site will be at **pocha31.netlify.app** (or the name you chose).

### 2. Set the backend URL when you run the party

The frontend needs to know where your API lives. When you run the party:

1. Start your backend (e.g. run **`pocha`** so ngrok starts and your Mac serves the API).
2. Copy the **ngrok HTTPS URL** (e.g. `https://abc123.ngrok-free.app`).
3. In Netlify: **Site settings → Environment variables** → add:
   - **Key:** `VITE_API_BASE_URL`
   - **Value:** your ngrok URL (no trailing slash), e.g. `https://abc123.ngrok-free.app`
4. Trigger a **new deploy** (Deploys → Trigger deploy → Deploy site) so the build uses the new variable.

After that, anyone can open **https://pocha31.netlify.app** (photobooth) or **https://pocha31.netlify.app/missions** (missions); the app will call your Mac via ngrok. Your Mac must be on and running `pocha` (or the server + ngrok) for print and missions to work.

### 3. Custom domain (optional)

In Netlify: **Site settings → Domain management** → **Add custom domain** and follow the steps. Netlify will give you DNS records to add at your registrar. Once DNS is set, the site is available at your domain.

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
- Photobooth (iPad): `https://<THAT_IP>:3001`  
- Missions (phone): `http://<THAT_IP>:3000/missions`

