import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasClerkCredentials, shouldFailClosedForClerk } from "@/lib/clerk/config";

const clerkIsConfigured = hasClerkCredentials();
const clerkMustFailClosed = shouldFailClosedForClerk();
const clerkDevelopmentOptions = process.env.NODE_ENV === "development"
  ? { clockSkewInMs: 5 * 60 * 1000 }
  : undefined;

export default clerkIsConfigured
  ? clerkMiddleware(clerkDevelopmentOptions)
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
