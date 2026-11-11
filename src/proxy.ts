import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasClerkCredentials, shouldFailClosedForClerk } from "@/lib/clerk/config";

const clerkIsConfigured = hasClerkCredentials();
const clerkMustFailClosed = shouldFailClosedForClerk();
// Development machines drift (one was 5½ minutes slow with Windows time sync off),
// and a rejected session token makes Clerk redirect in a loop.
const clerkDevelopmentOptions = process.env.NODE_ENV === "development"
  ? { clockSkewInMs: 15 * 60 * 1000 }
  : undefined;
// Signed-out visitors to /portal go to this site's sign-in page, not Clerk's
// hosted one. auth.protect() reads these when it redirects.
const clerkOptions = {
  signInUrl: "/sign-in",
  signUpUrl: "/sign-up",
  ...clerkDevelopmentOptions,
};

export default clerkIsConfigured
  ? clerkMiddleware(clerkOptions)
  : function proxy() {
      if (clerkMustFailClosed) {
        return new NextResponse("Service temporarily unavailable.", {
          status: 503,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
        });
      }
      return NextResponse.next();
    };

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
