# Pocha 31 Receipt Photobooth

Web-based photobooth for iPad Safari that generates a **receipt-style photo strip** and saves/prints via a **Mac-hosted Node HTTPS server**. QR codes point to a share page for downloading the strip.

> **Important:** Don’t put personal IPs/ngrok URLs in this file.  
> Use `README_LOCAL.md` for your copy/paste “game day” commands (it is ignored by git).

## Requirements

- **Mac** running the server
- **iPad Safari** (HTTPS required for camera)
- **Node.js** (for `npm`)
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

### 2) Install ngrok + login (for QR links off Wi‑Fi)

```bash
brew install ngrok
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
```

---

## iPad Safari URL to open

On the iPad, open **one** of these (HTTPS required):

- **LAN (local Wi‑Fi)**:
  - `https://<YOUR_MAC_LAN_IP>:3000`
  - Example format: `https://192.168.x.x:3000`
  - If you change Wi‑Fi networks, your Mac’s LAN IP will likely change — re-check it (see “Get your Mac LAN IP address” below).

- **Public (via ngrok)**:
  - `https://<YOUR_NGROK_HOSTNAME>.ngrok-free.dev`

If you use ngrok, make sure your server is started with:
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

