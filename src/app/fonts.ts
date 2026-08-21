import { DM_Mono, Schibsted_Grotesk } from "next/font/google";

/**
 * Two roles, one job each. The display face carries statements; the mono face
 * carries every machine label — status, timers, step markers, metric captions.
 * Both are self-hosted at build time, so no request leaves the page at runtime.
 */
export const display = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});
