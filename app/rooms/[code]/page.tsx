import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth";
import { findRoom, isValidRoomCode, normaliseRoomCode } from "@/lib/rooms";
import { RoomExperience } from "@/components/rooms/room-experience";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/rooms/[code]">): Promise<Metadata> {
  const { code } = await params;
  return { title: `Room ${normaliseRoomCode(code)}` };
}

export default async function RoomPage({ params }: PageProps<"/rooms/[code]">) {
  const userId = await currentUserId();
  const { code: rawCode } = await params;
  const code = normaliseRoomCode(rawCode);

  if (!userId) redirect(`/signin?from=%2Frooms%2F${code}`);
  if (!isValidRoomCode(code)) notFound();

  // Checked server-side so a bad code is a 404 rather than a socket that
  // connects and is immediately thrown out.
  const room = await findRoom(code);
  if (!room) notFound();

  return (
    <RoomExperience
      code={room.code}
      hostName={room.hostName}
      createdAt={room.createdAt}
    />
  );
}
