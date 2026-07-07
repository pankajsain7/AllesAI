"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90 disabled:opacity-40 shadow-[var(--shadow-sm)]",
  secondary:
    "border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--fg)] hover:border-[var(--border-strong)] disabled:opacity-40",
  ghost:
    "text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)] disabled:opacity-40",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "gap-1.5 px-2.5 py-1.5 text-xs",
  md: "gap-2 px-3.5 py-2 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/** Shared button primitive - keeps radius, focus ring and hover states
 * consistent instead of every call site inventing its own classes. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={props.type ?? "button"}
        className={
          "inline-flex items-center justify-center rounded-[var(--radius-md)] font-medium transition disabled:cursor-not-allowed " +
          VARIANT_CLASSES[variant] +
          " " +
          SIZE_CLASSES[size] +
          " " +
          className
        }
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  active?: boolean;
}

const ICON_SIZE_CLASSES: Record<Size, string> = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
};

/** Round icon-only button used for toolbar/sidebar actions. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = "ghost", size = "sm", active = false, className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={props.type ?? "button"}
        className={
          "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-full)] transition disabled:cursor-not-allowed disabled:opacity-40 " +
          ICON_SIZE_CLASSES[size] +
          " " +
          (active
            ? "bg-[var(--accent)]/10 text-[var(--accent)]"
            : VARIANT_CLASSES[variant]) +
          " " +
          className
        }
        {...props}
      />
    );
  }
);
IconButton.displayName = "IconButton";
