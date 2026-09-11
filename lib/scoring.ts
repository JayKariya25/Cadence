/**
 * The recommender, as arithmetic.
 *
 * Every decision the engine makes is made here, and nothing here touches the
 * database, the network, or React. That is deliberate: a recommender whose
 * scoring lives inside an aggregation pipeline can only be evaluated by
 * running it against real data and squinting at the output. These functions
 * take plain maps and return plain numbers, so `lib/__tests__/scoring.test.ts`
 * can assert that a skip really does count against a tag and that the
 * exploration quota really does reserve its slots.
 *
 * It is also why this module carries no `server-only`: the reason strings are
 * rendered by client components, and the unit tests import it directly under
 * Node.
 */
import type { TrackView } from "./track-view";

// ---------------------------------------------------------------------------
// Time decay
// ---------------------------------------------------------------------------

/**
 * Taste is not a running total, it is a recent memory.
 *
 * Without decay, a fortnight of drum and bass three years ago outvotes what
 * someone has been playing all week, and the profile can never be wrong about
 * you in a way that heals. A 30-day half-life means last month counts half as
 * much as this month and a year ago counts about 1%.
 */
export const AFFINITY_HALF_LIFE_DAYS = 30;
const HALF_LIFE_MS = AFFINITY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Events older than this contribute less than 1.6% of their original weight,
 * which is not worth a `$lookup`. Bounds the aggregation rather than the maths.
 */
export const AFFINITY_WINDOW_DAYS = AFFINITY_HALF_LIFE_DAYS * 6;

export function decayFactor(ageMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  return 0.5 ** (ageMs / HALF_LIFE_MS);
}

// ---------------------------------------------------------------------------
// Turning listening into evidence
// ---------------------------------------------------------------------------

/** Below this share of a track, the listener rejected it rather than heard it. */
export const SKIP_THRESHOLD = 0.2;
/**
 * A skip is evidence, and it is evidence against. Smaller in magnitude than a
 * completed play because the reasons for abandoning a track are noisier than
 * the reasons for finishing one — a phone call is not a verdict on klezmer.
 */
export const SKIP_PENALTY = -0.4;
/**
 * A like is a deliberate statement, so it outweighs any single play. It is not
 * unbounded: liking one track should not make its tags unbeatable forever.
 */
export const LIKE_WEIGHT = 2;
/** What one pick in the cold-start taste picker is worth. */
export const PICK_WEIGHT = 1.5;

export interface PlayEvidence {
  msPlayed: number;
  /** The track's length in seconds, as the catalogue records it. */
  durationSeconds: number;
  completed: boolean;
}

/**
 * How much one play says about the listener, before decay.
 *
 * Play *count* is the wrong unit: pressing play and skipping four seconds
 * later is not a vote in favour. Completion ratio is the unit, which is
 * exactly why Phase 2 records measured listening time rather than incrementing
 * a counter.
 */
export function engagementWeight(evidence: PlayEvidence): number {
  if (evidence.completed) return 1;

  const durationMs = evidence.durationSeconds * 1000;
  // An unknown length cannot be turned into a ratio, and guessing would invent
  // either a skip or a full listen. Abstain instead.
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;

  const ratio = Math.min(1, Math.max(0, evidence.msPlayed / durationMs));
  if (ratio < SKIP_THRESHOLD) return SKIP_PENALTY;
  return ratio;
}

/**
 * Adds one piece of evidence to a running tag profile.
 *
 * Divided by the square root of the tag count, not the count itself: a track
 * carrying twelve tags should not cast twelve times the vote of one carrying
 * three, but each of its tags should still count for more than a twelfth.
 */
export function accumulate(
  target: Map<string, number>,
  tags: readonly string[],
  weight: number,
): void {
  if (weight === 0) return;
  const unique = [...new Set(tags)];
  if (unique.length === 0) return;

  const share = weight / Math.sqrt(unique.length);
  for (const tag of unique) {
    target.set(tag, (target.get(tag) ?? 0) + share);
  }
}

/**
 * The profile as it is stored: the strongest signals only.
 *
 * Ranked by magnitude rather than value so a firmly disliked tag survives the
 * cut — "not this" is as useful to the scorer as "yes this".
 */
export const AFFINITY_TAG_LIMIT = 60;
const AFFINITY_EPSILON = 1e-4;

