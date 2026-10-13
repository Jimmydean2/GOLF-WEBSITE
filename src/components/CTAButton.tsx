import Link from "next/link";
import { ReactNode } from "react";

type Variant = "primary" | "secondary" | "outline";

const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-to-br from-forest via-forest to-forest-dark text-cream shadow-md shadow-black/25 ring-1 ring-gold/30 hover:shadow-lg hover:shadow-black/35 hover:brightness-110",
  secondary:
    "bg-gradient-to-r from-gold-light via-gold to-gold-deep bg-[length:220%_100%] bg-left text-ink shadow-md shadow-black/20 hover:bg-right hover:shadow-lg hover:shadow-gold-deep/30",
  outline:
    "border-2 border-gold-light/70 text-cream hover:border-gold-light hover:bg-gold-light hover:text-ink",
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
  const classes = `inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-500 ease-out cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-light focus-visible:ring-offset-2 ${variants[variant]} ${className}`;

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
