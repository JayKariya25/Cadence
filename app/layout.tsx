import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Archivo, Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AudioEngine } from "@/components/player/audio-engine";
import { PlayerBar } from "@/components/player/player-bar";
import { KeyboardShortcuts } from "@/components/player/keyboard-shortcuts";
import { PlaybackReporter } from "@/components/player/playback-reporter";
import { AccountMenu, SignedOutActions } from "@/components/auth/account-menu";
import { LikesHydrator } from "@/components/library/likes-hydrator";
import { auth } from "@/lib/auth";
import { getLikedTrackIds } from "@/lib/library";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/*
  Archivo carries a width axis; Cadence sets it slightly expanded (110%) for
  display type so headings read like console signage rather than UI chrome.
*/
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  // Variable on both axes: `weight` must stay unset for `axes` to be allowed.
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: {
    default: "Cadence",
    template: "%s · Cadence",
  },
  description:
    "A music streaming app where recommendations appear on intent, not by default.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  const userId = session?.user?.id;
  // Fetched once per navigation so every like button — including the player
  // bar's, which has no server render of its own — knows its state on first
  // paint instead of flickering from unliked to liked.
  const likedIds = userId ? await getLikedTrackIds(userId) : [];
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/*
          AudioEngine and PlayerBar live in the layout, not in a page, so they
          survive every navigation. That is the whole reason playback does not
          stutter when the listener opens an artist page mid-track.
        */}
        <AudioEngine />
        <KeyboardShortcuts />
        <PlaybackReporter signedIn={Boolean(userId)} />
        <LikesHydrator ids={likedIds} signedIn={Boolean(userId)} />

        <header className="sticky top-0 z-20 border-b border-hairline bg-background/80 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] items-center gap-4 px-5 py-3 sm:px-8">
            <Link href="/" className="flex shrink-0 items-center gap-2.5">
              <span aria-hidden className="h-5 w-1.5 rounded-full bg-brand" />
              <span className="display text-sm uppercase tracking-[0.22em]">
                Cadence
              </span>
            </Link>

            <nav className="flex items-center gap-1">
              <Link
                href="/search"
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                Search
              </Link>
            </nav>

            {userId && (
              <nav className="hidden items-center gap-1 sm:flex">
                <Link
                  href="/liked"
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  Liked Songs
                </Link>
                <Link
                  href="/library"
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  Your Library
                </Link>
              </nav>
            )}

            <div className="ml-auto flex items-center gap-2">
              {session?.user ? (
                <AccountMenu
                  name={session.user.name}
                  email={session.user.email}
                  image={session.user.image}
                />
              ) : (
                <SignedOutActions />
              )}
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <PlayerBar />
        <Toaster />
      </body>
    </html>
  );
}
