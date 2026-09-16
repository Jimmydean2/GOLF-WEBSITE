import Link from "next/link";
import { ReactNode } from "react";

type Variant = "primary" | "secondary" | "outline";

const variants: Record<Variant, string> = {
  primary: "bg-forest text-cream hover:bg-forest-dark",
  secondary: "bg-gold text-ink hover:bg-gold-light",
  outline:
    "border-2 border-cream text-cream hover:bg-cream hover:text-forest",
};

export default function CTAButton({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  const isExternal = href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:");
  const classes = `inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-colors cursor-pointer ${variants[variant]} ${className}`;

  if (isExternal) {
    return (
      <a href={href} className={classes} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
