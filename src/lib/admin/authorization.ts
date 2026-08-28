export type AdminIdentity = {
  emails: string[];
  userId: string;
};

export type AdminAllowlist = {
  allowAnyClerkUser: boolean;
  emails: Set<string>;
  userIds: Set<string>;
};

type AdminEnvironment = Partial<Record<
  "AJANI_ADMIN_ALLOW_ANY_CLERK_USER_IN_DEVELOPMENT" | "AJANI_ADMIN_EMAIL_ALLOWLIST" | "AJANI_ADMIN_USER_ID_ALLOWLIST" | "INTERNAL_NOTIFICATION_TO" | "NODE_ENV",
  string
>>;

export function getAdminAllowlist(
  environment: AdminEnvironment = process.env as unknown as AdminEnvironment,
): AdminAllowlist {
  return {
    allowAnyClerkUser: environment.NODE_ENV === "development"
      && environment.AJANI_ADMIN_ALLOW_ANY_CLERK_USER_IN_DEVELOPMENT === "true",
    emails: new Set(splitList(environment.AJANI_ADMIN_EMAIL_ALLOWLIST).map((value) => value.toLowerCase())),
    userIds: new Set(splitList(environment.AJANI_ADMIN_USER_ID_ALLOWLIST)),
  };
}

export function isAdminIdentityAllowed(identity: AdminIdentity, allowlist: AdminAllowlist) {
  if (allowlist.allowAnyClerkUser && identity.userId) return true;
  if (allowlist.userIds.has(identity.userId)) return true;
  return identity.emails.some((email) => allowlist.emails.has(email.toLowerCase()));
}

function splitList(value: string | undefined) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}
