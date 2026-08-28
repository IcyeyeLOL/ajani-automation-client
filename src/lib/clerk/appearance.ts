import type { NextClerkProviderProps } from "@clerk/nextjs/types";

type ClerkAppearance = NonNullable<NextClerkProviderProps["appearance"]>;

/**
 * Shared Core 3 appearance settings for standalone and modal authentication.
 * Custom classes avoid selectors that depend on Clerk's internal DOM shape.
 */
export const ajaniClerkAppearance = {
  theme: "simple",
  options: {
    elevation: "flush",
    logoPlacement: "none",
    socialButtonsPlacement: "top",
    socialButtonsVariant: "blockButton",
  },
  variables: {
    borderRadius: "0.7rem",
    colorBackground: "#fbfaf7",
    colorForeground: "#171515",
    colorInput: "#ffffff",
    colorInputForeground: "#171515",
    colorMuted: "#f0ebe6",
    colorMutedForeground: "#746b66",
    colorPrimary: "#790018",
    colorPrimaryForeground: "#ffffff",
    colorRing: "#790018",
    fontFamily: 'var(--font-display), "Segoe UI Variable", sans-serif',
  },
  elements: {
    rootBox: "ajani-clerk-root",
    cardBox: "ajani-clerk-card-box",
    card: "ajani-clerk-card",
    main: "ajani-clerk-main",
    header: "ajani-clerk-header",
    headerTitle: "ajani-clerk-title",
    headerSubtitle: "ajani-clerk-subtitle",
    backRow: "ajani-clerk-back-row",
    backLink: "ajani-clerk-back-link",
    socialButtonsRoot: "ajani-clerk-social-root",
    socialButtons: "ajani-clerk-social-buttons",
    socialButtonsBlockButton: "ajani-clerk-social-button",
    socialButtonsBlockButtonText: "ajani-clerk-social-button-text",
    socialButtonsProviderIcon: "ajani-clerk-provider-icon",
    dividerRow: "ajani-clerk-divider",
    dividerLine: "ajani-clerk-divider-line",
    dividerText: "ajani-clerk-divider-text",
    formContainer: "ajani-clerk-form-container",
    form: "ajani-clerk-form",
    formField: "ajani-clerk-field",
    formFieldLabel: "ajani-clerk-label",
    formFieldInput: "ajani-clerk-input",
    formFieldInputShowPasswordButton: "ajani-clerk-password-toggle",
    formFieldErrorText: "ajani-clerk-field-error",
    formFieldHintText: "ajani-clerk-field-hint",
    formButtonPrimary: "ajani-clerk-primary-button",
    formButtonReset: "ajani-clerk-reset-button",
    identityPreview: "ajani-clerk-identity",
    identityPreviewText: "ajani-clerk-identity-text",
    identityPreviewEditButton: "ajani-clerk-identity-edit",
    otpCodeField: "ajani-clerk-otp",
    otpCodeFieldInputs: "ajani-clerk-otp-inputs",
    otpCodeFieldInput: "ajani-clerk-otp-input",
    formResendCodeLink: "ajani-clerk-resend",
    alternativeMethods: "ajani-clerk-alternatives",
    alternativeMethodsBlockButton: "ajani-clerk-alternative-button",
    footer: "ajani-clerk-footer",
    footerAction: "ajani-clerk-footer-action",
    footerActionText: "ajani-clerk-footer-copy",
    footerActionLink: "ajani-clerk-footer-link",
    footerPages: "ajani-clerk-footer-pages",
    footerPagesLink: "ajani-clerk-footer-page-link",
  },
} satisfies ClerkAppearance;

export const ajaniClerkLocalization = {
  dividerText: "or",
  signIn: {
    start: {
      title: "Sign in to Ajani",
      subtitle: "Access your private automation workspace",
    },
  },
  signUp: {
    start: {
      title: "Create your Ajani account",
      subtitle: "Keep your requests and systems in one private workspace",
    },
  },
  socialButtonsBlockButton: "Continue with {{provider}}",
};
