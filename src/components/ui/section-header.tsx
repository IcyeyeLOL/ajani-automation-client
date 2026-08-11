import type { ReactNode } from "react";

type SectionHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function SectionHeader({ eyebrow, title, description, action, className }: SectionHeaderProps) {
  return <header className={["ui-section-header", className].filter(Boolean).join(" ")}>
    <div>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
    {action ? <div className="ui-section-header-action">{action}</div> : null}
  </header>;
}
