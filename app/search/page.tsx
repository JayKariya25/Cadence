import type { Metadata } from "next";
import { Suspense } from "react";
import { currentUserId } from "@/lib/auth";
import { needsTastePicker } from "@/lib/affinity";
import { getRecentSearches } from "@/lib/search";
import { SearchExperience } from "@/components/search/search-experience";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search" };

export default async function SearchPage() {
  const userId = await currentUserId();
  // Recent searches, deliberately, rather than recommendations: with no query
  // there is no expressed intent, so Cadence has nothing to suggest.
  const [recentSearches, coldStart] = userId
    ? await Promise.all([getRecentSearches(userId), needsTastePicker(userId)])
    : [[], false];

  return (
    <Suspense>
      <SearchExperience
        recentSearches={recentSearches}
        coldStart={coldStart}
      />
    </Suspense>
  );
}
