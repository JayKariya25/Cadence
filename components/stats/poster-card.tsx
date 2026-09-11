"use client";

/**
 * The shareable poster.
 *
 * Drawn onto a canvas rather than screenshotted from the DOM with something
 * like html2canvas. Three reasons: the export is exactly the same 1080×1350
 * image on every machine instead of whatever the viewport happened to be, it
 * adds no dependency, and html2canvas re-implements CSS layout approximately —
 * which is a strange thing to trust with the one artefact a person actually
 * shares.
 *
 * The artwork is requested with `crossOrigin="anonymous"`. Jamendo's image CDN
 * sends `access-control-allow-origin: *`, so the canvas stays untainted and
 * `toBlob` works; if that ever stops being true the draw falls back to a
 * gradient rather than failing the download.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const WIDTH = 1080;
const HEIGHT = 1350;
const MARGIN = 84;

export interface PosterData {
  rangeLabel: string;
  hours: string;
  distinctTracks: number;
  activeDays: number;
  streakDays: number;
  completionPercent: number;
  topArtist: string | null;
  topTrack: string | null;
  topTrackArtist: string | null;
  artworkUrl: string | null;
  tags: string[];
}

/** Jamendo sizes its artwork by query parameter; ask for one worth printing. */
function highResArtwork(url: string): string {
  return url.replace(/width=\d+/, "width=600");
}

/** The family names next/font generated, read off the live stylesheet. */
function resolveFonts(): { display: string; sans: string; mono: string } {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);

  const read = (className: string, fallback: string): string => {
    probe.className = className;
    const family = getComputedStyle(probe).fontFamily;
    return family || fallback;
  };

  const fonts = {
    display: read("display", "system-ui"),
    sans: read("font-sans", "system-ui"),
    mono: read("font-mono", "monospace"),
  };
  probe.remove();
  return fonts;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** Shrinks a line until it fits, then truncates if it still does not. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  family: string,
  startSize: number,
  minSize: number,
  weight = "700",
): number {
  let size = startSize;
  ctx.font = `${weight} ${size}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 2;
    ctx.font = `${weight} ${size}px ${family}`;
  }
  return size;
}

function truncateToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let clipped = text;
  while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped.trimEnd()}…`;
}

