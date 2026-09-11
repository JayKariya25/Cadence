"use server";

/**
 * Credentials sign-up and sign-in.
 *
 * Server Actions rather than route handlers: the forms are progressively
 * enhanced through `useActionState`, so they submit and report errors without
 * a client-side fetch layer in between.
 */
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { connectToDatabase } from "@/lib/db";
import { hashPassword, signIn } from "@/lib/auth";
import { signInSchema, signUpSchema } from "@/lib/auth-schemas";
import { User } from "@/models";

export interface AuthFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

function fieldErrorsFrom(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/**
 * Only same-site paths are accepted as a post-sign-in destination. Echoing an
 * arbitrary `from` value back into redirect() is an open-redirect: an attacker
 * links to /signin?from=https://evil.example and the app sends the user there
 * wearing a fresh session.
 */
function safeRedirect(value: FormDataEntryValue | null): string {
  const target = typeof value === "string" ? value : "";
  return target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const { name, email, password } = parsed.data;

  try {
    await connectToDatabase();

    const existing = await User.exists({ email });
    if (existing) {
      return { fieldErrors: { email: "That email is already registered" } };
    }

    await User.create({
      email,
      name,
      passwordHash: await hashPassword(password),
    });

    // Straight into a session: making someone sign in again immediately after
    // creating an account is friction with no security benefit. `redirect:
    // false` keeps signIn from throwing a redirect through this try block,
    // which would otherwise be caught below and reported as a failure.
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    // The unique index is the real guard against two simultaneous sign-ups
    // racing past the exists() check above.
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: number }).code === 11000
    ) {
      return { fieldErrors: { email: "That email is already registered" } };
    }

    console.error("[auth] sign-up failed:", error);
    return { error: "Something went wrong creating your account." };
  }

  // Outside the try: redirect() works by throwing, and must not be caught.
  // Into the taste picker rather than the home page: a brand new account has
  // no history, and asking once is the difference between a rail ordered by
  // this listener's taste and a rail ordered by nothing.
  redirect("/welcome");
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  const redirectTo = safeRedirect(formData.get("from"));

  try {
    await signIn("credentials", { ...parsed.data, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // Never distinguish "no such account" from "wrong password": that
      // difference is an account-enumeration oracle.
      return { error: "That email and password do not match." };
    }
    console.error("[auth] sign-in failed:", error);
    return { error: "Something went wrong signing you in." };
  }

  redirect(redirectTo);
}

/** Starts the Google OAuth redirect. Only rendered when Google is configured. */
export async function googleSignInAction(formData: FormData): Promise<void> {
  await signIn("google", { redirectTo: safeRedirect(formData.get("from")) });
}
