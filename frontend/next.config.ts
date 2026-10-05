import type { NextConfig } from "next";

// Static export: the Cloudflare Worker serves `out/` as assets and handles /api/* itself.
const nextConfig: NextConfig = { output: "export", images: { unoptimized: true } };

export default nextConfig;
