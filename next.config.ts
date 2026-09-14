import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    Switched off because this app has a full-width fixed player bar. The
    indicator's four possible positions are the four screen corners, and both
    bottom corners sit on top of controls in that bar — bottom-left is exactly
    the artwork button that opens the now-playing view, which becomes
    unclickable in development. The top corners collide with the sticky header.
    Development errors still surface in the terminal and in the error overlay,
    which is a separate thing.
  */
  devIndicators: false,

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