async function draw(
  canvas: HTMLCanvasElement,
  data: PosterData,
): Promise<void> {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Without this the first draw uses the fallback stack and the second uses
  // Archivo, so the poster silently changes between preview and download.
  await document.fonts.ready;
  const fonts = resolveFonts();

  const artwork = data.artworkUrl
    ? await loadImage(highResArtwork(data.artworkUrl))
    : null;

  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#0a0a0b";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // A single rose bloom behind the masthead — the one flourish.
  const glow = ctx.createRadialGradient(WIDTH * 0.82, 180, 0, WIDTH * 0.82, 180, 620);
  glow.addColorStop(0, "rgba(255, 61, 154, 0.22)");
  glow.addColorStop(1, "rgba(255, 61, 154, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, 800);

  // --- masthead ------------------------------------------------------------
  ctx.fillStyle = "#ff3d9a";
  ctx.beginPath();
  ctx.roundRect(MARGIN, MARGIN, 10, 34, 5);
  ctx.fill();

  ctx.fillStyle = "#e9e7ef";
  ctx.font = `700 26px ${fonts.display}`;
  ctx.letterSpacing = "6px";
  ctx.textBaseline = "top";
  ctx.fillText("CADENCE", MARGIN + 28, MARGIN + 5);

  ctx.fillStyle = "#a6a2b2";
  ctx.font = `500 20px ${fonts.sans}`;
  ctx.letterSpacing = "3px";
  ctx.textAlign = "right";
  ctx.fillText(data.rangeLabel.toUpperCase(), WIDTH - MARGIN, MARGIN + 10);
  ctx.textAlign = "left";
  ctx.letterSpacing = "0px";

  // --- artwork and the headline number -------------------------------------
  const artSize = 400;
  const artY = MARGIN + 120;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(MARGIN, artY, artSize, artSize, 20);
  ctx.clip();
  if (artwork) {
    ctx.drawImage(artwork, MARGIN, artY, artSize, artSize);
  } else {
    const placeholder = ctx.createLinearGradient(
      MARGIN, artY, MARGIN + artSize, artY + artSize,
    );
    placeholder.addColorStop(0, "#ff3d9a");
    placeholder.addColorStop(1, "#6e7bff");
    ctx.fillStyle = placeholder;
    ctx.fillRect(MARGIN, artY, artSize, artSize);
  }
  ctx.restore();

  const columnX = MARGIN + artSize + 56;
  const columnWidth = WIDTH - MARGIN - columnX;

  ctx.fillStyle = "#ff3d9a";
  const hoursSize = fitText(ctx, data.hours, columnWidth, fonts.display, 168, 96);
  ctx.font = `700 ${hoursSize}px ${fonts.display}`;
  ctx.fillText(data.hours, columnX, artY + 40);

  ctx.fillStyle = "#e9e7ef";
  ctx.font = `600 26px ${fonts.sans}`;
  ctx.letterSpacing = "2px";
  ctx.fillText("HOURS LISTENED", columnX, artY + 60 + hoursSize);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = "#a6a2b2";
  ctx.font = `400 24px ${fonts.sans}`;
  const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;
  ctx.fillText(
    `${plural(data.distinctTracks, "track")} · ${plural(data.activeDays, "day")}`,
    columnX,
    artY + 104 + hoursSize,
  );

  // --- the three facts -----------------------------------------------------
  let y = artY + artSize + 96;
  const rowWidth = WIDTH - MARGIN * 2;

  const rule = (atY: number) => {
    ctx.strokeStyle = "#262630";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN, atY);
    ctx.lineTo(WIDTH - MARGIN, atY);
    ctx.stroke();
  };

  const row = (label: string, value: string, sub?: string) => {
    rule(y);
    y += 30;

    ctx.fillStyle = "#a6a2b2";
    ctx.font = `500 19px ${fonts.sans}`;
    ctx.letterSpacing = "3px";
    ctx.fillText(label, MARGIN, y);
    ctx.letterSpacing = "0px";
    y += 34;

    ctx.fillStyle = "#e9e7ef";
    const size = fitText(ctx, value, rowWidth, fonts.display, 52, 34);
    ctx.font = `700 ${size}px ${fonts.display}`;
    ctx.fillText(truncateToWidth(ctx, value, rowWidth), MARGIN, y);
    y += size + 12;

    if (sub) {
      ctx.fillStyle = "#a6a2b2";
      ctx.font = `400 23px ${fonts.sans}`;
      ctx.fillText(truncateToWidth(ctx, sub, rowWidth), MARGIN, y);
      y += 34;
    }
    y += 22;
  };

  if (data.topArtist) row("TOP ARTIST", data.topArtist);
  if (data.topTrack) {
    row("TOP TRACK", data.topTrack, data.topTrackArtist ?? undefined);
  }
  if (data.tags.length > 0) row("YOUR SOUND", data.tags.join(" · "));

  // --- footer --------------------------------------------------------------
  rule(HEIGHT - MARGIN - 58);
  ctx.fillStyle = "#a6a2b2";
  ctx.font = `400 23px ${fonts.sans}`;
  ctx.fillText(
    `${data.streakDays}-day streak · ${data.completionPercent}% played to the end`,
    MARGIN,
    HEIGHT - MARGIN - 30,
  );


  ctx.textAlign = "right";
  ctx.fillStyle = "#4a4757";
  ctx.font = `500 21px ${fonts.mono}`;
  ctx.fillText("cadence", WIDTH - MARGIN, HEIGHT - MARGIN - 30);
  ctx.textAlign = "left";
}

export function PosterCard({ data }: { data: PosterData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    setReady(false);
    void draw(canvas, data).then(() => {
      // The range can change while an artwork request is still in flight;
      // the stale draw must not mark a poster for the wrong range as ready.
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.toBlob((blob) => {
      if (!blob) {
        toast.error("Could not render that poster.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cadence-${data.rangeLabel.toLowerCase().replace(/\s+/g, "-")}.png`;
      link.click();
      // Revoking immediately can cancel the download in some browsers; one
      // frame is enough for the click to have been handled.
      requestAnimationFrame(() => URL.revokeObjectURL(url));
      toast("Poster saved");
    }, "image/png");
  }, [data.rangeLabel]);

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        // Exported at a fixed 1080×1350 whatever the screen; shown small.
        className="w-full max-w-[300px] rounded-lg border border-hairline"
        aria-label="Your listening poster"
        role="img"
      />
      <Button onClick={download} disabled={!ready} variant="outline" size="sm">
        <Download className="h-3.5 w-3.5" />
        {ready ? "Download PNG" : "Rendering…"}
      </Button>
    </div>
  );
}
