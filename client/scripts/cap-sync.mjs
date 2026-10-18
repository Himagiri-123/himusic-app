// Prepares the Android project: builds the web app, then (if CAP_SERVER_URL is set) makes the app open
// your live website so site updates reach the app without a new APK.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const file = new URL("../capacitor.config.json", import.meta.url);
const cfg = JSON.parse(readFileSync(file, "utf8"));
delete cfg.server;
const url = (process.env.CAP_SERVER_URL || "").trim();
if (url) cfg.server = { url, cleartext: false, androidScheme: "https" };
writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
try {
  execSync("npx cap sync android", { stdio: "inherit" });
} finally {
  // keep the committed file clean
  delete cfg.server;
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
}
