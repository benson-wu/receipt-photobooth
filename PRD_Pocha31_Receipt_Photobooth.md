# PRD — Pocha 31 Receipt Photobooth (v1)

Owner: Benson  
Last updated: 2026-01-27  
Audience: Cursor / developer implementation

## 1) Summary

A web-based photo booth that runs on **Safari on iPad Air (3rd gen, iOS 18.6.2)** and prints a “receipt-style” photo strip via a **Mac-hosted Node server** (thermal printer attached to Mac). The experience should feel seamless and “photo booth-y”: countdown, flash, multi-shot auto capture, and a downloadable share link via QR code.

**Core flows**
1. Guest lands on a neon-themed home screen.
2. Guest selects a template (1 / 2 / 4 photos).
3. Guest starts capture.
4. App captures photos with countdown, shows quick “Nice!” flash between shots.
5. App generates a **receipt composite image** (photos + order info + QR).
6. Guest previews the receipt, prints (server saves + prints), then reset for next guest.

---

## 2) Goals & Non-goals

### Goals
- **Runs reliably on iPad Safari** (HTTPS required for camera).
- **No one needs to leave the web app** during normal use.
- **Multi-shot templates** automatically capture with a consistent countdown.
- Receipt composite includes:
  - Date/time
  - Order number
  - Fun line items
  - Final photo layout (based on template)
  - QR code that leads to a share page to download the image
- Server saves each receipt image and provides a **public share URL** for QR codes (LAN or public via ngrok).
- “Idle timeout” resets the kiosk to home after inactivity.

### Non-goals (v1)
- Accounts/login
- Photo filters/AR masks
- Cloud storage (S3, etc.)
- High-volume gallery UI
- Advanced print settings UI (we’ll keep printing simple)

---

## 3) Target Users / Context
- Party guests using an iPad on a stand in kiosk mode.
- Host (Benson) running server on a Mac connected to a thermal receipt printer.
- Guests should be able to scan QR on their phones and download photos.
  - If guests are off the LAN, use ngrok public URL.

---

## 4) Success Metrics
- ≥ 95% successful camera access on iPad once trust is established (HTTPS + permission).
- ≥ 95% successful “save” calls to server.
- End-to-end photo-to-print time: target ≤ 15s after last capture (excluding print hardware).
- QR share links open and allow download on both iOS and Android.

---

## 5) UX / Visual Requirements

### Global styling (all screens)
- Neon Seoul theme:
  - Dark neon background gradient + subtle grain/scanlines
  - Neon typography
  - Decorative **hanging lanterns** at top with:
    - Visible **strings** (not floating)
    - Gentle **swing animation** (slightly more swing than current)
    - **Never disappear** / no blinking
    - Same lantern component & CSS across screens (home + template + camera + preview)

### Layout / Device constraints
- App must fit within Safari viewport on iPad with:
  - **No page scrolling**
  - No pinch-zoom requirement
- Any long content (e.g., print preview / receipt image) must be scrollable **within an inner container**, not the entire page.

### Home screen
- Single CTA button: “Enter the Night” (or “Start”)
- Neon headline and subcopy.
- Lanterns top.

### Template select screen
- Same background + lanterns (no “jumping”).
- Template cards: 1 / 2 / 4
- Confirm selection.
- For 2+ templates: do **not** auto-start capture on selection.

### Capture screen (camera)
- Live camera preview must be **mirrored** (front-camera selfie feel).
- Shows current shot indicator: “Shot X of N”
- Countdown overlay:
  - Always shown before each capture
  - **Countdown length: 5 seconds**
  - No “Next shot in…” pre-message; go directly into numeric countdown.
- Flash overlay after capture:
  - “Nice!” for 0.5s + white flash

### Preview screen
- Shows the final receipt composite image.
- Must be scrollable inside the card if taller than viewport.
- Must show a **countdown timer** (“Printing expires in: 15s” e.g.) and message:
  - “Press Print or this photo will be cleared.”
- Buttons:
  - Retake
  - Print

### Printed screen
- Confirmation + share URL (optional to show link)
- Auto-reset after 1.5s (or configurable)

---

## 6) Functional Requirements

### FR1 — Template selection
- Templates:
  - single (1 photo)
  - duo (2 photos)
  - quad (4 photos)
- Confirm creates a new order:
  - `orderNumber` random 6 digits
  - `orderDate` current time

### FR2 — Capture behavior
- For 1 photo:
  - Capture button visible and works.
- For 2+ photos:
  - Show “Start” button on capture screen (or a pre-capture screen).
  - After user taps Start, the app automatically captures all photos.
- Countdown:
  - 5 seconds before each shot.
  - Uses beep tick each second (optional) and shutter sound.
- Flash:
  - Show “Nice!” overlay for 0.5s after each capture.
- Advance:
  - Auto-advance after each shot.

### FR3 — Receipt composite generation
- Canvas composite dimensions (current baseline):
  - W = 900
  - H = ~1650 (adjust as needed for QR padding)
- Receipt elements:
  - Header: “POCHA 31”, “Tiff’s Birthday Edition”
  - Date: formatted locale string
  - Order #: 6-digit
  - Fun line items (configurable)
  - Photo layout region based on template:
    - 1 photo: full
    - 2 photo: vertical stack
    - 4 photo: 2x2 grid
  - Footer:
    - “SCAN TO DOWNLOAD”
    - QR code centered with **bottom padding** (white space under it)
    - Remove printed URL text under “SCAN TO DOWNLOAD”
- QR code URL must point to the share page for this order:
  - `${publicBaseUrl}/share/<orderNumber>`
