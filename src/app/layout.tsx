import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AccountAccessProvider } from "@/components/account-access-dialog";
import { ajaniClerkAppearance, ajaniClerkLocalization } from "@/lib/clerk/appearance";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { MOTION_POLICY_VERSION } from "@/lib/motion/preference";
import { display, mono } from "./fonts";
import "./globals.css";

const siteUrl = new URL("https://ajaniflow.com");
const siteTitle = "Ajani Automation";
const siteDescription = "Operational systems that make the work move.";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: siteTitle,
  description: siteDescription,
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: siteTitle,
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Ajani Automation",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const clerkEnabled = hasClerkCredentials();
  const app = <AccountAccessProvider clerkEnabled={clerkEnabled}>{children}</AccountAccessProvider>;
  const configuredApp = clerkEnabled ? (
    <ClerkProvider
      appearance={ajaniClerkAppearance}
      localization={ajaniClerkLocalization}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      {app}
    </ClerkProvider>
  ) : app;

  return (
    <html className={`${display.variable} ${mono.variable}`} data-motion="full" data-motion-policy={MOTION_POLICY_VERSION} data-scroll-behavior="smooth" lang="en">
      <body>
        {configuredApp}
      </body>
    </html>
  );
}
