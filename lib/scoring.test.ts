import { describe, expect, it } from "vitest";
import {
  AFFINITY_HALF_LIFE_DAYS,
  EXPLORATION_QUOTA,
  LIKE_WEIGHT,
  REPEAT_PENALTY,
  SEED_WEIGHT,
  SKIP_PENALTY,
  TASTE_WEIGHT,
  accumulate,
  applyExplorationQuota,
  cosineSimilarity,
  decayFactor,
  describeTags,
  engagementWeight,
  explorationSlots,
  familiarTags,
  familiarityScore,
  isFamiliarTrack,
  overlapRelevance,
  scoreCandidate,
  sharedTagsReason,
  tasteReason,
  topTags,
  trackVector,
} from "./scoring";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A listener who plays Balkan and klezmer, and has been skipping metal. */
const FIXTURE_AFFINITY = new Map<string, number>([
  ["balkan", 4.2],
  ["klezmer", 3.1],
  ["world", 2.4],
  ["acoustic", 1.1],
  ["metal", -1.8],
]);

/**
 * A flat IDF makes the assertions about *scoring* independent of the
 * catalogue's tag distribution. Rarity weighting is tested separately.
 */
const FLAT_IDF = new Map<string, number>(
  ["balkan", "klezmer", "world", "acoustic", "metal", "electronic", "ambient"].map(
    (tag) => [tag, 1],
  ),
);

describe("decayFactor", () => {
  it("leaves something that just happened at full weight", () => {
    expect(decayFactor(0)).toBe(1);
  });

  it("halves over one half-life and quarters over two", () => {
    expect(decayFactor(AFFINITY_HALF_LIFE_DAYS * DAY_MS)).toBeCloseTo(0.5, 10);
    expect(decayFactor(2 * AFFINITY_HALF_LIFE_DAYS * DAY_MS)).toBeCloseTo(0.25, 10);
  });

  it("treats a clock skewed into the future as now, not as amplification", () => {
    expect(decayFactor(-DAY_MS)).toBe(1);
  });
});

describe("engagementWeight", () => {
  it("counts a finished track in full", () => {
    expect(
      engagementWeight({ msPlayed: 1_000, durationSeconds: 200, completed: true }),
    ).toBe(1);
  });

  it("counts an early abandon against the track, not merely as zero", () => {
    // 18 seconds of a three-minute track: a rejection.
    expect(
      engagementWeight({ msPlayed: 18_000, durationSeconds: 180, completed: false }),
    ).toBe(SKIP_PENALTY);
  });

  it("scales a partial listen by how much was heard", () => {
    expect(
      engagementWeight({ msPlayed: 90_000, durationSeconds: 180, completed: false }),
    ).toBeCloseTo(0.5, 10);
  });

  it("abstains when the track's length is unknown rather than guessing", () => {
    expect(
      engagementWeight({ msPlayed: 90_000, durationSeconds: 0, completed: false }),
    ).toBe(0);
  });

  it("never exceeds one, however long the tab was left open", () => {
    expect(
      engagementWeight({
        msPlayed: 60 * 60 * 1000,
        durationSeconds: 180,
        completed: false,
      }),
    ).toBe(1);
  });
});

describe("accumulate", () => {
  it("damps a heavily tagged track so it cannot outvote a focused one", () => {
    const many = new Map<string, number>();
    accumulate(many, ["a", "b", "c", "d"], 1);
    const few = new Map<string, number>();
    accumulate(few, ["a"], 1);

    // Square-root damping: each of four tags gets half, not a quarter.
    expect(many.get("a")).toBeCloseTo(0.5, 10);
    expect(few.get("a")).toBe(1);
  });

  it("adds to what is already there", () => {
    const weights = new Map<string, number>();
    accumulate(weights, ["balkan"], 1);
    accumulate(weights, ["balkan"], LIKE_WEIGHT);
    expect(weights.get("balkan")).toBeCloseTo(1 + LIKE_WEIGHT, 10);
  });

  it("counts a repeated tag once", () => {
    const weights = new Map<string, number>();
    accumulate(weights, ["balkan", "balkan"], 1);
    expect(weights.get("balkan")).toBe(1);
  });

  it("ignores an abstention", () => {
    const weights = new Map<string, number>();
    accumulate(weights, ["balkan"], 0);
    expect(weights.size).toBe(0);
  });
});

