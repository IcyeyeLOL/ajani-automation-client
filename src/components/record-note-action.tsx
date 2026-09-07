"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { type ReactNode, useSyncExternalStore } from "react";
import { useAccountAccess } from "@/components/account-access-dialog";

type RecordNoteActionProps = {
  children: ReactNode;
  className?: string;
  onActivate?: () => void;
};

const subscribeToHydration = () => () => undefined;
const getHydratedSnapshot = () => true;
const getServerSnapshot = () => false;

function useHydrated() {
  return useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerSnapshot);
}

export function RecordNoteAction(props: RecordNoteActionProps) {
  const { clerkEnabled, openAccountAccess } = useAccountAccess();
  const hydrated = useHydrated();

  if (clerkEnabled) return <ClerkRecordNoteAction {...props} />;

  return (
    <Link
      className={props.className}
      href="/sign-in?redirect_url=%2Frecord"
      inert={hydrated ? undefined : true}
      onClick={(event) => {
        props.onActivate?.();
        event.preventDefault();
        openAccountAccess("sign-in", "/record");
      }}
    >
      {props.children}
    </Link>
  );
}

function ClerkRecordNoteAction({ children, className, onActivate }: RecordNoteActionProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const { openAccountAccess } = useAccountAccess();
  const hydrated = useHydrated();

  if (isLoaded && isSignedIn) {
    return <Link className={className} href="/record" inert={hydrated ? undefined : true} onClick={onActivate}>{children}</Link>;
  }

  return <Link
    className={className}
    href="/sign-in?redirect_url=%2Frecord"
    inert={hydrated ? undefined : true}
    onClick={(event) => {
      onActivate?.();
      event.preventDefault();
      openAccountAccess("sign-in", "/record");
    }}
  >
    {children}
  </Link>;
}