- The QR must be readable at print size (target: 220px or higher).

### FR4 — Server integration (save + print stub)
- Frontend POST:
  - `POST /api/print` with JSON: `{ orderNumber, imageDataUrl }`
- Server saves as deterministic filename:
  - `server/saved/<orderNumber>.jpg`
- Response:
  - `{ ok: true, savedAs, shareUrl }`
- Share page:
  - `GET /share/:order` renders HTML with image + Download button.
  - `GET /share/:order/image` returns the raw image.
- Printing:
  - v1 can remain “save-only” or “save + printer stub”
  - vNext: integrate ESC/POS + sharp to rasterize and print.

### FR5 — Public base URL for QR codes
- Problem: LAN URLs won’t work for guests not on Wi-Fi.
- Solution: server exposes:
  - `GET /api/config` → `{ publicBaseUrl }`
- Source of truth:
  - environment variable on server: `PUBLIC_BASE_URL`
  - Example: ngrok HTTPS endpoint
- Frontend:
  - uses `/api/config` to build QR URL.
  - fallback: `window.location.origin` if not set.

### FR6 — Idle reset
- Inactivity timer: `IDLE_MS = 30000` (configurable)
- Any touch/click resets idle timer.
- On idle:
  - stop camera stream
  - reset order + template
  - return to home screen

---

## 7) Non-Functional Requirements

### NFR1 — iPad Safari compatibility
- Must be served over HTTPS
- Must request camera permission once and work reliably
- Avoid memory blowups:
  - limit stored images in memory to current session
  - after printing, reset state

### NFR2 — Performance
- Composite generation target: < 1s on iPad
- Upload to server: < 3s on LAN typical
- Avoid giant DOM rerenders; keep screens simple.

### NFR3 — Security / Privacy
- No cloud by default; images stored on local Mac.
- Share links are unlisted but accessible to anyone with URL.
- Optionally: auto-expire images after party (future).

### NFR4 — Repo hygiene
- Add `.gitignore` rule to ignore:
  - `server/saved/`
  - certs (optional)
  - local env files

---

## 8) Technical Architecture

### Frontend (Vite + vanilla JS)
- Single-page flow controlled by render functions.
- Key modules:
  - camera capture + countdown
  - receipt composite generator (canvas)
  - server API client
  - neon styling and lantern animations (CSS)

### Backend (Node + Express + HTTPS)
- Serves:
  - built frontend (`dist/`)
  - API endpoints: `/api/print`, `/api/health`, `/api/config`
  - share routes: `/share/:order`, `/share/:order/image`
- HTTPS:
  - self-signed cert stored under `server/certs/`
  - binds `0.0.0.0` so iPad can reach via LAN IP

### Future printer integration
- Use `escpos` + `escpos-usb`
- Use `sharp` to resize/dither image for printer width
- Print as raster image.

---

## 9) API Spec

### GET /api/health
**Response**
```json
{ "ok": true, "port": 3000 }
```

### GET /api/config
**Response**
```json
{ "publicBaseUrl": "https://xxxx.ngrok-free.app" }
```

### POST /api/print
**Request**
```json
{
  "orderNumber": "602127",
  "imageDataUrl": "data:image/jpeg;base64,..."
}
```
**Response**
```json
{
  "ok": true,
  "savedAs": "602127.jpg",
  "shareUrl": "https://xxxx.ngrok-free.app/share/602127"
}
```

### GET /share/:order
HTML page with image + download.

### GET /share/:order/image
Raw JPEG response.

---

## 10) Acceptance Criteria (Checklist)

### Capture
- [ ] On iPad Safari, camera opens successfully (HTTPS).
- [ ] Preview is mirrored.
- [ ] 1-photo template: Capture button works.
- [ ] 2/4-photo templates: user presses Start, then app auto-captures all shots.
- [ ] Countdown is 5 seconds for each shot.
- [ ] No “Next shot in…” message.
- [ ] Flash “Nice!” appears after each capture.

### Receipt
- [ ] Order number + date show on receipt.
- [ ] QR is centered, not touching bottom, with padding.
- [ ] No printed URL line under “SCAN TO DOWNLOAD”.
- [ ] QR opens share page and allows download.

### Share
- [ ] Share link works on phone (not requiring LAN) when `PUBLIC_BASE_URL` is set to ngrok.
- [ ] Share page displays image and download button.

### UI/Styling
- [ ] Lanterns have strings, swing more, never disappear.
- [ ] Lanterns are consistent across all screens (no jumping).
- [ ] No page scrolling; only receipt preview card scrolls if needed.

### Reset
- [ ] Idle reset returns to home and stops stream.
- [ ] After print success, auto-resets for next guest.

---

## 11) Risks & Mitigations
- **iOS camera restrictions**: must use HTTPS; self-signed cert trust required.
  - Mitigation: provide trust/install steps; keep one stable LAN hostname/IP.
- **ngrok endpoint “offline”** if Mac sleeps or server stops.
  - Mitigation: disable sleep during party; keep terminal running; add simple “status” check.
- **Thermal printer formatting differences**.
  - Mitigation: treat printing as vNext; ensure save/share always works first.

---

## 12) Implementation Plan (Suggested)
1. Stabilize UI shell + lantern component (CSS-only, no React).
2. Finalize capture state machine (start → countdown → capture → next shot).
3. Finalize receipt composite layout + QR padding/centering.
4. Server: `/api/config` + deterministic save + share routes.
5. End-to-end testing:
   - iPad LAN
   - phone QR on cellular (ngrok)
6. Add printer integration after stability.
