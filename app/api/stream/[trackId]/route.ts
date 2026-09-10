/**
 * Audio stream proxy.
 *
 * Two problems, one route:
 *
 * 1. **CORS / the AnalyserNode.** The Web Audio API refuses to expose sample
 *    data for a cross-origin media element unless the response carries
 *    permissive CORS headers, which Jamendo's CDN does not. Reading
 *    `getByteFrequencyData` off a Jamendo URL directly returns silence — all
 *    zeroes — with no error. Proxying makes the audio same-origin, so the
 *    analyser can read it.
 *
 * 2. **Seeking.** A browser seeks by issuing a `Range` request. A proxy that
 *    ignores ranges and always replies 200 makes the scrubber unusable: the
 *    element can only ever play from the start. This route forwards the
 *    client's `Range` header upstream and passes the 206 response back intact.
 *
 * 3. **A wrong Content-Type.** Jamendo's stable download URL answers with
 *    `text/html`, which browsers refuse to decode as audio. The proxy
 *    normalises it.
 *
 * The `<audio>` element therefore points here and never at Jamendo.
 */
import { after } from "next/server";
import type { NextRequest } from "next/server";
import { getStreamSources, getTrackByJamendoId } from "@/lib/catalogue";

/** Streaming a response body is inherently dynamic; never try to cache it. */
export const dynamic = "force-dynamic";

/**
 * Headers worth passing through from Jamendo verbatim. `content-type` is
 * deliberately absent: it is normalised below rather than forwarded.
 */
const FORWARDED_RESPONSE_HEADERS = [
  "content-length",
  "content-range",
  "last-modified",
  "etag",
] as const;

/** Cadence always requests mp3 encodes, so this is the only correct type. */
const AUDIO_CONTENT_TYPE = "audio/mpeg";

function buildResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  // Never forwarded. The stable download endpoint reports "text/html", and a
  // browser will not decode audio it has been told is a document.
  const upstreamType = upstream.headers.get("content-type");
  headers.set(
    "content-type",
    upstreamType?.startsWith("audio/") ? upstreamType : AUDIO_CONTENT_TYPE,
  );

  // Without this the browser will not attempt a range request at all, and the
  // scrubber degrades to play-from-the-start.
  headers.set("accept-ranges", "bytes");

  // Private: the bytes are public CC audio, but the URL is ours and there is
  // no reason for a shared cache to hold it. An hour is enough for seeking
  // back and forth within a track to stay cheap.
  headers.set("cache-control", "private, max-age=3600");

  return headers;
}

async function proxy(
  request: NextRequest,
  trackId: string,
  method: "GET" | "HEAD",
): Promise<Response> {
  const track = await getTrackByJamendoId(trackId);
  if (!track) {
    return new Response("Track not found in the catalogue.", { status: 404 });
  }

  const sources = getStreamSources(track);
  if (sources.length === 0) {
    return new Response("No audio source is stored for this track.", {
      status: 404,
    });
  }

  const range = request.headers.get("range");
  const upstreamHeaders = new Headers();
  if (range) upstreamHeaders.set("range", range);

  let lastStatus = 502;

  for (const source of sources) {
    let upstream: Response;
    try {
      upstream = await fetch(source, {
        method,
        headers: upstreamHeaders,
        // Abort the upstream fetch when the listener skips or closes the tab,
        // rather than streaming bytes nobody is waiting for.
        signal: request.signal,
        cache: "no-store",
        redirect: "follow",
      });
    } catch (error) {
      if (request.signal.aborted) {
        // The client went away first. Not a failure worth reporting.
        return new Response(null, { status: 499 });
      }
      console.error(`[stream] ${trackId}: fetch failed for ${source}`, error);
      continue;
    }

    if (!upstream.ok && upstream.status !== 206) {
      // Individual tracks do disappear from Jamendo's storage. Try the next
      // source before giving up on the track.
      await upstream.body?.cancel();
      lastStatus = upstream.status;
      continue;
    }

    const headers = buildResponseHeaders(upstream);

    if (method === "HEAD") {
      // Cancel the body explicitly: a HEAD response must not carry one, and an
      // unread stream would otherwise sit open.
      after(() => upstream.body?.cancel());
      return new Response(null, { status: upstream.status, headers });
    }

    // 206 must be preserved. Collapsing it to 200 tells the browser the whole
    // file arrived, and playback jumps to the wrong position.
    return new Response(upstream.body, {
      status: upstream.status === 206 ? 206 : 200,
      headers,
    });
  }

  console.error(`[stream] ${trackId}: every source failed (last ${lastStatus}).`);
  return new Response("This track is no longer available from Jamendo.", {
    status: 502,
  });
}

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/stream/[trackId]">,
): Promise<Response> {
  const { trackId } = await context.params;
  return proxy(request, trackId, "GET");
}

export async function HEAD(
  request: NextRequest,
  context: RouteContext<"/api/stream/[trackId]">,
): Promise<Response> {
  const { trackId } = await context.params;
  return proxy(request, trackId, "HEAD");
}
