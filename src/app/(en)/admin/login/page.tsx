"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Container from "@/components/Container";
import { business } from "@/lib/content";
import { safeAdminNextPath } from "@/lib/requestGuards";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeAdminNextPath(searchParams.get("next"));
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();

      if (response.ok && result.success) {
        router.push(next);
        router.refresh();
      } else {
        setError(result.error || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto max-w-sm rounded-2xl border border-gold/30 bg-cream p-8"
    >
      <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink">
        Admin password
      </label>
      <input
        id="password"
        type="password"
        required
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-ink outline-none focus:border-forest focus:ring-1 focus:ring-forest"
      />
      <button
        type="submit"
        disabled={loading}
        className="mt-5 w-full cursor-pointer rounded-full bg-forest px-6 py-3 text-sm font-semibold text-cream transition-colors hover:bg-forest-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Checking…" : "Log In"}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-flag">
          {error}
        </p>
      )}
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="py-20 sm:py-28">
      <Container className="max-w-md">
        <div className="text-center">
          <p className="font-display text-sm uppercase tracking-[0.3em] text-gold">Admin</p>
          <h1 className="mt-3 font-display text-2xl font-semibold text-forest">
            {business.name}
          </h1>
        </div>
        <div className="mt-8">
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </Container>
    </div>
  );
}
