"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";
import { useAccountAccess } from "@/components/account-access-dialog";

type RecordNoteActionProps = {
  children: ReactNode;
  className?: string;
};

export function RecordNoteAction(props: RecordNoteActionProps) {
  const { clerkEnabled, openAccountAccess } = useAccountAccess();

  if (clerkEnabled) return <ClerkRecordNoteAction {...props} />;

  return (
    <Link
      className={props.className}
      href="/sign-in?redirect_url=%2Frecord"
      onClick={(event) => {
        event.preventDefault();
        openAccountAccess("sign-in", "/record");
      }}
    >
      {props.children}
    </Link>
  );
}

function ClerkRecordNoteAction({ children, className }: RecordNoteActionProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const { openAccountAccess } = useAccountAccess();

  if (isLoaded && isSignedIn) {
    return <Link className={className} href="/record">{children}</Link>;
  }

  return <Link
    className={className}
    href="/sign-in?redirect_url=%2Frecord"
    onClick={(event) => {
      event.preventDefault();
      openAccountAccess("sign-in", "/record");
    }}
  >
    {children}
  </Link>;
}
