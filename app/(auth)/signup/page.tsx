import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { AuthForm } from "@/components/auth/auth-form";
import { googleSignInAction, signUpAction } from "../actions";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <AuthForm
      mode="signup"
      action={signUpAction}
      googleEnabled={env.googleAuthEnabled}
      googleAction={googleSignInAction}
    />
  );
}
