import { Playfair_Display, Inter } from "next/font/google";

// Shared by both root layouts (English and French). The "latin" subset covers French accents
// and the œ ligature.
export const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
