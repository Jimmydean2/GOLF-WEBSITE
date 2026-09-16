"use client";

import { FormEvent, useState } from "react";
import { business, web3FormsAccessKey } from "@/lib/content";

type Status = "idle" | "sending" | "success" | "error";

export default function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");

  if (!web3FormsAccessKey) {
    return (
      <div className="rounded-2xl border border-gold/30 bg-cream p-8 text-center">
        <p className="text-ink-soft">
          The contact form is being finalized. For now, please reach out
          directly:
        </p>
        <div className="mt-4 flex flex-col items-center gap-1">
          <a href={business.phoneHref} className="font-semibold text-forest hover:underline">
            {business.phone}
          </a>
          <a href={`mailto:${business.email}`} className="font-semibold text-forest hover:underline">
            {business.email}
          </a>
        </div>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.append("access_key", web3FormsAccessKey);
    formData.append("subject", `New website contact form message — ${business.name}`);

    try {
      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (result.success) {
        setStatus("success");
        form.reset();
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-gold/30 bg-cream p-8 text-center">
        <p className="font-display text-xl font-semibold text-forest">
          Message sent!
        </p>
        <p className="mt-2 text-ink-soft">
          Thanks for reaching out &mdash; we&apos;ll get back to you soon.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-gold/30 bg-cream p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-ink">
            Full name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
          />
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
          />
        </div>
      </div>

      <div>
        <label htmlFor="message" className="mb-1 block text-sm font-medium text-ink">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          required
          className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
        />
      </div>

      <button
        type="submit"
        disabled={status === "sending"}
        className="w-full cursor-pointer rounded-full bg-forest px-6 py-3 text-sm font-semibold text-cream transition-colors hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : "Send Message"}
      </button>

      {status === "error" && (
        <p role="alert" className="text-sm text-flag">
          Something went wrong sending your message. Please try again, or
          contact {business.phone} directly.
        </p>
      )}
    </form>
  );
}
