"use client";

import { useState, type ReactNode } from "react";
import { useAdminCall } from "./AdminActions";
import { formatCents } from "@/lib/pricing";

// The administrator's actions on one registration: confirm payment (after seeing the
// deposit), extend the review, release, reinstate. Shown wherever a registration appears
// (the review queue and the search results). Every action goes through the server, which
// re-checks the login, the recent password check, and every rule.

export type ActionTarget = {
  id: string;
  reference: string;
  status: string;
  amountDueCents: number;
  childNames: string[];
  extensionCount: number;
  reinstateCount: number;
};

const INPUT =
  "w-full rounded-lg border border-gold/40 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest";
const BTN_PRIMARY = "cursor-pointer rounded-full bg-forest px-4 py-2 text-sm font-semibold text-cream hover:bg-forest-dark disabled:opacity-60";
const BTN_QUIET = "cursor-pointer text-sm font-semibold text-ink-soft hover:text-forest";
const ACTION_BTN =
  "cursor-pointer rounded-full border border-gold/40 px-4 py-2 text-xs font-semibold text-forest hover:border-forest min-h-[40px]";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-3 sm:items-center"
      role="presentation"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-gold/30 bg-cream p-5 shadow-xl"
      >
        <h2 className="font-display text-lg font-semibold text-forest">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function localNowForInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function ConfirmModal({ target, onClose, onDone }: { target: ActionTarget; onClose: () => void; onDone: (message: string) => void }) {
  const call = useAdminCall();
  const [amount, setAmount] = useState("");
  const [depositAt, setDepositAt] = useState(localNowForInput());
  const [method, setMethod] = useState<"reference_matched" | "name_amount_time">("reference_matched");
  const [reference, setReference] = useState("");
  const [bankNumber, setBankNumber] = useState("");
  const [note, setNote] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const released = target.status === "cancelled";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await call(`/api/admin/camp-registrations/${target.id}/confirm`, {
      verifiedDeposit: verified,
      amountReceived: amount,
      depositAt: new Date(depositAt).toISOString(),
      method,
      referenceEntered: reference,
      bankConfirmationNumber: bankNumber,
      note,
    });
    setBusy(false);
    if (result.ok && result.data.success) {
      const restored = Array.isArray(result.data.reinstatedWeekIds) && result.data.reinstatedWeekIds.length > 0 ? " Spots restored." : "";
      const mail = result.data.alreadyPaid ? "It was already confirmed." : result.data.emailConfigured ? "The parent's confirmation email is on its way (the Email box above shows if it gets stuck)." : "Email isn't connected, so the confirmation email is waiting to be sent.";
      onDone(`Payment confirmed for ${target.reference}.${restored} ${mail}`);
    } else {
      setError(String(result.data.error ?? "Could not confirm this payment. Nothing was changed."));
    }
  }

  return (
    <Modal title={`Confirm payment — ${target.reference}`} onClose={onClose}>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <p className="text-sm text-ink-soft">
          {target.childNames.join(", ")} &middot; amount due <strong className="text-ink">${formatCents(target.amountDueCents)}</strong> (tax included).
          {released && " This registration was released; confirming takes its spots back if there is still room."}
        </p>
        <label className="block text-sm font-medium text-ink">
          Amount you received ($)
          <input className={`${INPUT} mt-1`} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={formatCents(target.amountDueCents)} />
        </label>
        <label className="block text-sm font-medium text-ink">
          Date and time the deposit arrived
          <input className={`${INPUT} mt-1`} type="datetime-local" required value={depositAt} onChange={(e) => setDepositAt(e.target.value)} />
        </label>
        <fieldset className="space-y-1 text-sm text-ink">
          <legend className="font-medium">How did you match it?</legend>
          <label className="flex items-center gap-2">
            <input type="radio" checked={method === "reference_matched"} onChange={() => setMethod("reference_matched")} /> The reference is in the bank message
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={method === "name_amount_time"} onChange={() => setMethod("name_amount_time")} /> My bank doesn&apos;t show it: matched by name, amount and time
          </label>
        </fieldset>
        {method === "reference_matched" && (
          <label className="block text-sm font-medium text-ink">
            Reference from the bank message
            <input className={`${INPUT} mt-1`} required value={reference} onChange={(e) => setReference(e.target.value)} placeholder="GD-XXXXXX" autoCapitalize="characters" />
          </label>
        )}
        <label className="block text-sm font-medium text-ink">
          {method === "name_amount_time" ? "Note: how you matched it (required)" : "Note (optional)"}
          <textarea
            className={`${INPUT} mt-1`}
            rows={2}
            required={method === "name_amount_time"}
            minLength={method === "name_amount_time" ? 8 : undefined}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={method === "name_amount_time" ? "e.g. sender name matches, same amount, 4:12 pm" : "e.g. two transfers added together, or extra refunded"}
          />
        </label>
        <label className="block text-sm font-medium text-ink">
          Bank confirmation number (optional)
          <input className={`${INPUT} mt-1`} value={bankNumber} onChange={(e) => setBankNumber(e.target.value)} />
        </label>
        <label className="flex items-start gap-2 text-sm font-medium text-ink">
          <input type="checkbox" className="mt-1" checked={verified} onChange={(e) => setVerified(e.target.checked)} required />
          <span>I can see this deposit in my bank account.</span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-flag">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className={BTN_QUIET}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !verified} className={BTN_PRIMARY}>
            {busy ? "Confirming…" : "Confirm payment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ExtendModal({ target, onClose, onDone }: { target: ActionTarget; onClose: () => void; onDone: (message: string) => void }) {
  const call = useAdminCall();
  const [hours, setHours] = useState("24");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await call(`/api/admin/camp-registrations/${target.id}/extend`, { hours: Number(hours), note });
    setBusy(false);
    if (result.ok && result.data.success) onDone(`Review extended for ${target.reference}. Extensions left: ${String(result.data.extensionsLeft)}.`);
    else setError(String(result.data.error ?? "Could not extend. Nothing was changed."));
  }

  return (
    <Modal title={`Extend review — ${target.reference}`} onClose={onClose}>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <p className="text-sm text-ink-soft">
          For a transfer your bank shows as delayed. The spot stays held; when the extension ends the alerts resume. Nothing is released or confirmed.
        </p>
        <label className="block text-sm font-medium text-ink">
          Hours (1 to 72)
          <input className={`${INPUT} mt-1`} type="number" min={1} max={72} required value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-ink">
          Why (required)
          <textarea className={`${INPUT} mt-1`} rows={2} required minLength={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bank shows the transfer as pending" />
        </label>
        {error && (
          <p role="alert" className="text-sm text-flag">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={BTN_QUIET}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={BTN_PRIMARY}>
            {busy ? "Saving…" : "Extend review"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReleaseModal({ target, onClose, onDone }: { target: ActionTarget; onClose: () => void; onDone: (message: string) => void }) {
  const call = useAdminCall();
  const reported = target.status === "payment_reported";
  const [notReceived, setNotReceived] = useState(reported || target.status === "pending_payment");
  const [reason, setReason] = useState("");
  const [notifyParent, setNotifyParent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const paid = target.status === "paid";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await call(`/api/admin/camp-registrations/${target.id}/cancel`, { reason, notReceived: notReceived && !paid, notifyParent });
    setBusy(false);
    if (result.ok && result.data.success) onDone(`${target.reference} released. Spots freed: ${(result.data.releasedWeekIds as string[]).join(", ") || "none"}.`);
    else setError(String(result.data.error ?? "Could not release. Nothing was changed."));
  }

  return (
    <Modal title={`${paid ? "Cancel" : "Release"} — ${target.reference}`} onClose={onClose}>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <p className="text-sm text-ink-soft">
          {paid ? "This frees the spots of a PAID registration. Record the refund separately." : "This frees the spots so other families can take them."}
        </p>
        {!paid && (
          <label className="flex items-start gap-2 text-sm font-medium text-ink">
            <input type="checkbox" className="mt-1" checked={notReceived} onChange={(e) => setNotReceived(e.target.checked)} />
            <span>
              I checked my bank and the payment was not received.
              {reported && " (Counts against this contact if it happens repeatedly.)"}
            </span>
          </label>
        )}
        <label className="block text-sm font-medium text-ink">
          Note for the log
          <input className={`${INPUT} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={paid ? "e.g. parent asked to cancel" : "e.g. no deposit found, parent contacted"} />
        </label>
        <label className="flex items-start gap-2 text-sm font-medium text-ink">
          <input type="checkbox" className="mt-1" checked={notifyParent} onChange={(e) => setNotifyParent(e.target.checked)} />
          <span>
            Email the family a notice (in their language).
            <span className="block text-xs font-normal text-ink-soft">
              Untick it if you have already spoken to them. The notice never mentions your note.
            </span>
          </span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-flag">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={BTN_QUIET}>
            Back
          </button>
          <button type="submit" disabled={busy} className="cursor-pointer rounded-full bg-flag px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Releasing…" : paid ? "Cancel registration" : "Release spots"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function RegistrationActionButtons({
  target,
  extensionMax,
  onChanged,
}: {
  target: ActionTarget;
  extensionMax: number;
  onChanged: (message: string) => void;
}) {
  const call = useAdminCall();
  const [modal, setModal] = useState<null | "confirm" | "extend" | "release">(null);
  const [message, setMessage] = useState("");
  const done = (m: string) => {
    setModal(null);
    onChanged(m);
  };

  async function reinstate() {
    setMessage("");
    const result = await call(`/api/admin/camp-registrations/${target.id}/reinstate`);
    if (result.ok && result.data.success) onChanged(`${target.reference} reinstated.`);
    else setMessage(String(result.data.error ?? "Could not reinstate. Nothing was changed."));
  }

  const { status } = target;
  return (
    <div className="flex flex-wrap gap-2">
      {(status === "pending_payment" || status === "payment_reported" || status === "cancelled") && (
        <button type="button" onClick={() => setModal("confirm")} className="cursor-pointer rounded-full bg-forest px-4 py-2 text-xs font-semibold text-cream hover:bg-forest-dark min-h-[40px]">
          {status === "cancelled" ? "Reinstate & confirm payment" : "Confirm payment"}
        </button>
      )}
      {status === "payment_reported" && target.extensionCount < extensionMax && (
        <button type="button" onClick={() => setModal("extend")} className={ACTION_BTN}>
          Extend review ({extensionMax - target.extensionCount} left)
        </button>
      )}
      {status === "cancelled" && target.reinstateCount < 2 && (
        <button type="button" onClick={reinstate} className={ACTION_BTN}>
          Reinstate (awaiting)
        </button>
      )}
      {(status === "pending_payment" || status === "payment_reported" || status === "paid") && (
        <button type="button" onClick={() => setModal("release")} className="cursor-pointer rounded-full border border-flag/40 px-4 py-2 text-xs font-semibold text-flag hover:bg-flag/10 min-h-[40px]">
          {status === "paid" ? "Cancel" : status === "payment_reported" ? "Release (not received)" : "Release"}
        </button>
      )}
      {message && (
        <p role="alert" className="w-full text-sm text-flag">
          {message}
        </p>
      )}
      {modal === "confirm" && <ConfirmModal target={target} onClose={() => setModal(null)} onDone={done} />}
      {modal === "extend" && <ExtendModal target={target} onClose={() => setModal(null)} onDone={done} />}
      {modal === "release" && <ReleaseModal target={target} onClose={() => setModal(null)} onDone={done} />}
    </div>
  );
}
