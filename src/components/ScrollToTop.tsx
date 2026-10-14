"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Next's built-in <Link> scroll behavior only jumps to the top of the new
// page if the previous page's content has scrolled out of the viewport.
// Clicking a footer link while scrolled to the bottom doesn't qualify —
// the footer itself is still on screen through the transition — so it
// silently keeps the old scroll position. Force it on every route change
// instead. Keyed on pathname only (not search params) so it doesn't fight
// same-page hash navigation like the Junior Camps week tiles.
export default function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
