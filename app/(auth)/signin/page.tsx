import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { AuthForm } from "@/components/auth/auth-form";
import { googleSignInAction, signInAction } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: PageProps<"/signin">) {
  const session = await auth();
  if (session?.user) redirect("/");

  const params = await props.searchParams;
  const from = typeof params.from === "string" ? params.from : undefined;

  return (
    <AuthForm
      mode="signin"
      action={signInAction}
      from={from}
      googleEnabled={env.googleAuthEnabled}
      googleAction={googleSignInAction}
    />
  );
}
