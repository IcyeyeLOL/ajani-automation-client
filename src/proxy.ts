import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasClerkCredentials } from "@/lib/clerk/config";

const isProtectedRoute = createRouteMatcher(["/portal(.*)", "/api/build-requests(.*)"]);
const clerkIsConfigured = hasClerkCredentials();

export default clerkIsConfigured
  ? clerkMiddleware(async (auth, request) => {
      if (isProtectedRoute(request)) await auth.protect();
    })
  : function proxy() {
      return NextResponse.next();
    };

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
