export const LEGAL_EFFECTIVE_DATE = "2026-09-02";
export const LEGAL_EFFECTIVE_DATE_LABEL = "September 2, 2026";

export const TERMS_VERSION = "2026-09-02";
export const PRIVACY_VERSION = "2026-09-02";
export const ACCEPTABLE_USE_VERSION = "2026-09-02";
export const ACCESSIBILITY_VERSION = "2026-09-02";
export const SUBPROCESSOR_LIST_VERSION = "2026-09-02";
export const PROCESSING_NOTICE_VERSION = "request-processing-2026-09-02";

const HANDOFF_POLICY_VERSION_2026_09_02 = {
  noticeVersion: "handoff-notice-2026-09-02",
  acceptableUseVersion: ACCEPTABLE_USE_VERSION,
  privacyVersion: "2026-09-02",
  termsVersion: "2026-09-02",
} as const;

// Append new immutable tuples and update CURRENT_HANDOFF_POLICY_VERSION.
// Never rewrite or remove a version while an accepted draft may still exist.
export const RECOGNIZED_HANDOFF_POLICY_VERSIONS = [
  HANDOFF_POLICY_VERSION_2026_09_02,
] as const;

export const CURRENT_HANDOFF_POLICY_VERSION = HANDOFF_POLICY_VERSION_2026_09_02;
export const HANDOFF_NOTICE_VERSION = CURRENT_HANDOFF_POLICY_VERSION.noticeVersion;

// The handoff UI renders this copy beside the control associated with the
// notice version above. Bump that version whenever this language changes.
export const HANDOFF_NOTICE_COPY = {
  agreement: "I agree to Ajani's Terms of Service and Acceptable Use Policy, acknowledge its Privacy Policy, and confirm I am 18 or older and authorized to submit this request.",
  detail: "Sending asks Ajani to review the brief. It does not purchase services or authorize a charge.",
} as const;

export function isRecognizedHandoffPolicyVersion(value: {
  noticeVersion: string;
  acceptableUseVersion: string;
  privacyVersion: string;
  termsVersion: string;
}) {
  return RECOGNIZED_HANDOFF_POLICY_VERSIONS.some((recognized) => (
    recognized.noticeVersion === value.noticeVersion
    && recognized.acceptableUseVersion === value.acceptableUseVersion
    && recognized.privacyVersion === value.privacyVersion
    && recognized.termsVersion === value.termsVersion
  ));
}

// New submissions must use the policy bundle actually presented in the UI.
// Historical tuples remain recognizable only for audit/read purposes; keeping
// one here must never silently grandfather it into a new handoff.
export function isCurrentHandoffPolicyVersion(value: {
  noticeVersion: string;
  acceptableUseVersion: string;
  privacyVersion: string;
  termsVersion: string;
}) {
  return CURRENT_HANDOFF_POLICY_VERSION.noticeVersion === value.noticeVersion
    && CURRENT_HANDOFF_POLICY_VERSION.acceptableUseVersion === value.acceptableUseVersion
    && CURRENT_HANDOFF_POLICY_VERSION.privacyVersion === value.privacyVersion
    && CURRENT_HANDOFF_POLICY_VERSION.termsVersion === value.termsVersion;
}
