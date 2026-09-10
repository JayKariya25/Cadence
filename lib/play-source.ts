/**
 * Where a play was started from.
 *
 * Lives outside `models/` so client code can import it without pulling
 * Mongoose into the browser bundle. The PlayEvent schema imports it from here,
 * so there is exactly one definition of the enum.
 */
export const PLAY_SOURCES = [
  "search",
  "playlist",
  "recommendation",
  "radio",
  "room",
  "library",
] as const;

export type PlaySource = (typeof PLAY_SOURCES)[number];
