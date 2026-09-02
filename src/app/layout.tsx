import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AccountAccessProvider } from "@/components/account-access-dialog";
import { ajaniClerkAppearance, ajaniClerkLocalization } from "@/lib/clerk/appearance";
import { hasClerkCredentials } from "@/lib/clerk/config";
import { display, mono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ajani Automation",
  description: "Operational systems that make the work move.",
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
    <html
      className={`${display.variable} ${mono.variable}`}
      data-motion="full"
      lang="en"
    >
      <body>
        {configuredApp}
      </body>
    </html>
  );
}
