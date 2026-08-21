"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { SignIn, SignUp } from "@clerk/nextjs";
import { createContext, type ReactNode, useContext, useState } from "react";
import { AuthTrustLine } from "@/components/auth-surface";
import { ajaniClerkAppearance } from "@/lib/clerk/appearance";

type AccessMode = "sign-in" | "sign-up" | "request";

type AccountAccessContextValue = {
  openAccountAccess: (mode?: AccessMode) => void;
  closeAccountAccess: () => void;
};

const AccountAccessContext = createContext<AccountAccessContextValue | null>(null);

export function AccountAccessProvider({ children, clerkEnabled }: { children: ReactNode; clerkEnabled: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AccessMode>("sign-in");
  const signUp = mode === "sign-up" || mode === "request";

  const openAccountAccess = (nextMode: AccessMode = "sign-in") => {
    setMode(nextMode);
    setIsOpen(true);
  };

  return <AccountAccessContext.Provider value={{ openAccountAccess, closeAccountAccess: () => setIsOpen(false) }}>
    {children}
    <Dialog.Root onOpenChange={setIsOpen} open={isOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="ajani-dialog-overlay" />
        <Dialog.Content aria-describedby="account-access-copy" className="ajani-dialog-content auth-card-frame">
          <Dialog.Close aria-label="Close account access" className="ajani-dialog-close">×</Dialog.Close>
          <Dialog.Title className="sr-only">{signUp ? "Create an Ajani Automation account" : "Sign in to Ajani Automation"}</Dialog.Title>
          <Dialog.Description className="sr-only" id="account-access-copy">Access your private Ajani Automation workspace.</Dialog.Description>

          {clerkEnabled ? <div className="clerk-in-request">
            {signUp ? <SignUp appearance={ajaniClerkAppearance} fallbackRedirectUrl="/portal" routing="hash" signInUrl="/sign-in" /> : <SignIn appearance={ajaniClerkAppearance} fallbackRedirectUrl="/portal" routing="hash" signUpUrl="/sign-up" />}
          </div> : <div className="account-access-preview">
            <b>CLERK CONNECTION NEEDED</b>
            <p>Add the Clerk publishable and secret keys to activate account access here. The public request flow remains available in the meantime.</p>
          </div>}
          <AuthTrustLine />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </AccountAccessContext.Provider>;
}

export function useAccountAccess() {
  const context = useContext(AccountAccessContext);

  if (!context) throw new Error("useAccountAccess must be used within AccountAccessProvider");
  return context;
}
