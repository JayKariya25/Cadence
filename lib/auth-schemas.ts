/**
 * Validation for the credentials flow.
 *
 * Shared by the sign-up server action and the Credentials provider's
 * `authorize`, so the rules a password must satisfy are defined once.
 */
import { z } from "zod";

export const emailSchema = z
  .email("Enter a valid email address")
  .trim()
  .toLowerCase();

/**
 * Length over composition rules. Forcing a symbol and a digit measurably
 * pushes people toward "Password1!" rather than toward entropy.
 */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "That is longer than 200 characters");

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});

export const signUpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Tell us what to call you")
    .max(60, "That name is too long"),
  email: emailSchema,
  password: passwordSchema,
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
