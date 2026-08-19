import type { NextConfig } from "next";

/**
 * Static export: the sweep tool has to run from a phone in a car, where there is
 * no Node server and no FastAPI backend. Everything the sweep needs is
 * client-side (WebUSB/Web Serial, IndexedDB, and the collector Worker), so the
 * whole app ships as files.
 *
 * The Builder/Simulation views still call the local backend and simply report it
 * as unreachable when it is not there — that is correct: they are desk work.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // A trailing-slash export gives Cloudflare Pages a real index.html per route,
  // which avoids the redirect dance on deep links.
  trailingSlash: true,
};

export default nextConfig;
