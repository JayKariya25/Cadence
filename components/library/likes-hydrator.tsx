"use client";

import { useEffect } from "react";
import { useLikesStore } from "./likes-store";

/** Seeds the likes store from the server render. Renders nothing. */
export function LikesHydrator({
  ids,
  signedIn,
}: {
  ids: string[];
  signedIn: boolean;
}) {
  const hydrate = useLikesStore((state) => state.hydrate);

  useEffect(() => {
    hydrate(ids, signedIn);
  }, [hydrate, ids, signedIn]);

  return null;
}
