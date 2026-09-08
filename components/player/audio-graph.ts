"use client";

/**
 * The Web Audio graph.
 *
 * `createMediaElementSource` may be called at most once per media element, and
 * once it is called the element's audio routes exclusively through the graph —
 * if the AudioContext is suspended, nothing is audible. Both facts make this a
 * module-level singleton rather than component state: React may remount, the
 * graph must not.
 *
 * The context is created on a user gesture. Browsers start an AudioContext
 * suspended otherwise, which would mean a play button that silently does
 * nothing.
 */
let context: AudioContext | null = null;
let source: MediaElementAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let boundElement: HTMLAudioElement | null = null;

/**
 * Connects the element to the graph, creating it on first call, and returns
 * the analyser. Safe to call on every play.
 */
export function ensureAudioGraph(element: HTMLAudioElement): AnalyserNode {
  context ??= new AudioContext();

  // React may remount the engine (Strict Mode does it deliberately in
  // development) and hand us a brand new element. The old source node cannot
  // be re-pointed, so it is torn down and replaced — otherwise the graph stays
  // wired to a detached element and the analyser reads permanent silence.
  if (source && boundElement !== element) {
    source.disconnect();
    analyser?.disconnect();
    source = null;
    analyser = null;
  }

  if (!source) {
    boundElement = element;
    source = context.createMediaElementSource(element);
    analyser = context.createAnalyser();
    // 2048 bins is the usual compromise: enough resolution for a frequency
    // display without spending a frame budget on the copy.
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    analyser.connect(context.destination);

    if (process.env.NODE_ENV !== "production") {
      // Test hook. The end-to-end audio check asserts that
      // getByteFrequencyData returns non-zero data through the proxy, and it
      // has no other way to reach a module-scoped node.
      (window as unknown as { __cadenceAnalyser?: AnalyserNode })
        .__cadenceAnalyser = analyser;
    }
  }

  return analyser as AnalyserNode;
}

/** Resumes a context the browser suspended. Call from a user gesture. */
export async function resumeAudioContext(): Promise<void> {
  if (context && context.state === "suspended") {
    await context.resume();
  }
}

/** The analyser, once the graph exists. Phase 7's visualizer reads from this. */
export function getAnalyser(): AnalyserNode | null {
  return analyser;
}
