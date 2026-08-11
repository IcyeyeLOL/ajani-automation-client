"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { SignIn, SignUp } from "@clerk/nextjs";
import { createContext, type ReactNode, useContext, useState } from "react";
import { Button } from "@/components/ui/button";

type AccessMode = "sign-in" | "sign-up" | "request";

type AccountAccessContextValue = {
  openAccountAccess: (mode?: AccessMode) => void;
  closeAccountAccess: () => void;
};

const AccountAccessContext = createContext<AccountAccessContextValue | null>(null);

const clerkAppearance = {
  variables: {
    colorPrimary: "#790018",
    colorBackground: "#fbfaf7",
    colorInputBackground: "#ffffff",
    colorInputText: "#171515",
    colorText: "#171515",
    borderRadius: "0.7rem",
    fontFamily: '"Aptos", "Segoe UI Variable", "Trebuchet MS", sans-serif',
  },
};

export function AccountAccessProvider({ children, clerkEnabled }: { children: ReactNode; clerkEnabled: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AccessMode>("sign-in");
  const requestContext = mode === "request";
  const signUp = mode === "sign-up" || requestContext;

  const openAccountAccess = (nextMode: AccessMode = "sign-in") => {
    setMode(nextMode);
    setIsOpen(true);
  };

  return <AccountAccessContext.Provider value={{ openAccountAccess, closeAccountAccess: () => setIsOpen(false) }}>
    {children}
    <Dialog.Root onOpenChange={setIsOpen} open={isOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="ajani-dialog-overlay" />
        <Dialog.Content aria-describedby="account-access-copy" className="ajani-dialog-content">
          <Dialog.Close aria-label="Close account access" className="ajani-dialog-close">×</Dialog.Close>
          <p className="eyebrow">{requestContext ? "YOUR BUILD, IN ONE PLACE" : "WELCOME BACK"}</p>
          <Dialog.Title>
            {requestContext ? <>Create an account to <em>request this build.</em></> : signUp ? <>Create your Ajani <em>account.</em></> : <>Sign in to keep the work <em>moving.</em></>}
          </Dialog.Title>
          <Dialog.Description id="account-access-copy">
            {requestContext ? "Save your approved route, receive the handoff, and see what is running for your business." : "Your requests, build history, billing, and active automations live in one private portal."}
          </Dialog.Description>

          {clerkEnabled ? <div className="clerk-in-request">
            {signUp ? <SignUp appearance={clerkAppearance} fallbackRedirectUrl="/request" signInUrl="/sign-in" /> : <SignIn appearance={clerkAppearance} fallbackRedirectUrl="/portal" signUpUrl="/sign-up" />}
          </div> : <div className="account-access-preview">
            <b>CLERK CONNECTION NEEDED</b>
            <p>Add the Clerk publishable and secret keys to activate account access here. The public request flow remains available in the meantime.</p>
          </div>}

          {clerkEnabled ? <div className="account-access-actions">
            {signUp ? <Button onClick={() => setMode("sign-in")} size="compact" variant="quiet">I already have an account</Button> : <Button onClick={() => setMode("sign-up")} size="compact" variant="quiet">Create an account</Button>}
          </div> : null}
          <small>Close this window and your place in the request stays exactly where it is.</small>
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
