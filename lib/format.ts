/** Formats seconds as m:ss, or h:mm:ss past an hour. Safe on NaN. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

/**
 * Listening time for a statistics page: "3h 24m", "47m", "38s".
 *
 * Distinct from `formatDuration`, which formats a *track's* length as a
 * timecode. A total of eleven hours rendered as 11:03:42 reads like a scrubber
 * position rather than an amount of time spent.
 */
export function formatListeningTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (totalMinutes > 0) return `${totalMinutes}m`;
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

/** Hours as a single decimal — the headline number on the stats poster. */
export function formatHours(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 100) return String(Math.round(hours));
  return (Math.round(hours * 10) / 10).toFixed(1);
}

/** "21:00", from an hour index. */
export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
