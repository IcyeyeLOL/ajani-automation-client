"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { createContext, type ReactNode, useContext, useState } from "react";
import { AjaniAuthModule } from "@/components/ajani-auth-module";
import { AuthTrustLine } from "@/components/auth-surface";

type AccessMode = "sign-in" | "sign-up" | "request";

type AccountAccessContextValue = {
  clerkEnabled: boolean;
  openAccountAccess: (mode?: AccessMode, redirectTo?: string) => void;
  closeAccountAccess: () => void;
};

const AccountAccessContext = createContext<AccountAccessContextValue | null>(null);

export function AccountAccessProvider({ children, clerkEnabled }: { children: ReactNode; clerkEnabled: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AccessMode>("sign-in");
  const [redirectTo, setRedirectTo] = useState("/portal");
  const signUp = mode === "sign-up" || mode === "request";

  const openAccountAccess = (nextMode: AccessMode = "sign-in", nextRedirect = "/portal") => {
    setMode(nextMode);
    setRedirectTo(nextRedirect);
    setIsOpen(true);
  };

  return <AccountAccessContext.Provider value={{ clerkEnabled, openAccountAccess, closeAccountAccess: () => setIsOpen(false) }}>
    {children}
    <Dialog.Root onOpenChange={setIsOpen} open={isOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="ajani-dialog-overlay" />
        <Dialog.Content aria-describedby="account-access-copy" className="ajani-dialog-content auth-card-frame">
          <Dialog.Close aria-label="Close account access" className="ajani-dialog-close">×</Dialog.Close>
          <Dialog.Title className="sr-only">{signUp ? "Create an Ajani Automation account" : "Sign in to Ajani Automation"}</Dialog.Title>
          <Dialog.Description className="sr-only" id="account-access-copy">Access your private Ajani Automation workspace.</Dialog.Description>

          {clerkEnabled ? <AjaniAuthModule mode={signUp ? "sign-up" : "sign-in"} redirectTo={redirectTo} /> : <div className="account-access-preview">
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
