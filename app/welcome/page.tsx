import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth";
import { getTastePicks } from "@/lib/affinity";
import { TastePicker } from "@/components/taste/taste-picker";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tell us what you listen to" };

export default async function WelcomePage() {
  const userId = await currentUserId();
  if (!userId) redirect("/signin?from=/welcome");

  // Reachable again from the account menu, so it renders what was chosen last
  // time rather than starting blank and silently discarding it.
  const picks = await getTastePicks(userId);

  return (
    <div className="mx-auto flex w-full max-w-[1100px] justify-center px-5 py-14 sm:px-8">
      <TastePicker initial={picks} />
    </div>
  );
}
