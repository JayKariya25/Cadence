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

/**
 * Eight moods by feel, then eight by musical tradition.
 *
 * The regional rows exist because a catalogue seeded only on ambient,
 * electronic and rock reads as a stock-music library. Every tag below was
 * verified to return results against the live API — Jamendo's vocabulary is
 * not guessable ("indian" and "african" work; "asian" and "tabla" return
 * nothing at all).
 */
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
  {
    slug: "india",
    label: "Sounds of India",
    blurb: "Sitar, tabla and film-score melody",
    tags: ["indian"],
  },
  {
    slug: "latin",
    label: "Latin & Brazilian",
    blurb: "Samba, bossa nova and everything with hips",
    tags: ["latin"],
  },
  {
    slug: "african",
    label: "African Currents",
    blurb: "Polyrhythm, kora and afrobeat",
    tags: ["african"],
  },
  {
    slug: "eastasia",
    label: "East Asian",
    blurb: "Koto, shakuhachi and modern Tokyo",
    tags: ["japanese"],
  },
  {
    slug: "balkan",
    label: "Balkan & Klezmer",
    blurb: "Brass, odd time signatures, no apologies",
    tags: ["balkan"],
  },
  {
    slug: "reggae",
    label: "Reggae & Dub",
    blurb: "Offbeat guitar and a lot of reverb",
    tags: ["reggae"],
  },
  {
    slug: "flamenco",
    label: "Flamenco & Mediterranean",
    blurb: "Nylon strings and hand claps",
    tags: ["flamenco"],
  },
  {
    slug: "oriental",
    label: "Middle Eastern",
    blurb: "Oud, maqam and desert air",
    tags: ["oriental"],
  },
] as const;

export function findMood(slug: string): Mood | undefined {
  return MOODS.find((mood) => mood.slug === slug);
}
