"use client";

/**
 * The visualizer.
 *
 * Reads the AnalyserNode built in Phase 1 — the reason the audio proxy exists
 * at all. Same-origin audio is what lets `getByteFrequencyData` return
 * anything but zeros, and `e2e/audio-analyser.spec.ts` has been asserting that
 * since Phase 1 precisely so this could be built on it.
 *
 * Two modes, because frequency and time answer different questions: **Spectrum**
 * shows what the track is made of, **Waveform** shows what it is doing.
 */
import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { getAnalyser } from "@/components/player/audio-graph";
import { BRAND_RGB, rgbToCss, type Rgb } from "./artwork-colour";

export type VisualizerMode = "spectrum" | "waveform";

/**
 * How many bars the spectrum is reduced to.
 *
 * The analyser returns 1024 bins linearly spaced to Nyquist, which is the
 * wrong shape for music: half of them describe 11kHz and above, where almost
 * nothing happens, while every note anybody hums is crowded into the first
 * fifty. The bars are grouped logarithmically to undo that.
 */
const BAR_COUNT = 56;
/** Above this the bins are mostly air; including them flattens the display. */
const USEFUL_BIN_FRACTION = 0.62;

function barRanges(binCount: number): { from: number; to: number }[] {
  const usable = Math.floor(binCount * USEFUL_BIN_FRACTION);
  const ranges: { from: number; to: number }[] = [];
  // Start at bin 1: bin 0 is DC offset, not sound.
  const min = 1;
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const from = Math.floor(min * (usable / min) ** (i / BAR_COUNT));
    const to = Math.floor(min * (usable / min) ** ((i + 1) / BAR_COUNT));
    ranges.push({ from, to: Math.max(to, from + 1) });
  }
  return ranges;
}

export function VisualizerCanvas({
  mode,
  colour,
  animate,
}: {
  mode: VisualizerMode;
  colour: Rgb | null;
  /** False under `prefers-reduced-motion`, unless the listener overrode it. */
  animate: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();
  const tint = colour ?? BRAND_RGB;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    // Smoothed between frames so a single loud transient does not make the
    // whole display jump — the analyser's own smoothing is not enough at this
    // bar count.
    const levels = new Float32Array(BAR_COUNT);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const drawSpectrum = (data: Uint8Array, ranges: { from: number; to: number }[]) => {
      const gap = 2;
      const barWidth = Math.max(1, (width - gap * (BAR_COUNT - 1)) / BAR_COUNT);

      for (let i = 0; i < BAR_COUNT; i += 1) {
        const range = ranges[i];
        if (!range) continue;

        let sum = 0;
        for (let bin = range.from; bin < range.to; bin += 1) sum += data[bin] ?? 0;
        const average = sum / Math.max(1, range.to - range.from) / 255;

        // Rise fast, fall slow: a meter that decays at the speed it climbs
        // reads as flicker rather than as level.
        const previous = levels[i] ?? 0;
        levels[i] = average > previous ? average : previous * 0.86 + average * 0.14;

        const level = levels[i] ?? 0;
        const barHeight = Math.max(2, level * height * 0.92);
        const x = i * (barWidth + gap);
        const y = height - barHeight;

        const gradient = context.createLinearGradient(0, y, 0, height);
        gradient.addColorStop(0, rgbToCss(tint, 0.95));
        gradient.addColorStop(1, rgbToCss(tint, 0.22));
        context.fillStyle = gradient;

        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, Math.min(barWidth / 2, 3));
        context.fill();
      }
    };

    const drawWaveform = (data: Uint8Array) => {
      const middle = height / 2;
      const step = width / data.length;

      context.lineWidth = 2;
      context.strokeStyle = rgbToCss(tint, 0.95);
      context.shadowBlur = 16;
      context.shadowColor = rgbToCss(tint, 0.5);
      context.beginPath();

      for (let i = 0; i < data.length; i += 1) {
        // Time-domain samples are centred on 128, not 0.
        const value = ((data[i] ?? 128) - 128) / 128;
        const x = i * step;
        const y = middle + value * middle * 0.86;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }

      context.stroke();
      context.shadowBlur = 0;
    };

    /** A still, audio-free figure: what the panel shows instead of motion. */
    const drawStill = () => {
      context.clearRect(0, 0, width, height);
      const middle = height / 2;
      context.lineWidth = 2;
      context.strokeStyle = rgbToCss(tint, 0.55);
      context.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const phase = (x / width) * Math.PI * 4;
        // A fixed envelope, so it reads as a waveform without claiming to be
        // this track's waveform.
        const envelope = Math.sin((x / width) * Math.PI) ** 2;
        context.lineTo(x, middle + Math.sin(phase) * middle * 0.4 * envelope);
      }
      context.stroke();
    };

    if (!animate) {
      drawStill();
      return () => observer.disconnect();
    }

    const analyser = getAnalyser();
    if (!analyser) {
      drawStill();
      return () => observer.disconnect();
    }

    const frequency = new Uint8Array(analyser.frequencyBinCount);
    const timeDomain = new Uint8Array(analyser.fftSize);
    const ranges = barRanges(analyser.frequencyBinCount);

    const render = () => {
      context.clearRect(0, 0, width, height);

      if (mode === "spectrum") {
        analyser.getByteFrequencyData(frequency);
        drawSpectrum(frequency, ranges);
      } else {
        analyser.getByteTimeDomainData(timeDomain);
        drawWaveform(timeDomain);
      }

      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [mode, tint, animate]);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      role="img"
      aria-label={
        animate
          ? `${mode === "spectrum" ? "Frequency spectrum" : "Waveform"} of the current track`
          : "Visualizer, paused because your system asks for reduced motion"
      }
      // The canvas is decorative once it is not moving, and a still figure
      // announced as a visualizer is noise to a screen reader.
      aria-hidden={!animate && reduceMotion ? true : undefined}
    />
  );
}
