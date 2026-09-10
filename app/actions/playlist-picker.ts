"use server";

import { currentUserId } from "@/lib/auth";
import { getPlaylistsForUser, type PlaylistSummary } from "@/lib/playlists";

/**
 * The signed-in user's playlists, for the "Add to playlist" menu.
 *
 * Fetched on demand when the menu opens rather than embedded in every page: a
 * listener with thirty playlists should not pay for that list on a page where
 * they never open the menu.
 */
export async function getMyPlaylistsAction(): Promise<PlaylistSummary[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  return getPlaylistsForUser(userId);
}
