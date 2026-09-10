"use client";

/**
 * Which tracks the signed-in user has liked.
 *
 * A client-side set hydrated once per page load. Without it every like button —
 * in a list, on a card, and in the player bar — would have to ask the server
 * for its own state on mount, and the player bar's button in particular has no
 * server render to inherit from.
 */
import { create } from "zustand";

interface LikesState {
  ids: Set<string>;
  hydrated: boolean;
  /**
   * Whether anyone is signed in. Carried here so client-only surfaces — the
   * player bar above all — can render the right affordance without threading a
   * session prop down through components that have no other reason to know.
   */
  signedIn: boolean;
  hydrate(ids: readonly string[], signedIn: boolean): void;
  isLiked(trackId: string): boolean;
  set(trackId: string, liked: boolean): void;
}

export const useLikesStore = create<LikesState>((set, get) => ({
  ids: new Set(),
  hydrated: false,
  signedIn: false,

  hydrate(ids, signedIn) {
    set({ ids: new Set(ids), hydrated: true, signedIn });
  },

  isLiked(trackId) {
    return get().ids.has(trackId);
  },

  set(trackId, liked) {
    // A new Set each time: mutating in place would not change the reference,
    // and subscribed components would never re-render.
    const next = new Set(get().ids);
    if (liked) next.add(trackId);
    else next.delete(trackId);
    set({ ids: next });
  },
}));
