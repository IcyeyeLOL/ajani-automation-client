import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      primary: "ui-button-primary",
      secondary: "ui-button-secondary",
      quiet: "ui-button-quiet",
    },
    size: {
      default: "ui-button-default",
      compact: "ui-button-compact",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "default",
  },
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, size, variant, type = "button", ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} type={type} {...props} />;
}
