#!/usr/bin/env node
/**
 * Generate an evergreen QR code for the missions page.
 * Saves missions-qr.png in the repo root (or path from first arg).
 *
 * Usage:
 *   npm run qr:missions
 *   node scripts/missions-qr.js [output.png]
 *   MISSIONS_URL=http://192.168.12.230:3000/missions npm run qr:missions   # LAN fallback
 */
import QRCode from "qrcode";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

const missionsUrl = process.env.MISSIONS_URL || "https://pocha31.netlify.app/missions";
const outputPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(rootDir, "missions-qr.png");

async function main() {
  await QRCode.toFile(outputPath, missionsUrl, { width: 400, margin: 2 });
  console.log("QR code saved:", outputPath);
  console.log("URL:", missionsUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
