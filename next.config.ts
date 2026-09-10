import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Jamendo serves album artwork from its own CDN. Audio is a different
    // matter entirely: it is proxied through app/api/stream in Phase 1 so the
    // Web Audio AnalyserNode can read it without a cross-origin taint.
    remotePatterns: [
      { protocol: "https", hostname: "**.jamendo.com" },
      { protocol: "https", hostname: "**.jamendo.co" },
    ],
  },
};

export default nextConfig;
