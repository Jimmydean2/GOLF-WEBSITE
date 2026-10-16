"use client";

import { useState } from "react";
import { useAdminCall } from "./AdminActions";
import { INPUT, Modal } from "./AdminRegistrationActions";

// A family's rights over their own information, from the owner's dashboard: a copy of what we
// hold (they ask to see it), and erasing their personal details (they ask, or a duplicate or
// test registration should go). Both need a recent password check; the erase also needs the
// registration's reference typed back. The accounting record always stays.

type Target = { id: string; reference: string; status: string; childNames: string[] };

const SMALL_BTN = "cursor-pointer rounded-full border border-gold/40 px-3 py-1 text-xs font-semibold text-forest hover:border-forest";

function EraseModal({ target, onClose, onDone }: { target: Target; onClose: () => void; onDone: (message: string) => void }) {
  const call = useAdminCall();
  const [typed, setTyped] = useState("");
  const [removePayerName, setRemovePayerName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const holdsSpots = target.status === "pending_payment" || target.status === "payment_reported" || target.status === "paid";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await call(`/api/admin/camp-registrations/${target.id}/erase`, { confirmReference: typed, removePayerName });
    setBusy(false);
    if (result.ok && result.data.success) onDone(`${target.reference}: personal details erased.${holdsSpots ? " Its places were released." : ""}`);
    else setError(String(result.data.error ?? "Could not erase. Nothing was changed."));
  }

  return (
    <Modal title={`Erase personal details — ${target.reference}`} onClose={onClose}>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <p className="text-sm text-ink-soft">
          This permanently overwrites the child&apos;s name, date of birth, age and health information, the emergency contact, and the
          parent&apos;s phone numbers and email address. It cannot be undone.
          {holdsSpots && " The registration still holds places: they are released first, and the family is NOT emailed."}
        </p>
        <p className="text-sm text-ink-soft">The reference, amounts, dates and bank confirmation stay, for your accounting records.</p>
        <label className="flex items-start gap-2 text-sm font-medium text-ink">
          <input type="checkbox" className="mt-1" checked={removePayerName} onChange={(e) => setRemovePayerName(e.target.checked)} />
          <span>
            Also remove the parent&apos;s name.
            <span className="block text-xs font-normal text-ink-soft">Only if you do not need it for your accounting records.</span>
          </span>
        </label>
        <label className="block text-sm font-medium text-ink">
          Type <span className="font-display tracking-wider text-forest">{target.reference}</span> to confirm
          <input className={`${INPUT} mt-1`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
        {error && (
          <p role="alert" className="text-sm text-flag">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="cursor-pointer text-sm font-semibold text-ink-soft hover:text-forest">
            Back
          </button>
          <button type="submit" disabled={busy || typed.trim() === ""} className="cursor-pointer rounded-full bg-flag px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Erasing…" : "Erase personal details"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function FamilyPrivacyButtons({ target, erasedAt, onChanged }: { target: Target; erasedAt: string | null; onChanged: (message: string) => void }) {
  const call = useAdminCall();
  const [erasing, setErasing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (erasedAt) {
    return <span className="text-xs font-semibold text-ink-soft">Personal details erased {new Date(erasedAt).toLocaleDateString("en-CA")}</span>;
  }

  async function download() {
    setBusy(true);
    const result = await call(`/api/admin/camp-registrations/${target.id}/export`, {});
    setBusy(false);
    if (!result.ok || !result.data.success) {
      onChanged(String(result.data.error ?? "Could not prepare the file."));
      return;
    }
    const blob = new Blob([JSON.stringify(result.data.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `family-data-${target.reference}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onChanged(`Downloaded everything held about ${target.reference}. This is personal information: send it only to the family, and delete your copy afterwards.`);
  }

  return (
    <>
      <button type="button" onClick={download} disabled={busy} className={SMALL_BTN}>
        {busy ? "Preparing…" : "Download this family's data"}
      </button>
      <button type="button" onClick={() => setErasing(true)} className={SMALL_BTN}>
        Erase personal details…
      </button>
      {erasing && (
        <EraseModal
          target={target}
          onClose={() => setErasing(false)}
          onDone={(message) => {
            setErasing(false);
            onChanged(message);
          }}
        />
      )}
    </>
  );
}