export function topTags(
  weights: ReadonlyMap<string, number>,
  limit = AFFINITY_TAG_LIMIT,
): Map<string, number> {
  const ranked = [...weights.entries()]
    .filter(
      ([, value]) => Number.isFinite(value) && Math.abs(value) >= AFFINITY_EPSILON,
    )
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit)
    // Four decimals is far below the resolution of anything downstream, and
    // keeps the stored document readable when debugging a bad profile.
    .map(([tag, value]): [string, number] => [tag, Math.round(value * 1e4) / 1e4]);

  return new Map(ranked);
}

// ---------------------------------------------------------------------------
// Comparing a listener to a track
// ---------------------------------------------------------------------------

function magnitude(vector: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const value of vector.values()) total += value * value;
  return Math.sqrt(total);
}

/**
 * Cosine rather than a dot product because the two vectors are on different
 * scales: someone with a year of history has far larger affinity numbers than
 * someone with a week, and without normalising, the heavy listener's every
 * recommendation would score higher than the new listener's best one. Cosine
 * asks about direction — what kind of music — not volume.
 *
 * Can return a negative value when the listener's profile and the track
 * disagree, which is a real result and not clamped here.
 */
export function cosineSimilarity(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): number {
  if (a.size === 0 || b.size === 0) return 0;

  // Walk the shorter vector: the dot product only has terms where both have
  // the tag, so the longer one is a lookup table.
  const [shorter, longer] = a.size <= b.size ? [a, b] : [b, a];

  let dot = 0;
  for (const [tag, value] of shorter) {
    const other = longer.get(tag);
    if (other !== undefined) dot += value * other;
  }
  if (dot === 0) return 0;

  const scale = magnitude(a) * magnitude(b);
  return scale === 0 ? 0 : dot / scale;
}

/**
 * A track as a vector in the same space as a taste profile.
 *
 * Tags are weighted by inverse document frequency so that matching on
 * "klezmer" counts for more than matching on "instrumental" — the same
 * weighting the search rail uses, so the two agree about what a tag is worth.
 */
export function trackVector(
  tags: readonly string[],
  idf: ReadonlyMap<string, number>,
): Map<string, number> {
  const vector = new Map<string, number>();
  for (const tag of new Set(tags)) vector.set(tag, idf.get(tag) ?? 1);
  return vector;
}

/**
 * How much of a seed track this candidate accounts for, 0-1.
 *
 * The share of the seed's own informativeness that the overlap covers, rather
 * than a raw count of shared tags. That keeps it on the same scale as
 * Jamendo's own `relevance` field, so one threshold means one thing whichever
 * path produced the candidate.
 */
