"use server";

/**
 * The cold-start taste picker.
 *
 * A recommender with no history has two options: recommend nothing, or
 * recommend whatever is popular and call it personal. Cadence does neither —
 * it asks. Three picks is enough to order a rail sensibly, and the picks decay
 * on the same 30-day clock as real listening, so they fade rather than being
 * switched off on some arbitrary day.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUserId } from "@/lib/auth";
import { MIN_TASTE_PICKS, TASTE_PICK_SLUGS, saveTastePicks } from "@/lib/affinity";

export interface TasteFormState {
  error?: string;
}

const picksSchema = z
  .array(z.enum(TASTE_PICK_SLUGS as [string, ...string[]]))
  .min(MIN_TASTE_PICKS, `Choose at least ${MIN_TASTE_PICKS}.`);

export async function saveTastePicksAction(
  _previous: TasteFormState,
  formData: FormData,
): Promise<TasteFormState> {
  const userId = await currentUserId();
  if (!userId) redirect("/signin?from=/welcome");

  const parsed = picksSchema.safeParse(formData.getAll("mood").map(String));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Choose at least three." };
  }

  try {
    await saveTastePicks(userId, parsed.data);
  } catch (error) {
    console.error("[taste] could not save picks:", error);
    return { error: "Could not save that. Try again." };
  }

  // Into search, not onto a generated home page: the picks make the rail
  // personal, and the rail only exists once something has been asked for.
  redirect("/search");
}
