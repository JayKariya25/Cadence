import type { MetadataRoute } from "next";

/**
 * Served explicitly rather than left to 404: a request for `/robots.txt` was
 * otherwise falling through to the app's own not-found handling.
 *
 * Cadence is not deployed, so this matters to nobody in practice. It says what
 * would be true if it were: the catalogue is public, and the API and a
 * listener's own pages are not somewhere a crawler should go.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/library", "/liked", "/stats", "/rooms/", "/welcome"],
      },
    ],
  };
}
