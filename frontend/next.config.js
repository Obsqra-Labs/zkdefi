const { execSync } = require("node:child_process");

function resolveBuildId() {
  const fromEnv =
    process.env.BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv;

  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "local";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Stable build ID so all nodes/servers serve the same chunk set after deploy (avoids ChunkLoadError from mixed versions).
  generateBuildId: async () => resolveBuildId(),
  // Serve VitePress docs at /docs: /docs and /docs/ -> docs index (Next does not serve public dir index).
  async rewrites() {
    return [
      { source: "/favicon.ico", destination: "/icon.svg" },
      { source: "/docs", destination: "/docs/index.html" },
      { source: "/docs/", destination: "/docs/index.html" },
    ];
  },
  // After deploy, users must get fresh HTML so chunk URLs match the new build.
  // Avoid long-lived cache on the document (nginx/CDN can override).
  async headers() {
    const noCache = "no-cache, no-store, must-revalidate";
    return [
      { source: "/", headers: [{ key: "Cache-Control", value: noCache }] },
      { source: "/agent", headers: [{ key: "Cache-Control", value: noCache }] },
      { source: "/agent/:path*", headers: [{ key: "Cache-Control", value: noCache }] },
      { source: "/profile", headers: [{ key: "Cache-Control", value: noCache }] },
      { source: "/profile/:path*", headers: [{ key: "Cache-Control", value: noCache }] },
      { source: "/mvp", headers: [{ key: "Cache-Control", value: noCache }] },
      { source: "/marketplace", headers: [{ key: "Cache-Control", value: noCache }] },
      { source: "/privacy", headers: [{ key: "Cache-Control", value: noCache }] },
      { source: "/terms", headers: [{ key: "Cache-Control", value: noCache }] },
      // App router HTML / RSC so chunks match current deploy
      { source: "/_next/static/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

module.exports = nextConfig;