describe("topTags", () => {
  it("keeps a firmly disliked tag: 'not this' is as useful as 'yes this'", () => {
    const kept = topTags(new Map([["metal", -5], ["ambient", 0.9]]), 1);
    expect([...kept.keys()]).toEqual(["metal"]);
  });

  it("drops noise below the epsilon", () => {
    const kept = topTags(new Map([["balkan", 2], ["dust", 1e-9]]));
    expect(kept.has("dust")).toBe(false);
  });

  it("caps the profile so the user document stays small", () => {
    const wide = new Map(
      Array.from({ length: 200 }, (_, i): [string, number] => [`tag${i}`, i + 1]),
    );
    expect(topTags(wide, 60).size).toBe(60);
  });
});

describe("cosineSimilarity", () => {
  it("is one for the same direction", () => {
    expect(
      cosineSimilarity(new Map([["a", 1], ["b", 1]]), new Map([["a", 2], ["b", 2]])),
    ).toBeCloseTo(1, 10);
  });

  it("is zero when nothing is shared", () => {
    expect(cosineSimilarity(new Map([["a", 1]]), new Map([["b", 1]]))).toBe(0);
  });

  it("is zero against an empty profile", () => {
    expect(cosineSimilarity(new Map(), new Map([["a", 1]]))).toBe(0);
  });

  it("ignores how much someone has listened, only what they listened to", () => {
    // The whole reason for cosine over a dot product: a listener with a year
    // of history must not out-score a listener with a week for the same taste.
    const heavy = new Map([["balkan", 400], ["klezmer", 200]]);
    const light = new Map([["balkan", 4], ["klezmer", 2]]);
    const track = trackVector(["balkan", "klezmer"], FLAT_IDF);

    expect(cosineSimilarity(heavy, track)).toBeCloseTo(
      cosineSimilarity(light, track),
      10,
    );
  });

  it("goes negative when the profile disagrees with the track", () => {
    expect(
      cosineSimilarity(new Map([["metal", -2]]), new Map([["metal", 1]])),
    ).toBeLessThan(0);
  });
});

describe("overlapRelevance", () => {
  it("is one when the candidate covers the whole seed", () => {
    expect(overlapRelevance(["a", "b"], ["a", "b"], FLAT_IDF)).toBe(1);
  });

  it("weights a rare shared tag above a common one", () => {
    const idf = new Map([["klezmer", 4], ["instrumental", 1.05]]);
    const seed = ["klezmer", "instrumental"];
    expect(overlapRelevance(["klezmer"], seed, idf)).toBeGreaterThan(
      overlapRelevance(["instrumental"], seed, idf),
    );
  });

  it("is zero for a seed with no tags rather than dividing by zero", () => {
    expect(overlapRelevance(["a"], [], FLAT_IDF)).toBe(0);
  });
});

