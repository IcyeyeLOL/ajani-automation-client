import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const statusBadgeVariants = cva("ui-status-badge", {
  variants: {
    status: {
      neutral: "ui-status-neutral",
      success: "ui-status-success",
      warning: "ui-status-warning",
      danger: "ui-status-danger",
      brand: "ui-status-brand",
    },
  },
  defaultVariants: {
    status: "neutral",
  },
});

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof statusBadgeVariants>;

export function StatusBadge({ className, status, ...props }: StatusBadgeProps) {
  return <span className={cn(statusBadgeVariants({ status }), className)} {...props} />;
}