export function overlapRelevance(
  shared: readonly string[],
  seedTags: readonly string[],
  idf: ReadonlyMap<string, number>,
): number {
  const seedWeight = [...new Set(seedTags)].reduce(
    (total, tag) => total + (idf.get(tag) ?? 1),
    0,
  );
  if (seedWeight <= 0) return 0;

  const sharedWeight = [...new Set(shared)].reduce(
    (total, tag) => total + (idf.get(tag) ?? 1),
    0,
  );
  return Math.min(1, sharedWeight / seedWeight);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * With a seed present, taste is the larger term but similarity still anchors
 * the result: the listener asked about *this*, and answering with their
 * favourite genre regardless would be a worse rail, not a more personal one.
 */
export const TASTE_WEIGHT = 0.65;
export const SEED_WEIGHT = 0.35;
/**
 * A track already played is not excluded — a good recommendation can be
 * something heard once and forgotten — but it has to clearly beat the unheard
 * to take a slot.
 */
export const REPEAT_PENALTY = 0.35;

export interface CandidateEvidence {
  tags: readonly string[];
  /** Similarity to the search seed, 0-1. Absent when there is no seed. */
  seedRelevance?: number;
  playedBefore?: boolean;
}

/**
 * One number per candidate.
 *
 * Degrades in both directions rather than collapsing: with no taste profile
 * (signed out, or a brand new account that skipped the picker) the score is
 * pure seed similarity, which is exactly Phase 3's behaviour; with no seed it
 * is pure taste.
 */
export function scoreCandidate(
  candidate: CandidateEvidence,
  affinity: ReadonlyMap<string, number>,
  idf: ReadonlyMap<string, number>,
): number {
  const taste =
    affinity.size > 0
      ? Math.max(0, cosineSimilarity(affinity, trackVector(candidate.tags, idf)))
      : null;
  const seed = candidate.seedRelevance ?? null;

  let score: number;
  if (taste !== null && seed !== null) {
    score = TASTE_WEIGHT * taste + SEED_WEIGHT * seed;
  } else {
    score = taste ?? seed ?? 0;
  }

  return candidate.playedBefore ? score * REPEAT_PENALTY : score;
}

// ---------------------------------------------------------------------------
// Exploration
// ---------------------------------------------------------------------------

/**
 * A recommender that only ever confirms what it already believes is a
 * recommender that gets narrower every week, and the listener has no way to
 * tell it that it is wrong. One slot in five is reserved for the best
 * candidate that shares nothing with the profile's strongest tags.
 */
export const EXPLORATION_QUOTA = 0.2;
/** How much of the profile counts as "your usual" for that test. */
export const FAMILIAR_TAG_COUNT = 8;

/**
 * How characteristic a tag is *of this listener*: how much they like it,
 * scaled by how much liking it says about them.
 *
 * Weight alone is not enough. Jamendo's vocabulary is full of tags that sit on
 * a third of the catalogue — "instrumental", "neutral", "travel" — and anyone
 * who listens at all accumulates them. Ranked by weight alone they crowd out
 * the tags that actually distinguish one listener from another, which makes
 * "your usual" mean "music" and makes the explanations read as noise.
 */
function characteristic(
  tag: string,
  weight: number,
  idf: ReadonlyMap<string, number>,
): number {
  return weight * (idf.get(tag) ?? 1);
}

/**
 * How much of a track has to be "your usual" before it stops counting as
 * exploration.
 *
 * A membership test — does this share *any* familiar tag — is useless in
 * practice: almost every candidate shares one, so nothing is ever unfamiliar
 * and the quota reserves no slots. Measuring the *share* of the track that is
 * familiar is what makes the distinction real.
 */
export const FAMILIARITY_THRESHOLD = 0.5;

export function explorationSlots(limit: number): number {
  return Math.max(0, Math.min(limit, Math.round(limit * EXPLORATION_QUOTA)));
}

/** The tags that define what this listener already reaches for. */
export function familiarTags(
  affinity: ReadonlyMap<string, number>,
  idf: ReadonlyMap<string, number>,
  count = FAMILIAR_TAG_COUNT,
): Set<string> {
  return new Set(
    [...affinity.entries()]
      .filter(([, weight]) => weight > 0)
      .sort(
        (a, b) =>
          characteristic(b[0], b[1], idf) - characteristic(a[0], a[1], idf),
      )
      .slice(0, count)
      .map(([tag]) => tag),
  );
}

/**
 * How much of a track is made of things this listener already reaches for,
 * 0-1.
 *
 * Weighted by IDF rather than counted, for the same reason everything else
 * here is: a track that shares one ubiquitous tag with your profile and is
 * otherwise entirely unlike it is not half familiar.
 */
export function familiarityScore(
  tags: readonly string[],
  familiar: ReadonlySet<string>,
  idf: ReadonlyMap<string, number>,
): number {
  const unique = [...new Set(tags)];
  let total = 0;
  let known = 0;
  for (const tag of unique) {
    const weight = idf.get(tag) ?? 1;
    total += weight;
    if (familiar.has(tag)) known += weight;
  }
  // An untagged track cannot be judged unfamiliar, and promoting it into an
  // exploration slot on the strength of having no tags would be nonsense.
  return total <= 0 ? 1 : known / total;
}

/** Is this track mostly made of what the listener already plays? */
export function isFamiliarTrack(
  tags: readonly string[],
  familiar: ReadonlySet<string>,
  idf: ReadonlyMap<string, number>,
): boolean {
  // No profile: nothing can be outside a usual that does not exist yet, so
  // everything is familiar, the quota reserves nothing, and the ranked order
  // is preserved exactly.
  if (familiar.size === 0) return true;
  return familiarityScore(tags, familiar, idf) >= FAMILIARITY_THRESHOLD;
}

/**
 * Fills the result from a ranked list, holding back a fifth of the slots for
 * unfamiliar candidates.
 *
 * Deliberately not random. Randomised exploration is untestable and produces a
 * different rail on every keystroke for the same query, which reads as a bug.
 * This takes the *best* unfamiliar candidates instead, so exploration means
 * "the strongest thing outside your usual", not "a coin toss".
 *
 * Unfilled exploration slots fall back to the ranked order, so a listener whose
 * profile spans the catalogue loses nothing.
 */
export function applyExplorationQuota<T>(
  ranked: readonly T[],
  limit: number,
  isFamiliar: (item: T) => boolean,
): { picked: T[]; exploration: ReadonlySet<T> } {
  if (limit <= 0 || ranked.length === 0) {
    return { picked: [], exploration: new Set() };
  }

  const slots = explorationSlots(limit);
  const unfamiliar = ranked.filter((item) => !isFamiliar(item));
  const explore = unfamiliar.slice(0, slots);
  const exploration = new Set(explore);

  const picked: T[] = [];
  // The familiar head first, in rank order, leaving room for the reserved slots.
  for (const item of ranked) {
    if (picked.length >= limit - explore.length) break;
    if (exploration.has(item)) continue;
    picked.push(item);
  }
  picked.push(...explore);

  // Exploration found fewer candidates than it had slots: backfill in rank
  // order rather than returning a short list.
  if (picked.length < limit) {
    const chosen = new Set(picked);
    for (const item of ranked) {
      if (picked.length >= limit) break;
      if (chosen.has(item)) continue;
      picked.push(item);
    }
  }

  return { picked, exploration };
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

/**
 * Every recommendation Cadence shows carries one of these. The rule is not
 * "explain when convenient": a recommendation with no reason is not rendered
 * as a bare card, it is not a recommendation.
 */
export interface Reason {
  kind: "shared-tags" | "taste" | "exploration";
  text: string;
}

/** "a", "a and b", "a, b and c" — written the way a person would say it. */
export function describeTags(tags: readonly string[]): string {
  const list = tags.filter((tag) => tag.length > 0);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0] ?? "";
  const tail = list[list.length - 1] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${tail}`;
}

export function sharedTagsReason(sharedTags: readonly string[]): Reason | null {
  if (sharedTags.length === 0) return null;
  return { kind: "shared-tags", text: `shares: ${sharedTags.join(", ")}` };
}

/**
 * Names the listener's own tags that this track matches, strongest first —
 * so the explanation is checkable. If it says "you keep coming back to
 * balkan" and the listener has never played anything Balkan, they can see the
 * engine is wrong, which is the whole point of showing the reason.
 */
export function tasteReason(
  tags: readonly string[],
  affinity: ReadonlyMap<string, number>,
  idf: ReadonlyMap<string, number>,
  limit = 2,
): Reason | null {
  if (affinity.size === 0) return null;

  const matched = [...new Set(tags)]
    .map((tag) => ({ tag, weight: affinity.get(tag) ?? 0 }))
    .filter((entry) => entry.weight > 0)
    // Most characteristic first, so the card names what actually marks this
    // listener out rather than the most common tag they happen to have.
    .sort(
      (a, b) =>
        characteristic(b.tag, b.weight, idf) -
        characteristic(a.tag, a.weight, idf),
    )
    .slice(0, limit)
    .map((entry) => entry.tag);

  if (matched.length === 0) return null;
  return {
    kind: "taste",
    text:
      matched.length === 1
        ? `you keep coming back to ${matched[0] ?? ""}`
        : `matches your taste for ${describeTags(matched)}`,
  };
}

export function explorationReason(): Reason {
  return { kind: "exploration", text: "outside your usual — worth a try" };
}

// ---------------------------------------------------------------------------
// The shapes the rest of the app passes around
// ---------------------------------------------------------------------------

export interface Recommendation {
  track: TrackView;
  /** The combined score, after penalties. Shown nowhere; ordering only. */
  score: number;
  /** Never empty: see the note on `Reason`. */
  reasons: Reason[];
  exploration: boolean;
}

/**
 * A recommendation in the search rail, which additionally knows how it relates
 * to the seed. Declared here rather than in `lib/search.ts` so client
 * components can import the type without importing a server-only module.
 */
export interface RelatedTrack extends Recommendation {
  /** Similarity to the seed, 0-1, before personalisation. */
  relevance: number;
  /** The tags the seed and this track have in common. */
  sharedTags: string[];
}
