// Stored option values shown the way the owner writes them ("LinkedIn", not "Linkedin").
const optionLabels: Record<string, string> = {
  linkedin: "LinkedIn", reddit: "Reddit", youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok",
  manual: "Manual", dripify: "Dripify", organic: "Organic",
  connection_request: "Connection request", initial_dm: "Initial DM", follow_up_1: "Follow-up 1", follow_up_2: "Follow-up 2", custom: "Custom step",
  reply_rate: "Reply rate", positive_reply_rate: "Positive reply rate", booking_rate: "Booking rate", acceptance_rate: "Connection acceptance",
};

/** The display name for a known channel, method, message step or metric; undefined for anything else. */
export function optionLabel(value: string): string | undefined {
  return optionLabels[value.trim().toLowerCase().replace(/[\s-]+/g, "_")];
}

export function plural(count: number, one: string, many: string) {
  return `${new Intl.NumberFormat("en-US").format(count)} ${count === 1 ? one : many}`;
}
