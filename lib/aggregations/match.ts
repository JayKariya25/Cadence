import "server-only";
import type { PipelineStage, Types } from "mongoose";
import type { ResolvedRange } from "./range";

/**
 * The opening stage of every pipeline in this directory.
 *
 * Matches the `{ userId: 1, playedAt: -1 }` index exactly, which is the reason
 * these are seven separate pipelines rather than one `$facet`: a `$facet`
 * sub-pipeline cannot use an index at all, so bundling them would trade seven
 * index seeks for one collection scan feeding every branch.
 */
export function matchStage(
  userId: Types.ObjectId,
  { since }: ResolvedRange,
): PipelineStage.Match {
  return {
    $match: {
      userId,
      ...(since ? { playedAt: { $gte: since } } : {}),
    },
  };
}