describe("scoreCandidate", () => {
  it("falls back to pure similarity with no profile — signed out is not degraded", () => {
    const score = scoreCandidate(
      { tags: ["balkan"], seedRelevance: 0.8 },
      new Map(),
      FLAT_IDF,
    );
    expect(score).toBeCloseTo(0.8, 10);
  });

  it("falls back to pure taste with no seed", () => {
    const tags = ["balkan", "klezmer"];
    const expected = cosineSimilarity(
      FIXTURE_AFFINITY,
      trackVector(tags, FLAT_IDF),
    );
    expect(scoreCandidate({ tags }, FIXTURE_AFFINITY, FLAT_IDF)).toBeCloseTo(
      expected,
      10,
    );
  });

  it("blends the two when both are present", () => {
    const tags = ["balkan", "klezmer"];
    const taste = cosineSimilarity(FIXTURE_AFFINITY, trackVector(tags, FLAT_IDF));
    expect(
      scoreCandidate({ tags, seedRelevance: 0.5 }, FIXTURE_AFFINITY, FLAT_IDF),
    ).toBeCloseTo(TASTE_WEIGHT * taste + SEED_WEIGHT * 0.5, 10);
  });

  it("never lets a disliked tag push the score below zero", () => {
    // A negative blend term would let a hated candidate outrank a neutral one
    // once the seed term was added back.
    const score = scoreCandidate(
      { tags: ["metal"], seedRelevance: 0.6 },
      FIXTURE_AFFINITY,
      FLAT_IDF,
    );
    expect(score).toBeCloseTo(SEED_WEIGHT * 0.6, 10);
  });

  it("penalises something already heard without excluding it", () => {
    const candidate = { tags: ["balkan"], seedRelevance: 0.9 };
    const fresh = scoreCandidate(candidate, FIXTURE_AFFINITY, FLAT_IDF);
    const heard = scoreCandidate(
      { ...candidate, playedBefore: true },
      FIXTURE_AFFINITY,
      FLAT_IDF,
    );
    expect(heard).toBeCloseTo(fresh * REPEAT_PENALTY, 10);
    expect(heard).toBeGreaterThan(0);
  });

  it("lets taste overturn a stronger seed match", () => {
    // The point of the whole phase: two candidates, the weaker match on the
    // search seed wins because it is what this listener actually plays.
    const onTaste = scoreCandidate(
      { tags: ["balkan", "klezmer", "world"], seedRelevance: 0.5 },
      FIXTURE_AFFINITY,
      FLAT_IDF,
    );
    const offTaste = scoreCandidate(
      { tags: ["electronic", "ambient"], seedRelevance: 0.8 },
      FIXTURE_AFFINITY,
      FLAT_IDF,
    );
    expect(onTaste).toBeGreaterThan(offTaste);
  });
});

describe("familiarTags", () => {
  it("is what the listener reaches for, and excludes what they reject", () => {
    const familiar = familiarTags(FIXTURE_AFFINITY, FLAT_IDF);
    expect(familiar.has("balkan")).toBe(true);
    expect(familiar.has("metal")).toBe(false);
  });

  it("prefers the distinctive tag when two are played about as much", () => {
    // Jamendo's vocabulary is full of tags that sit on a third of the
    // catalogue, and anyone who listens at all accumulates them. Ranked by
    // weight alone they crowd out the tags that distinguish one listener from
    // another, and "your usual" degrades to meaning "music".
    const profile = new Map([["instrumental", 3], ["klezmer", 2]]);
    const idf = new Map([["instrumental", 1.02], ["klezmer", 4.5]]);
    expect([...familiarTags(profile, idf, 1)]).toEqual(["klezmer"]);
  });

  it("still yields to an overwhelming weight — rarity is a thumb on the scale, not a veto", () => {
    const profile = new Map([["instrumental", 40], ["klezmer", 2]]);
    const idf = new Map([["instrumental", 1.02], ["klezmer", 4.5]]);
    expect([...familiarTags(profile, idf, 1)]).toEqual(["instrumental"]);
  });

  it("is empty for a listener with no profile", () => {
    expect(familiarTags(new Map(), FLAT_IDF).size).toBe(0);
  });
});

describe("familiarityScore", () => {
  const familiar = new Set(["balkan", "klezmer"]);
  const idf = new Map([
    ["balkan", 4],
    ["klezmer", 4],
    ["instrumental", 1],
    ["electronic", 3],
  ]);

  it("is one when the whole track is what they already play", () => {
    expect(familiarityScore(["balkan", "klezmer"], familiar, idf)).toBe(1);
  });

  it("is zero when none of it is", () => {
    expect(familiarityScore(["electronic"], familiar, idf)).toBe(0);
  });

  it("does not call a track half-familiar for sharing one ubiquitous tag", () => {
    // The bug this replaced: a membership test marked this familiar, so
    // nothing was ever unfamiliar and the exploration quota reserved nothing.
    const score = familiarityScore(["instrumental", "electronic"], new Set(["instrumental"]), idf);
    expect(score).toBeLessThan(0.5);
    expect(isFamiliarTrack(["instrumental", "electronic"], new Set(["instrumental"]), idf)).toBe(false);
  });

  it("treats an untagged track as familiar rather than promoting it", () => {
    expect(familiarityScore([], familiar, idf)).toBe(1);
  });

  it("calls everything familiar when there is no profile", () => {
    expect(isFamiliarTrack(["electronic"], new Set(), idf)).toBe(true);
  });
});

