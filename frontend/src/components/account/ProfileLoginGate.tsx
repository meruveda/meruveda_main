"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Smartphone } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

// OTP DISABLED — whole file commented out below (kept for re-enable).
// (Was: Myntra-style Login / Signup gate shown on /profile for guests.
// Same WhatsApp-OTP backend as the checkout form (auto-register on unknown
// numbers, login on known ones) — but rendered inline so the profile icon
// never bounces the shopper to checkout. After verification the shopper
// lands on `next` (a validated same-site path) or stays on their profile.)

/* TEMPORARILY DISABLED — everything below is commented out.
   To re-enable: delete this opener, the closer at end of file, and restore
   the two `//` comment lines above back to block comments if desired.


// Only same-site app paths; never external, protocol-relative or /login.
export function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.startsWith("/login")) return null;
  return raw;
}

const RESEND_SECONDS = 45;

export default function ProfileLoginGate({ next }: { next: string | null }) {
  const { sendOtp, resendOtp, verifyOtp } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const done = (validNext: string | null) => {
    if (validNext) router.replace(validNext);
    // Otherwise the AuthContext user flip re-renders /profile into the
    // signed-in view on its own — no navigation needed.
  };

  const describeError = (err: unknown, fallback: string): string => {
    const raw = (err as Error)?.message || "";
    if (!raw || raw === "Network Error" || /timeout|aborted/i.test(raw)) {
      return "WhatsApp could not be reached right now. Please try again in a moment.";
    }
    return raw || fallback;
  };

  const handleSend = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    setError("");
    setMessage("");
    if (name.trim().length < 2) {
      setError("Please enter your name.");
      return;
    }
    if (mobile.replace(/\D/g, "").length < 10) {
      setError("Please enter a valid 10-digit mobile number.");
      return;
    }
    setSending(true);
    try {
      const res = await sendOtp(mobile);
      setOtpSent(true);
      setResendIn(RESEND_SECONDS);
      setMessage(
        res?.devOtp
          ? `Code sent on WhatsApp. (Dev mode — your code is ${res.devOtp})`
          : "Code sent to your WhatsApp number.",
      );
    } catch (err: unknown) {
      setError(describeError(err, "Could not send the code. Please try again."));
    } finally {
      setSending(false);
    }
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    setError("");
    setMessage("");
    setSending(true);
    try {
      const res = await resendOtp(mobile);
      setResendIn(RESEND_SECONDS);
      setMessage(
        res?.devOtp ? `A new code was sent. (Dev mode — ${res.devOtp})` : "A new code has been sent.",
      );
    } catch (err: unknown) {
      setError(describeError(err, "Could not resend the code. Please try again."));
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError("");
    if (code.replace(/\D/g, "").length !== 6) {
      setError("Please enter the 6-digit code.");
      return;
    }
    setVerifying(true);
    try {
      await verifyOtp(mobile, code, name.trim());
      setMessage("Verified. Opening your profile…");
      done(next);
    } catch (err: unknown) {
      setError(describeError(err, "Invalid code. Please try again."));
    } finally {
      setVerifying(false);
    }
  };

  const input =
    "w-full border border-gray-300 rounded px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-500 transition-colors bg-white placeholder:text-gray-400";

  return (
    <section className="max-w-md mx-auto bg-white border border-gray-200" aria-label="Login or signup">
      <div className="px-6 md:px-8 pt-7 pb-2 text-center">
        <span className="inline-flex w-12 h-12 rounded-full bg-ivory border border-gray-200 items-center justify-center mb-3">
          <Smartphone size={20} className="text-deep-purple" />
        </span>
        <h2 className="text-lg font-bold text-gray-900">Login / Signup</h2>
        <p className="text-[13px] text-gray-500 mt-1.5 leading-relaxed">
          To access your profile, orders, wishlist and more — all with one WhatsApp code.
        </p>
      </div>

      <div className="px-6 md:px-8 py-5">
        {!otpSent ? (
          <form onSubmit={handleSend} className="space-y-3.5">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5" htmlFor="gate-name">
                Full Name
              </label>
              <input
                id="gate-name"
                className={input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Aarav Mehta"
                autoComplete="name"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5" htmlFor="gate-mobile">
                Mobile Number
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 rounded-l text-sm text-gray-500 bg-gray-50">
                  +91
                </span>
                <input
                  id="gate-mobile"
                  className={`${input} rounded-l-none`}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/[^\d+]/g, ""))}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="98765 43210"
                />
              </div>
            </div>
            {error && (
              <p className="text-[13px] text-red-600" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={sending}
              className="w-full py-2.5 bg-deep-purple text-white text-[13px] font-bold tracking-wide rounded hover:bg-deep-purple/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {sending && <Loader2 size={14} className="animate-spin" />}
              {sending ? "SENDING…" : "SEND CODE"}
            </button>
            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
              We&apos;ll WhatsApp you a 6-digit code. New here? Your account is created automatically.
            </p>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-3.5">
            <p className="text-[13px] text-gray-600 text-center">
              Code sent to <span className="font-bold text-gray-900">+91 {mobile}</span>{" "}
              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setCode("");
                  setError("");
                  setMessage("");
                }}
                className="font-bold text-deep-purple hover:underline ml-1"
              >
                Change
              </button>
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="Enter 6-digit code"
              aria-label="Enter 6-digit code"
              className={`${input} font-mono text-center tracking-[0.4em] placeholder:tracking-normal placeholder:font-sans`}
            />
            {message && (
              <p className="flex items-center justify-center gap-1.5 text-[13px] text-green-700" role="status">
                <CheckCircle2 size={14} /> {message}
              </p>
            )}
            {error && (
              <p className="text-[13px] text-red-600 text-center" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={verifying || code.length !== 6}
              className="w-full py-2.5 bg-deep-purple text-white text-[13px] font-bold tracking-wide rounded hover:bg-deep-purple/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {verifying && <Loader2 size={14} className="animate-spin" />}
              {verifying ? "VERIFYING…" : "VERIFY & CONTINUE"}
            </button>
            <p className="text-center">
              <button
                type="button"
                onClick={handleResend}
                disabled={resendIn > 0 || sending}
                className="text-[13px] font-bold text-deep-purple hover:underline disabled:text-gray-400 disabled:no-underline"
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>
            </p>
          </form>
        )}
      </div>
    </section>
  );
}

// END OTP DISABLED — closer for the wrapper opened at the top of this file.
*/
