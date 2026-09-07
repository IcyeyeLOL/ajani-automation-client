import { describe, expect, it } from "vitest";
import {
  ACCEPTABLE_USE_VERSION,
  CURRENT_HANDOFF_POLICY_VERSION,
  HANDOFF_NOTICE_VERSION,
  isCurrentHandoffPolicyVersion,
  isRecognizedHandoffPolicyVersion,
  PRIVACY_VERSION,
  RECOGNIZED_HANDOFF_POLICY_VERSIONS,
  TERMS_VERSION,
} from "@/lib/legal/policy-versions";

describe("handoff policy versions", () => {
  it("recognizes every explicitly retained acceptance version", () => {
    for (const version of RECOGNIZED_HANDOFF_POLICY_VERSIONS) {
      expect(isRecognizedHandoffPolicyVersion(version)).toBe(true);
    }
  });

  it("retains the first production handoff policy tuple verbatim", () => {
    expect(RECOGNIZED_HANDOFF_POLICY_VERSIONS).toContainEqual({
      noticeVersion: "handoff-notice-2026-09-02",
      acceptableUseVersion: "2026-09-02",
      privacyVersion: "2026-09-02",
      termsVersion: "2026-09-02",
    });
  });

  it("rejects a mixed or unknown policy envelope", () => {
    expect(isRecognizedHandoffPolicyVersion({
      noticeVersion: HANDOFF_NOTICE_VERSION,
      acceptableUseVersion: `${ACCEPTABLE_USE_VERSION}-unknown`,
      privacyVersion: PRIVACY_VERSION,
      termsVersion: TERMS_VERSION,
    })).toBe(false);
  });

  it("distinguishes the current submission bundle from historical audit tuples", () => {
    expect(isCurrentHandoffPolicyVersion(CURRENT_HANDOFF_POLICY_VERSION)).toBe(true);
    expect(isCurrentHandoffPolicyVersion({
      noticeVersion: "handoff-notice-2026-08-01",
      acceptableUseVersion: "2026-08-01",
      privacyVersion: "2026-08-01",
      termsVersion: "2026-08-01",
    })).toBe(false);
  });
});
