"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { isValidEmail, isValidPhone, normalizePhone10 } from "@/types/account";
import { CountryPhoneField } from "@/components/CountryPhoneField";
import { DEFAULT_COUNTRY, toStoredPhone, type Country } from "@/constants/countries";
import OtpSignInPanel from "@/components/account/OtpSignInPanel";

/** Only same-site app paths; never external, protocol-relative or /login. */
function safeNext(raw: string | null): string {
  if (!raw) return "/account";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/login")) return "/account";
  return raw;
}

function LoginInner() {
  const { user, isLoading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next") || searchParams.get("returnUrl"));

  const [mobile, setMobile] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [email, setEmail] = useState("");
  const [useEmail, setUseEmail] = useState(false);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<"password" | "otp">("password");

  // Already signed in — no need to show the form.
  useEffect(() => {
    if (!isLoading && user) router.replace(next);
  }, [isLoading, user, router, next]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    if (useEmail) {
      if (!isValidEmail(email)) {
        setError("Please enter a valid email address.");
        return;
      }
    } else if (!isValidPhone(mobile)) {
      setError("Please enter a valid 10-digit mobile number.");
      return;
    }
    if (!password) {
      setError(
        useEmail
          ? "Please enter your email and password."
          : "Please enter your mobile number and password."
      );
      return;
    }
    setBusy(true);
    try {
      // The full international number is sent, so a customer who signed up
      // from another country is found by the same lookup the backend uses.
      const identifier = useEmail
        ? email.trim()
        : toStoredPhone(mobile, phoneCountry);
      await login(identifier, password, rememberMe);
      router.replace(next);
    } catch (err: unknown) {
      // Generic on purpose — never hint whether the number has an account.
      setError((err as Error)?.message || "Invalid mobile number or password.");
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

  return (
    <div className="mx-auto max-w-md px-4 sm:px-6 py-10 md:py-14">
      <nav className="text-[13px] text-gray-500 mb-6" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-gray-800">
          Home
        </Link>
        <span className="mx-1.5 text-gray-400">/</span>
        <span className="font-bold text-gray-800">Login</span>
      </nav>

      <section className="bg-white border border-gray-200 px-6 md:px-8 py-7" aria-label="Login">
        <span className="inline-flex w-11 h-11 rounded-full bg-ivory border border-gray-200 items-center justify-center mb-4">
          <Lock size={18} className="text-deep-purple" />
        </span>
        <h1 className="text-lg font-bold text-gray-900">Welcome back</h1>
        <p className="text-[13px] text-gray-500 mt-1 mb-6">Log in to shop, track orders and manage your account.</p>

        {error && (
          <p className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-[13px]" role="alert">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 mb-6 border border-gray-200 rounded overflow-hidden text-[13px] font-bold" role="tablist">
          {(
            [
              ["password", "Password"],
              ["otp", "Mobile OTP"],
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
          <OtpSignInPanel mode="login" onSuccess={() => router.replace(next)} />
        ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {useEmail ? (
            <div>
              <label className="block text-xs text-gray-500 mb-1.5" htmlFor="login-email">
                Email address
              </label>
              <input
                id="login-email"
                type="email"
                required
                className={input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs text-gray-500 mb-1.5" htmlFor="login-mobile">
                Mobile number
              </label>
              <CountryPhoneField
                id="login-mobile"
                country={phoneCountry}
                onCountryChange={setPhoneCountry}
                value={mobile}
                onValueChange={(v) => setMobile(v)}
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5" htmlFor="login-password">
              Password
            </label>
            <div className="relative">
              <input
                id="login-password"
                type={showPw ? "text" : "password"}
                required
                className={`${input} pr-11`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
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

          <div className="flex items-center justify-between text-[13px]">
            <label className="flex items-center gap-2 text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 accent-[#2E0F36]"
              />
              Remember me
            </label>
            <Link href="/forgot-password" className="font-bold text-deep-purple hover:underline">
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 bg-deep-purple text-white text-[13px] font-bold tracking-wide rounded hover:bg-deep-purple/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? "LOGGING IN…" : "LOGIN"}
          </button>

          <p className="text-center text-[13px]">
            <button
              type="button"
              onClick={() => {
                setUseEmail((v) => !v);
                setError(null);
              }}
              className="text-gray-500 hover:text-deep-purple hover:underline"
            >
              {useEmail ? "Use mobile number instead" : "Registered before? Log in with email"}
            </button>
          </p>
        </form>
        )}

        <p className="text-[13px] text-gray-500 text-center mt-6">
          New here?{" "}
          <Link
            href={`/signup?next=${encodeURIComponent(next === "/account" ? "/account" : next)}`}
            className="font-bold text-deep-purple hover:underline"
          >
            Create an account
          </Link>
        </p>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-gold" />
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