describe("applyExplorationQuota", () => {
  const ranked = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    familiar: i % 2 === 0,
  }));
  const isFamiliar = (item: { familiar: boolean }) => item.familiar;

  it("reserves a fifth of the slots", () => {
    expect(explorationSlots(10)).toBe(Math.round(10 * EXPLORATION_QUOTA));
    const { picked, exploration } = applyExplorationQuota(ranked, 10, isFamiliar);
    expect(picked).toHaveLength(10);
    expect(exploration.size).toBe(2);
    for (const item of exploration) expect(item.familiar).toBe(false);
  });

  it("takes the best unfamiliar candidates, not random ones", () => {
    // Deterministic: randomised exploration would give a different rail on
    // every keystroke for the same query, which reads as a bug.
    const first = applyExplorationQuota(ranked, 10, isFamiliar);
    const second = applyExplorationQuota(ranked, 10, isFamiliar);
    expect(first.picked.map((i) => i.id)).toEqual(second.picked.map((i) => i.id));
    expect([...first.exploration].map((i) => i.id)).toEqual([1, 3]);
  });

  it("backfills in rank order when there is nothing unfamiliar to show", () => {
    const allFamiliar = ranked.map((item) => ({ ...item, familiar: true }));
    const { picked, exploration } = applyExplorationQuota(
      allFamiliar,
      10,
      isFamiliar,
    );
    expect(picked).toHaveLength(10);
    expect(exploration.size).toBe(0);
    expect(picked.map((i) => i.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("preserves rank order exactly when nothing is familiar yet", () => {
    // A brand new listener has no 'usual', so the quota must not reshuffle.
    const { picked } = applyExplorationQuota(ranked, 5, () => true);
    expect(picked.map((i) => i.id)).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns everything it has when asked for more than exists", () => {
    const { picked } = applyExplorationQuota(ranked.slice(0, 3), 10, isFamiliar);
    expect(picked).toHaveLength(3);
  });

  it("returns nothing for a limit of zero", () => {
    expect(applyExplorationQuota(ranked, 0, isFamiliar).picked).toEqual([]);
  });
});

describe("reasons", () => {
  it("writes a list the way a person would say it", () => {
    expect(describeTags(["balkan"])).toBe("balkan");
    expect(describeTags(["balkan", "klezmer"])).toBe("balkan and klezmer");
    expect(describeTags(["a", "b", "c"])).toBe("a, b and c");
  });

  it("says nothing when there is nothing shared", () => {
    expect(sharedTagsReason([])).toBeNull();
  });

  it("names the listener's own strongest matching tags, so it is checkable", () => {
    const reason = tasteReason(
      ["klezmer", "balkan", "electronic"],
      FIXTURE_AFFINITY,
      FLAT_IDF,
    );
    // balkan (4.2) outranks klezmer (3.1); electronic is not in the profile.
    expect(reason?.text).toBe("matches your taste for balkan and klezmer");
  });

  it("names the distinctive tag over the ubiquitous one", () => {
    const profile = new Map([["instrumental", 4], ["klezmer", 1.5]]);
    const idf = new Map([["instrumental", 1.02], ["klezmer", 4.5]]);
    expect(tasteReason(["instrumental", "klezmer"], profile, idf, 1)?.text).toBe(
      "you keep coming back to klezmer",
    );
  });

  it("uses the singular phrasing for a single match", () => {
    expect(tasteReason(["acoustic"], FIXTURE_AFFINITY, FLAT_IDF)?.text).toBe(
      "you keep coming back to acoustic",
    );
  });

  it("claims no taste match on a tag the listener dislikes", () => {
    expect(tasteReason(["metal"], FIXTURE_AFFINITY, FLAT_IDF)).toBeNull();
  });

  it("claims nothing at all without a profile", () => {
    expect(tasteReason(["balkan"], new Map(), FLAT_IDF)).toBeNull();
  });
});
