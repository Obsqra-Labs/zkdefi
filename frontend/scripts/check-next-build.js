const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const NEXT_DIR = path.join(ROOT, ".next");

const REQUIRED_FILES = [
  "BUILD_ID",
  "prerender-manifest.json",
  "build-manifest.json",
  "app-build-manifest.json",
  "server/app-paths-manifest.json",
  "server/server-reference-manifest.json",
];

function readJson(relativePath) {
  const fullPath = path.join(NEXT_DIR, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function normalizeAssetPath(asset) {
  let out = String(asset || "");
  out = out.replace(/^https?:\/\/[^/]+\//, "");
  out = out.replace(/^\/_next\//, "");
  out = out.replace(/^_next\//, "");
  out = out.replace(/^\/+/, "");
  return out;
}

function collectStrings(value, into) {
  if (typeof value === "string") {
    into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, into);
  }
}

function main() {
  const missingRequired = REQUIRED_FILES.filter(
    (file) => !fs.existsSync(path.join(NEXT_DIR, file))
  );

  if (missingRequired.length > 0) {
    console.error(
      `[check-next-build] Missing required files: ${missingRequired.join(", ")}`
    );
    process.exit(1);
  }

  let buildManifest;
  let appBuildManifest;

  try {
    buildManifest = readJson("build-manifest.json");
    appBuildManifest = readJson("app-build-manifest.json");
  } catch (err) {
    console.error(`[check-next-build] Failed to parse manifest JSON: ${err.message}`);
    process.exit(1);
  }

  const assetCandidates = new Set();
  collectStrings(buildManifest, assetCandidates);
  collectStrings(appBuildManifest, assetCandidates);

  const missingAssets = [];
  for (const asset of assetCandidates) {
    const normalized = normalizeAssetPath(asset);
    if (!normalized.startsWith("static/")) continue;
    const diskPath = path.join(NEXT_DIR, normalized);
    if (!fs.existsSync(diskPath)) missingAssets.push(normalized);
  }

  if (missingAssets.length > 0) {
    const preview = missingAssets.slice(0, 20).join(", ");
    console.error(
      `[check-next-build] Missing static assets referenced by manifests: ${preview}${
        missingAssets.length > 20 ? " ..." : ""
      }`
    );
    process.exit(1);
  }

  console.log("[check-next-build] Existing .next build is valid.");
}

main();
