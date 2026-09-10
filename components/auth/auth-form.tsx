"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuthFormState } from "@/app/(auth)/actions";

function SubmitButton({ label }: { label: string }) {
  // useFormStatus reads the enclosing form's pending state, which is why this
  // is a separate component — the hook returns nothing when called by the
  // component that renders the <form> itself.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "One moment…" : label}
    </Button>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete,
  error,
  defaultValue,
}: {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  error?: string;
  defaultValue?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        required
      />
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function AuthForm({
  mode,
  action,
  from,
  googleEnabled,
  googleAction,
}: {
  mode: "signin" | "signup";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  from?: string;
  googleEnabled: boolean;
  googleAction: (formData: FormData) => Promise<void>;
}) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});
  const isSignUp = mode === "signup";

  return (
    <div className="w-full max-w-sm">
      <h1 className="display text-3xl">
        {isSignUp ? "Create an account" : "Welcome back"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {isSignUp
          ? "Save what you like and build playlists that stay."
          : "Sign in to pick up where you left off."}
      </p>

      <form action={formAction} className="mt-8 flex flex-col gap-4">
        {from && <input type="hidden" name="from" value={from} />}

        {isSignUp && (
          <Field
            id="name"
            label="Name"
            type="text"
            autoComplete="name"
            error={state.fieldErrors?.name}
          />
        )}
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={state.fieldErrors?.email}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          error={state.fieldErrors?.password}
        />

        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}

        <SubmitButton label={isSignUp ? "Create account" : "Sign in"} />
      </form>

      {googleEnabled && (
        <>
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-hairline" />
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              or
            </span>
            <span className="h-px flex-1 bg-hairline" />
          </div>
          <form action={googleAction}>
            {from && <input type="hidden" name="from" value={from} />}
            <Button type="submit" variant="outline" className="w-full">
              Continue with Google
            </Button>
          </form>
        </>
      )}

      <p className="mt-8 text-sm text-muted-foreground">
        {isSignUp ? "Already have an account? " : "No account yet? "}
        <Link
          href={isSignUp ? "/signin" : "/signup"}
          className="text-brand underline-offset-4 hover:underline"
        >
          {isSignUp ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}
