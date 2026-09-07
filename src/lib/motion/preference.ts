/**
 * Animations are on by default, starting with server-rendered data-motion="full".
 * No browser storage or hydration effect can silently switch that default off.
 * Individual pause controls remain independent. An explicit data-motion="system"
 * retains a device-based fallback for tests and integrations.
 */
export const MOTION_POLICY_VERSION = "full-v2";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function shouldReduceMotion(devicePrefersReduced: boolean, override: string | null | undefined) {
  return override === "system" && devicePrefersReduced;
}

export function getReducedMotionPreference() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return shouldReduceMotion(window.matchMedia(REDUCED_MOTION_QUERY).matches, document.documentElement.dataset.motion);
}

const subscribers = new Set<(reduced: boolean) => void>();
let stopObserving: (() => void) | undefined;

function notifySubscribers() {
  const reduced = getReducedMotionPreference();
  for (const onChange of subscribers) onChange(reduced);
}

export function subscribeToMotionPreference(onChange: (reduced: boolean) => void) {
  onChange(getReducedMotionPreference());
  if (typeof window === "undefined") return () => {};
  subscribers.add(onChange);
  if (!stopObserving) stopObserving = observePreference();
  return () => {
    subscribers.delete(onChange);
    if (subscribers.size === 0) {
      stopObserving?.();
      stopObserving = undefined;
    }
  };
}

function observePreference() {
  const media = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
  media?.addEventListener("change", notifySubscribers);
  const observer = typeof MutationObserver === "function" ? new MutationObserver(notifySubscribers) : null;
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => {
    media?.removeEventListener("change", notifySubscribers);
    observer?.disconnect();
  };
}
