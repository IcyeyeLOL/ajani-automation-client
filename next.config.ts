import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://*.clerk.accounts.dev https://*.clerk.com https://clerk.ajaniflow.com https://challenges.cloudflare.com https://*.protect.clerk.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://img.clerk.com https://*.clerk.com https://*.clerk.accounts.dev",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.clerk.accounts.dev https://*.clerk.com https://clerk.ajaniflow.com https://*.protect.clerk.com:*",
  "media-src 'self' blob: https://*.supabase.co",
  "frame-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.ajaniflow.com https://challenges.cloudflare.com https://*.protect.clerk.com https://www.youtube.com https://www.youtube-nocookie.com",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self' https://*.clerk.accounts.dev https://*.clerk.com https://clerk.ajaniflow.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
  },
  // /request is the old address of the recorder. Redirecting here returns a
  // real 308; a page-level redirect() streams behind the root loading screen
  // and arrives as a 200 with a meta refresh.
  async redirects() {
    return [{ source: "/request", destination: "/record", permanent: true }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }];
  },
};

export default nextConfig;
