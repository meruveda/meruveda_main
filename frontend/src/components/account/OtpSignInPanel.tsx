"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { isValidPhone, normalizePhone10 } from "@/types/account";

const RESEND_SECONDS = 45;

const input =
  "w-full border border-gray-300 rounded px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-500 transition-colors bg-white placeholder:text-gray-400";
const label = "block text-xs text-gray-500 mb-1.5";
const primaryButton =
  "w-full py-2.5 bg-deep-purple text-white text-[13px] font-bold tracking-wide rounded hover:bg-deep-purple/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2";

interface OtpSignInPanelProps {
  /** "signup" makes the first name required; "login" treats it as optional. */
  mode: "login" | "signup";
  /** Called once the OTP is verified and the session has been stored. */
  onSuccess: () => void;
}

/**
 * Two-step mobile sign-in: request a 6-digit code over WhatsApp, then verify it.
 * Verification logs an existing customer in or registers a new one (the backend
 * handles both), so the same panel powers login and sign-up.
 */
export default function OtpSignInPanel({ mode, onSuccess }: OtpSignInPanelProps) {
  const { sendOtp, resendOtp, verifyOtp } = useAuth();

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // Resend cooldown ticker (mirrors the checkout OTP step).
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const requestCode = async (isResend: boolean) => {
    setError(null);
    setNotice(null);
    if (!isResend) {
      if (mode === "signup" && name.trim().length < 2) {
        setError("Please enter your first name.");
        return;
      }
      if (!isValidPhone(mobile)) {
        setError("Please enter a valid 10-digit mobile number.");
        return;
      }
    }

    const phone = normalizePhone10(mobile);
    setBusy(true);
    try {
      if (isResend) {
        await resendOtp(phone);
      } else {
        await sendOtp(phone);
      }
      setStep("code");
      setCode("");
      setResendIn(RESEND_SECONDS);
      setNotice(`We sent a 6-digit code to +91 ${phone} on WhatsApp.`);
    } catch (err: unknown) {
      setError((err as Error)?.message || "Could not send the code. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Enter the 6-digit code we sent you on WhatsApp.");
      return;
    }
    setBusy(true);
    try {
      await verifyOtp(normalizePhone10(mobile), digits, name.trim() || undefined);
      onSuccess();
    } catch (err: unknown) {
      setError((err as Error)?.message || "That code is incorrect or has expired.");
    } finally {
      setBusy(false);
    }
  };

  const changeNumber = () => {
    setStep("phone");
    setCode("");
    setError(null);
    setNotice(null);
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-[13px]" role="alert">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="px-4 py-2.5 bg-green-50 border border-green-200 text-green-800 text-[13px]" role="status">
          {notice}
        </p>
      )}

      {step === "phone" ? (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            requestCode(false);
          }}
          className="space-y-4"
          noValidate
        >
          <div>
            <label className={label} htmlFor="otp-name">
              Your name{mode === "signup" ? " *" : " (for new accounts)"}
            </label>
            <input
              id="otp-name"
              type="text"
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="First and last name"
              autoComplete="name"
            />
          </div>
          <div>
            <label className={label} htmlFor="otp-mobile">
              Mobile number *
            </label>
            <div className="flex">
              <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 rounded-l text-sm text-gray-500 bg-gray-50">
                +91
              </span>
              <input
                id="otp-mobile"
                type="tel"
                className={`${input} rounded-l-none`}
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="98765 43210"
                autoComplete="tel"
                inputMode="tel"
              />
            </div>
          </div>
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? "SENDING CODE…" : "GET OTP ON WHATSAPP"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4" noValidate>
          <div className="flex items-center justify-between text-[13px] text-gray-600">
            <span>
              Mobile: <span className="font-semibold text-gray-900">+91 {normalizePhone10(mobile)}</span>
            </span>
            <button
              type="button"
              onClick={changeNumber}
              className="font-bold text-deep-purple hover:underline"
            >
              Change
            </button>
          </div>
          <div>
            <label className={label} htmlFor="otp-code">
              6-digit code *
            </label>
            <input
              id="otp-code"
              type="text"
              className={`${input} tracking-[0.4em] text-center text-lg font-semibold`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
            />
          </div>
          <button type="submit" disabled={busy || code.length !== 6} className={primaryButton}>
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? "VERIFYING…" : "VERIFY & CONTINUE"}
          </button>
          <p className="text-center text-[13px]">
            <button
              type="button"
              onClick={() => requestCode(true)}
              disabled={busy || resendIn > 0}
              className="text-gray-500 hover:text-deep-purple hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
            </button>
          </p>
        </form>
      )}
    </div>
  );
}
