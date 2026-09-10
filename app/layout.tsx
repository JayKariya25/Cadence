import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Archivo, Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AudioEngine } from "@/components/player/audio-engine";
import { PlayerBar } from "@/components/player/player-bar";
import { KeyboardShortcuts } from "@/components/player/keyboard-shortcuts";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
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

        <header className="sticky top-0 z-20 border-b border-hairline bg-background/80 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-5 py-3 sm:px-8">
            <Link href="/" className="flex items-center gap-2.5">
              <span aria-hidden className="h-5 w-1.5 rounded-full bg-brand" />
              <span className="display text-sm uppercase tracking-[0.22em]">
                Cadence
              </span>
            </Link>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <PlayerBar />
        <Toaster />
      </body>
    </html>
  );
}
