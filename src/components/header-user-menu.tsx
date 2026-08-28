"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";
import { useAccountAccess } from "@/components/account-access-dialog";

type HeaderUserMenuProps = {
  className?: string;
  showName?: boolean;
  signedOutFallback?: ReactNode;
};

export function HeaderUserMenu({ className, showName = false, signedOutFallback }: HeaderUserMenuProps) {
  const { clerkEnabled } = useAccountAccess();
  const classes = ["header-user-menu", className].filter(Boolean).join(" ");
  const fallback = signedOutFallback === undefined
    ? <Link className="header-sign-in-link" href="/sign-in">Sign in</Link>
    : signedOutFallback;

  return <span className={classes}>
    {clerkEnabled ? <ConfiguredHeaderUserMenu showName={showName} signedOutFallback={fallback} /> : fallback}
  </span>;
}

function ConfiguredHeaderUserMenu({ showName, signedOutFallback }: Pick<HeaderUserMenuProps, "showName" | "signedOutFallback">) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <i aria-hidden="true" className="header-user-menu-loading" />;
  if (!isSignedIn) return signedOutFallback;

  return <UserButton
      appearance={{
        elements: {
          avatarBox: "ajani-user-avatar",
          userButtonTrigger: "ajani-user-button-trigger",
          userButtonOuterIdentifier: "ajani-user-name",
        },
      }}
      showName={showName}
    >
      <UserButton.MenuItems>
        <UserButton.Link
          href="/portal"
          label="My Portal"
          labelIcon={<svg aria-hidden="true" className="ajani-user-menu-icon" viewBox="0 0 24 24">
            <path d="M4 4h6v7H4V4Zm10 0h6v4h-6V4ZM4 15h6v5H4v-5Zm10-3h6v8h-6v-8Z" />
          </svg>}
        />
        <UserButton.Action label="manageAccount" />
        <UserButton.Action label="signOut" />
      </UserButton.MenuItems>
    </UserButton>;
}
