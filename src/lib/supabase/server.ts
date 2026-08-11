import "server-only";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

export async function createClerkServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase server credentials are not configured.");
  }

  const { getToken } = await auth();
  return createClient(url, key, {
    accessToken: async () => getToken(),
  });
}
