/**
 * Auth.js configuration.
 *
 * Deliberately adapter-less. `@auth/mongodb-adapter` peers on the v6 MongoDB
 * driver while Mongoose 9 ships v7, and the two cannot coexist — but the
 * adapter would have earned little here anyway: the Credentials provider forces
 * the JWT session strategy, so no session rows exist to persist, leaving the
 * adapter responsible only for writing users. Doing that ourselves means one
 * driver, one connection pool, and every user write passing through the same
 * Mongoose schema as the rest of the app instead of bypassing it via the raw
 * driver.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import bcrypt from "bcryptjs";
import { connectToDatabase } from "./db";
import { env } from "./env";
import { signInSchema } from "./auth-schemas";
import { User, type UserDocument } from "@/models";

export const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

const providers: Provider[] = [
  Credentials({
    name: "Email and password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const parsed = signInSchema.safeParse(credentials);
      if (!parsed.success) return null;

      await connectToDatabase();
      // passwordHash is `select: false`, so it has to be asked for explicitly.
      const user = await User.findOne({ email: parsed.data.email })
        .select("+passwordHash")
        .lean<UserDocument | null>();

      // An OAuth-only account has no hash. Comparing against undefined would
      // throw, and reporting "no password set" would confirm the address
      // exists, so both failures look identical from outside.
      if (!user?.passwordHash) return null;

      const valid = await bcrypt.compare(
        parsed.data.password,
        user.passwordHash,
      );
      if (!valid) return null;

      return {
        id: String(user._id),
        email: user.email,
        name: user.name ?? null,
        image: user.image ?? null,
      };
    },
  }),
];

// Google is additive and optional: absent credentials mean the button is never
// rendered and the provider is never registered, so a fresh clone signs in with
// email and password and needs no Google Cloud project.
if (env.googleAuthEnabled && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Forced, not chosen: Auth.js cannot issue database sessions for the
  // Credentials provider, because there is no adapter call in that flow.
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  providers,
  callbacks: {
    async signIn({ user, account }) {
      // Credentials sign-ins already resolved a real user in `authorize`.
      if (!account || account.provider === "credentials") return true;
      if (!user.email) return false;

      // The work the adapter would have done, through our own schema.
      await connectToDatabase();
      await User.updateOne(
        { email: user.email.toLowerCase() },
        {
          $set: {
            name: user.name ?? undefined,
            image: user.image ?? undefined,
            emailVerified: new Date(),
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
      return true;
    },

    async jwt({ token, user }) {
      // Only on sign-in, not on every request: `user` is populated once.
      if (user?.email) {
        await connectToDatabase();
        const doc = await User.findOne(
          { email: user.email.toLowerCase() },
          { _id: 1 },
        ).lean();
        if (doc) token.uid = String(doc._id);
      }
      return token;
    },

    session({ session, token }) {
      if (token.uid) session.user.id = token.uid;
      return session;
    },
  },
});

/** The signed-in user's id, or null. The one way to ask, everywhere. */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
