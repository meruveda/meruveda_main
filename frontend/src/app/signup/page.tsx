"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, UserRound } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { isValidEmail, isValidPhone } from "@/types/account";
import { CountryPhoneField } from "@/components/CountryPhoneField";
import { DEFAULT_COUNTRY, toStoredPhone, type Country } from "@/constants/countries";
import OtpSignInPanel from "@/components/account/OtpSignInPanel";

/** Only same-site app paths; never external, protocol-relative or /login. */
function safeNext(raw: string | null): string {
  if (!raw) return "/account";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) return "/account";
  return raw;
}

function SignupInner() {
  const { user, isLoading, signup } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next") || searchParams.get("returnUrl"));

  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "", confirm: "" });
  const [phoneCountry, setPhoneCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"password" | "otp">("otp");

  useEffect(() => {
    if (!isLoading && user) router.replace(next);
  }, [isLoading, user, router, next]);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    if (form.firstName.trim().length < 2) {
      setError("Please enter your first name.");
      return;
    }
    if (!isValidPhone(form.phone)) {
      setError("Please enter a valid 10-digit mobile number.");
      return;
    }
    // Email is optional — only used for order notifications. Validate when given.
    const cleanEmail = form.email.trim();
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      setError("Please enter a valid email address, or leave it blank.");
      return;
    }
    if (form.password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await signup({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: cleanEmail || undefined,
        phone: toStoredPhone(form.phone, phoneCountry),
        password: form.password,
      });
      router.replace(next);
    } catch (err: unknown) {
      setError((err as Error)?.message || "Could not create your account.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gold" />
      </div>
    );
  }

  if (user) return null;

  const input =
    "w-full border border-gray-300 rounded px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-500 transition-colors bg-white placeholder:text-gray-400";
  const label = "block text-xs text-gray-500 mb-1.5";

  return (
    <div className="mx-auto max-w-md px-4 sm:px-6 py-10 md:py-14">
      <nav className="text-[13px] text-gray-500 mb-6" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-gray-800">
          Home
        </Link>
        <span className="mx-1.5 text-gray-400">/</span>
        <span className="font-bold text-gray-800">Create Account</span>
      </nav>

      <section className="bg-white border border-gray-200 px-6 md:px-8 py-7" aria-label="Create account">
        <span className="inline-flex w-11 h-11 rounded-full bg-ivory border border-gray-200 items-center justify-center mb-4">
          <UserRound size={18} className="text-deep-purple" />
        </span>
        <h1 className="text-lg font-bold text-gray-900">Create your account</h1>
        <p className="text-[13px] text-gray-500 mt-1 mb-6">One account for shopping, tracking and support.</p>

        {error && (
          <p className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-[13px]" role="alert">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 mb-6 border border-gray-200 rounded overflow-hidden text-[13px] font-bold" role="tablist">
          {(
            [
              ["otp", "Mobile OTP"],
              ["password", "Password"],
            ] as const
          ).map(([key, text]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={method === key}
              onClick={() => {
                setMethod(key);
                setError(null);
              }}
              className={`py-2.5 transition-colors ${
                method === key ? "bg-deep-purple text-white" : "bg-white text-gray-500 hover:text-deep-purple"
              }`}
            >
              {text}
            </button>
          ))}
        </div>

        {method === "otp" ? (
          <OtpSignInPanel mode="signup" onSuccess={() => router.replace(next)} />
        ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="su-first">
                First name *
              </label>
              <input id="su-first" className={input} value={form.firstName} onChange={set("firstName")} autoComplete="given-name" placeholder="Aarav" />
            </div>
            <div>
              <label className={label} htmlFor="su-last">
                Last name
              </label>
              <input id="su-last" className={input} value={form.lastName} onChange={set("lastName")} autoComplete="family-name" placeholder="Mehta" />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="su-phone">
              Mobile number *
            </label>
            <CountryPhoneField
              id="su-phone"
              country={phoneCountry}
              onCountryChange={setPhoneCountry}
              value={form.phone}
              onValueChange={(v) => setForm((p) => ({ ...p, phone: v }))}
            />
          </div>
          <div>
            <label className={label} htmlFor="su-email">
              Email address <span className="text-gray-400 font-normal">(optional, for order updates)</span>
            </label>
            <input id="su-email" type="email" className={input} value={form.email} onChange={set("email")} autoComplete="email" placeholder="you@example.com" />
          </div>
          <div>
            <label className={label} htmlFor="su-password">
              Password *
            </label>
            <div className="relative">
              <input
                id="su-password"
                type={showPw ? "text" : "password"}
                className={`${input} pr-11`}
                value={form.password}
                onChange={set("password")}
                placeholder="Min. 6 characters"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="su-confirm">
              Confirm password *
            </label>
            <input
              id="su-confirm"
              type={showPw ? "text" : "password"}
              className={input}
              value={form.confirm}
              onChange={set("confirm")}
              placeholder="Repeat password"
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 bg-deep-purple text-white text-[13px] font-bold tracking-wide rounded hover:bg-deep-purple/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? "CREATING…" : "CREATE ACCOUNT"}
          </button>
        </form>
        )}

        <p className="text-[13px] text-gray-500 text-center mt-6">
          Already have an account?{" "}
          <Link
            href={`/login?next=${encodeURIComponent(next === "/account" ? "/account" : next)}`}
            className="font-bold text-deep-purple hover:underline"
          >
            Log in
          </Link>
        </p>
      </section>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-gold" />
        </div>
      }
    >
      <SignupInner />
    </Suspense>
  );
}
