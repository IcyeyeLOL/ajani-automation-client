import Link from "next/link";

type LegalDocument = "overview" | "terms" | "privacy";

const documents = [
  { href: "/legal", label: "Overview", value: "overview" },
  { href: "/terms", label: "Terms", value: "terms" },
  { href: "/privacy", label: "Privacy", value: "privacy" },
] as const;

export function LegalSwitcher({ className, current }: { className?: string; current: LegalDocument }) {
  return (
    <nav aria-label="Legal documents" className={className}>
      {documents.map((document) => (
        <Link
          aria-current={current === document.value ? "page" : undefined}
          href={document.href}
          key={document.href}
        >
          {document.label}
        </Link>
      ))}
    </nav>
  );
}
