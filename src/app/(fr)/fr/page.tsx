import { redirect } from "next/navigation";
import { campsPath } from "@/lib/i18n";

// "/fr" on its own goes to the one French page families look for.
export default function FrenchHome() {
  redirect(campsPath("fr"));
}
