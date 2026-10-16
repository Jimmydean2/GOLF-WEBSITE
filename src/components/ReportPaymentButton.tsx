"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getMessages } from "@/lib/i18n";
import type { Lang } from "@/lib/lang";

// The parent's one action: "I've Sent My Payment". It posts the private-link token and
// nothing else. No form, no upload, no account.
export default function ReportPaymentButton({ token, lang }: { token: string; lang: Lang }) {
  const m = getMessages(lang).report;
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [message, setMessage] = useState("");

  async function report() {
    setState("sending");
    setMessage("");
    try {
      const response = await fetch("/api/camp-registration/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, language: lang }),
      });
      const result = await response.json();
      if (response.ok && result.success) {
        router.refresh();
        return;
      }
      setState("error");
      setMessage(result.error || m.error);
    } catch {
      setState("error");
      setMessage(m.error);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={report}
        disabled={state === "sending"}
        className="w-full cursor-pointer rounded-full bg-forest px-6 py-4 text-base font-semibold text-cream transition-colors hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === "sending" ? m.sending : m.button}
      </button>
      {state === "error" && (
        <p role="alert" className="mt-3 text-sm text-flag">
          {message}
        </p>
      )}
    </div>
  );
}
