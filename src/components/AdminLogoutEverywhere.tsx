"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAdminCall } from "./AdminActions";

// "Log out everywhere": ends every admin session on every device, this one included. For a
// lost phone or a session someone else may have seen. Needs a recent password check, which
// the shared admin-call helper asks for if it has been more than 15 minutes.
export default function AdminLogoutEverywhere() {
  const call = useAdminCall();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run() {
    if (!window.confirm("Log out of every device and browser, including this one?")) return;
    setBusy(true);
    setMessage("");
    const result = await call("/api/admin/logout-all");
    setBusy(false);
    if (result.ok && result.data.success) {
      router.push("/admin/login");
    } else {
      setMessage(String(result.data.error ?? "Could not log out everywhere."));
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="cursor-pointer text-xs font-semibold text-ink-soft hover:text-forest disabled:opacity-60"
      >
        {busy ? "Logging out…" : "Log out everywhere"}
      </button>
      {message && (
        <p role="alert" className="mt-1 text-xs text-flag">
          {message}
        </p>
      )}
    </div>
  );
}
