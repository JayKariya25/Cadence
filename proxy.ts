/**
 * Route protection.
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts` and, importantly, made it run
 * on the Node.js runtime by default. That removes the split edge-safe/server
 * auth config Auth.js normally requires — this file can import the real config
 * directly. It is still only a coarse gate: it checks that a session exists,
 * never what it may do. Ownership and visibility are enforced again in the
 * server actions and page loaders, because a proxy is a redirect, not a
 * security boundary.
 */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/** Prefixes that require a signed-in user. */
const PROTECTED = ["/library", "/liked", "/playlist/new"];

export default auth((request) => {
  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (needsAuth && !request.auth) {
    const signIn = new URL("/signin", request.nextUrl.origin);
    // Come back to where they were headed once they are signed in.
    signIn.searchParams.set("from", pathname);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
});

export const config = {
  // Everything except Next internals, the auth endpoints themselves, and the
  // audio proxy — which is hit constantly and must not pay for a session read.
  matcher: ["/((?!_next/static|_next/image|api/auth|api/stream|favicon.ico).*)"],
};
