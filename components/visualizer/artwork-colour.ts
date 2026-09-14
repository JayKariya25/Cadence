"use client";

/**
 * The dominant colour of a piece of artwork.
 *
 * Drawn into a tiny offscreen canvas and counted, rather than shipped to a
 * colour-extraction library: the whole job is 40 lines, and the library would
 * be several kilobytes to answer one question.
 *
 * Jamendo's image CDN sends `access-control-allow-origin: *` — verified, not
 * assumed — so `crossOrigin="anonymous"` keeps the canvas untainted and
 * `getImageData` is readable. If that ever stops being true this returns null
 * and every caller falls back to the brand colour.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Signal rose. The fallback, and the default before artwork has loaded. */
export const BRAND_RGB: Rgb = { r: 255, g: 61, b: 154 };

/**
 * 24×24 is plenty. The question is "what colour is this sleeve", not "what is
 * in it", and downsampling is itself the averaging step.
 */
const SAMPLE_SIZE = 24;

const cache = new Map<string, Rgb>();

export function rgbToCss({ r, g, b }: Rgb, alpha = 1): string {
  return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function luminance({ r, g, b }: Rgb): number {
  // Rec. 601 weights: green reads far brighter to the eye than blue, and a
  // straight average would call a saturated blue "dark" and throw it away.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Picks the most *useful* colour rather than the most common one.
 *
 * The most common pixel in an album sleeve is very often near-black or
 * near-white, and a visualizer painted in either is a visualizer you cannot
 * see. Candidates are scored on coverage weighted by saturation, with the
 * extremes of brightness discarded.
 */
function dominant(pixels: Uint8ClampedArray): Rgb | null {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] ?? 0;
    if (alpha < 200) continue;

    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    const colour = { r, g, b };

    const light = luminance(colour);
    if (light < 0.12 || light > 0.93) continue;
    if (saturation(colour) < 0.18) continue;

    // Quantised to 5 bits per channel so near-identical pixels land together.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  let best: { score: number; colour: Rgb } | null = null;
  for (const bucket of buckets.values()) {
    const colour = {
      r: Math.round(bucket.r / bucket.count),
      g: Math.round(bucket.g / bucket.count),
      b: Math.round(bucket.b / bucket.count),
    };
    const score = bucket.count * (0.4 + saturation(colour));
    if (!best || score > best.score) best = { score, colour };
  }

  return best?.colour ?? null;
}

/** Lifts a colour that would be too dark to read against a near-black ground. */
function ensureVisible(colour: Rgb): Rgb {
  const light = luminance(colour);
  if (light >= 0.35) return colour;
  const lift = 0.35 / Math.max(light, 0.05);
  return {
    r: Math.min(255, Math.round(colour.r * lift)),
    g: Math.min(255, Math.round(colour.g * lift)),
    b: Math.min(255, Math.round(colour.b * lift)),
  };
}

export async function sampleArtworkColour(url: string): Promise<Rgb | null> {
  const cached = cache.get(url);
  if (cached) return cached;

  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image();
    element.crossOrigin = "anonymous";
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = url;
  });
  if (!image) return null;

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  let pixels: Uint8ClampedArray;
  try {
    pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    // A tainted canvas throws rather than returning empty data.
    return null;
  }

  const colour = dominant(pixels);
  if (!colour) return null;

  const visible = ensureVisible(colour);
  cache.set(url, visible);
  return visible;
}
