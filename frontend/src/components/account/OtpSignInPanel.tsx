"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { isValidPhone } from "@/types/account";
import { CountryPhoneField } from "@/components/CountryPhoneField";
import { DEFAULT_COUNTRY, formatDisplay, fullPhoneDigits, type Country } from "@/constants/countries";

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
  const [phoneCountry, setPhoneCountry] = useState<Country>(DEFAULT_COUNTRY);
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
      if (!isValidPhone(fullPhoneDigits(mobile, phoneCountry))) {
        setError("Please enter a valid mobile number.");
        return;
      }
    }

    // The full international number, so the OTP reaches the right handset.
    const phone = fullPhoneDigits(mobile, phoneCountry);
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
      await verifyOtp(fullPhoneDigits(mobile, phoneCountry), digits, name.trim() || undefined);
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
            <CountryPhoneField
              id="otp-mobile"
              country={phoneCountry}
              onCountryChange={setPhoneCountry}
              value={mobile}
              onValueChange={setMobile}
            />
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
              Mobile: <span className="font-semibold text-gray-900">{formatDisplay(mobile, phoneCountry)}</span>
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
