/**
 * The eight curated moods.
 *
 * Shared between the seed script, which uses `tags` to fetch them, and the
 * home page, which uses `slug` and `label` to render the rows. One definition
 * so a mood can never exist in the database under a name the UI does not know.
 */
export interface Mood {
  readonly slug: string;
  readonly label: string;
  readonly blurb: string;
  /**
   * Tolerant tag match: Jamendo's own tagging is uneven across the catalogue,
   * and several plausible tags ("lofi", for one) simply do not exist in its
   * vocabulary. Every tag below was verified against the live API.
   */
  readonly tags: readonly string[];
}

export const MOODS: readonly Mood[] = [
  {
    slug: "focus",
    label: "Deep Focus",
    blurb: "Ambient and instrumental, nothing competing for your attention",
    tags: ["ambient", "instrumental"],
  },
  {
    slug: "chill",
    label: "Late Night Chill",
    blurb: "Downtempo, low and slow",
    tags: ["chillout", "downtempo"],
  },
  {
    slug: "electronic",
    label: "Electronic",
    blurb: "Synths, machines and four to the floor",
    tags: ["electronic", "dance"],
  },
  {
    slug: "acoustic",
    label: "Acoustic Room",
    blurb: "Wood, strings and air",
    tags: ["acoustic", "folk"],
  },
  {
    slug: "jazz",
    label: "Jazz & Soul",
    blurb: "Brass, keys and the players behind them",
    tags: ["jazz", "soul"],
  },
  {
    slug: "rock",
    label: "Guitars Up",
    blurb: "Loud, and unbothered about it",
    tags: ["rock", "indie"],
  },
  {
    slug: "cinematic",
    label: "Cinematic",
    blurb: "Scores for films that were never made",
    tags: ["soundtrack", "epic"],
  },
  {
    slug: "hiphop",
    label: "Beats & Bars",
    blurb: "Boom bap through to trap",
    tags: ["hiphop", "beats"],
  },
] as const;

export function findMood(slug: string): Mood | undefined {
  return MOODS.find((mood) => mood.slug === slug);
}
