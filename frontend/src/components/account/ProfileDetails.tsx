"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { isValidEmail, isValidPhone, normalizePhone10 } from "@/types/account";
import { displayEmail } from "@/types/account";

/**
 * Myntra-style Profile Details card.
 *
 * View mode: plain label → value rows (Full Name, Mobile Number, Email ID,
 * Gender, Date of Birth, Location, Alternate Mobile, Hint Name) with an
 * outlined EDIT button. Edit mode: the same card becomes an inline form with
 * thin-bordered inputs, gender radios, DOB date input and SAVE DETAILS.
 *
 * Server-synced fields (via PUT /auth/profile): name, email, phone.
 * The rest (gender, dob, location, altMobile, hintName) persist to
 * `meruveda_profile_extra` in localStorage — the backend has no columns
 * for them yet.
 */

export interface ProfileExtra {
  dob: string;
  gender: string;
  location: string;
  altMobile: string;
  hintName: string;
}

export const PROFILE_EXTRA_KEY = "meruveda_profile_extra";

export function readProfileExtra(): ProfileExtra {
  const fallback: ProfileExtra = { dob: "", gender: "", location: "", altMobile: "", hintName: "" };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(PROFILE_EXTRA_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ProfileExtra>;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") };
}

export default function ProfileDetails() {
  const { user, saveProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [extra, setExtra] = useState<ProfileExtra>({ dob: "", gender: "", location: "", altMobile: "", hintName: "" });

  const [form, setForm] = useState({
    fullName: "",
    mobile: "",
    email: "",
    gender: "",
    dob: "",
    location: "",
    altMobile: "",
    hintName: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setExtra(readProfileExtra());
  }, []);

  if (!user) return null;

  const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "—";
  const displayName = extra.hintName.trim() || user.firstName || "Customer";

  const rows: Array<{ label: string; value: string; empty: boolean }> = [
    { label: "Full Name", value: fullName, empty: !fullName || fullName === "—" },
    { label: "Email ID", value: displayEmail(user.email), empty: !displayEmail(user.email) },
    { label: "Mobile Number", value: user.phone || "", empty: !user.phone },
    {
      label: "Gender",
      value: extra.gender ? extra.gender[0].toUpperCase() + extra.gender.slice(1) : "",
      empty: !extra.gender,
    },
    {
      label: "Date of Birth",
      value: extra.dob
        ? new Date(extra.dob + "T00:00:00").toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "",
      empty: !extra.dob,
    },
    { label: "Location", value: extra.location, empty: !extra.location },
    { label: "Alternate Mobile", value: extra.altMobile, empty: !extra.altMobile },
    { label: "Hint Name", value: extra.hintName, empty: !extra.hintName },
  ];

  const startEdit = () => {
    const current = readProfileExtra();
    setForm({
      fullName,
      mobile: user.phone || "",
      email: displayEmail(user.email),
      gender: current.gender,
      dob: current.dob,
      location: current.location,
      altMobile: current.altMobile,
      hintName: current.hintName,
    });
    setErrors({});
    setSaveError(null);
    setEditing(true);
  };

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (form.fullName.trim().length < 2) e.fullName = "Enter your full name.";
    if (!form.mobile.trim()) e.mobile = "Mobile number is required.";
    else if (!isValidPhone(form.mobile)) e.mobile = "Enter a valid 10-digit mobile number.";
    if (form.email.trim() && !isValidEmail(form.email)) e.email = "Enter a valid email address.";
    if (form.altMobile.trim()) {
      if (!isValidPhone(form.altMobile)) e.altMobile = "Enter a valid 10-digit number.";
      else if (normalizePhone10(form.altMobile) === normalizePhone10(form.mobile))
        e.altMobile = "Alternate number must be different from your mobile number.";
    }
    if (form.dob) {
      const d = new Date(form.dob + "T00:00:00");
      if (Number.isNaN(d.getTime()) || d > new Date()) e.dob = "Enter a valid date of birth.";
    }
    if (form.hintName.trim() && form.hintName.trim().length < 2)
      e.hintName = "Hint name should be at least 2 characters.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { first, last } = splitName(form.fullName);
      await saveProfile({
        name: `${first} ${last}`.trim(),
        email: form.email.trim() || undefined,
        phone: form.mobile.trim() ? `+91 ${normalizePhone10(form.mobile)}` : undefined,
      });
      const nextExtra: ProfileExtra = {
        dob: form.dob,
        gender: form.gender,
        location: form.location.trim(),
        altMobile: form.altMobile.trim() ? `+91 ${normalizePhone10(form.altMobile)}` : "",
        hintName: form.hintName.trim(),
      };
      try {
        localStorage.setItem(PROFILE_EXTRA_KEY, JSON.stringify(nextExtra));
      } catch {
        /* storage unavailable */
      }
      setExtra(nextExtra);
      setEditing(false);
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 3200);
    } catch (err: unknown) {
      setSaveError((err as Error)?.message || "Could not save details. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const input =
    "w-full border border-gray-300 rounded px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-500 transition-colors bg-white placeholder:text-gray-400";
  const label = "block text-xs text-gray-500 mb-1.5";
  const err = "text-xs text-red-600 mt-1";

  return (
    <section className="bg-white border border-gray-200" aria-label="Profile details">
      <div className="flex items-center justify-between px-5 md:px-7 pt-5 md:pt-6 pb-4 border-b border-gray-100">
        <div>
          <h2 className="text-base font-bold text-gray-900">Profile Details</h2>
          {savedTick && (
            <p className="text-xs text-green-700 font-medium mt-1" role="status">
              Details saved.
            </p>
          )}
        </div>
        {!editing && (
          <button
            onClick={startEdit}
            className="px-7 py-1.5 border border-gray-400 rounded text-[13px] font-bold text-gray-800 hover:border-gray-900 transition-colors tracking-wide"
          >
            EDIT
          </button>
        )}
      </div>

      {saveError && (
        <p className="mx-5 md:mx-7 mt-4 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-[13px]" role="alert">
          {saveError}
        </p>
      )}

      {!editing ? (
        <dl className="px-5 md:px-7 py-2">
          {rows.map((r) => (
            <div
              key={r.label}
              className="grid grid-cols-[150px_1fr] sm:grid-cols-[190px_1fr] gap-3 py-3 border-b border-gray-100 last:border-0"
            >
              <dt className="text-[13px] text-gray-500">{r.label}</dt>
              <dd className="text-sm text-gray-900 min-w-0">
                {r.empty ? (
                  <button onClick={startEdit} className="text-gray-400 hover:text-gray-700 text-[13px]">
                    — Add
                  </button>
                ) : (
                  <span className="break-words">{r.value}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <form onSubmit={submit} noValidate className="px-5 md:px-7 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4 max-w-2xl">
            <div>
              <label className={label} htmlFor="pd-name">
                Full Name *
              </label>
              <input
                id="pd-name"
                className={input}
                value={form.fullName}
                onChange={set("fullName")}
                autoComplete="name"
                placeholder="e.g. Aarav Mehta"
              />
              {errors.fullName && <p className={err}>{errors.fullName}</p>}
            </div>
            <div>
              <label className={label} htmlFor="pd-hint">
                Hint Name
              </label>
              <input
                id="pd-hint"
                className={input}
                value={form.hintName}
                onChange={set("hintName")}
                placeholder="What should we call you?"
                maxLength={30}
              />
              {errors.hintName && <p className={err}>{errors.hintName}</p>}
            </div>
            <div>
              <label className={label} htmlFor="pd-mobile">
                Mobile Number *
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 rounded-l text-sm text-gray-500 bg-gray-50">
                  +91
                </span>
                <input
                  id="pd-mobile"
                  className={`${input} rounded-l-none`}
                  value={form.mobile}
                  onChange={set("mobile")}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="98765 43210"
                />
              </div>
              {errors.mobile && <p className={err}>{errors.mobile}</p>}
            </div>
            <div>
              <label className={label} htmlFor="pd-alt">
                Alternate Mobile
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 rounded-l text-sm text-gray-500 bg-gray-50">
                  +91
                </span>
                <input
                  id="pd-alt"
                  className={`${input} rounded-l-none`}
                  value={form.altMobile}
                  onChange={set("altMobile")}
                  inputMode="tel"
                  placeholder="Optional"
                />
              </div>
              {errors.altMobile && <p className={err}>{errors.altMobile}</p>}
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="pd-email">
                Email ID
              </label>
              <input
                id="pd-email"
                type="email"
                className={input}
                value={form.email}
                onChange={set("email")}
                autoComplete="email"
                placeholder="you@example.com"
              />
              {errors.email && <p className={err}>{errors.email}</p>}
              <p className="text-[11px] text-gray-400 mt-1">Only saved if no other account owns it.</p>
            </div>
            <div>
              <span className={label} id="pd-gender-label">
                Gender
              </span>
              <div className="flex gap-2" role="radiogroup" aria-labelledby="pd-gender-label">
                {["Male", "Female", "Other"].map((g) => {
                  const val = g.toLowerCase();
                  const active = form.gender === val;
                  return (
                    <button
                      key={g}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setForm((p) => ({ ...p, gender: active ? "" : val }))}
                      className={`flex-1 border rounded px-3 py-2.5 text-[13px] font-medium transition-colors ${
                        active
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-300 text-gray-600 hover:border-gray-500"
                      }`}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className={label} htmlFor="pd-dob">
                Date of Birth
              </label>
              <input
                id="pd-dob"
                type="date"
                className={input}
                value={form.dob}
                onChange={set("dob")}
                max={new Date().toISOString().slice(0, 10)}
              />
              {errors.dob && <p className={err}>{errors.dob}</p>}
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="pd-location">
                Location
              </label>
              <input
                id="pd-location"
                className={input}
                value={form.location}
                onChange={set("location")}
                autoComplete="address-level2"
                placeholder="City you shop from"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-6">
            <button
              type="submit"
              disabled={saving}
              className="px-10 py-2.5 bg-deep-purple text-white text-[13px] font-bold tracking-wide rounded hover:bg-deep-purple/90 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? "SAVING…" : "SAVE DETAILS"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setErrors({});
                setSaveError(null);
              }}
              disabled={saving}
              className="px-8 py-2.5 border border-gray-300 text-[13px] font-bold tracking-wide rounded text-gray-600 hover:border-gray-500 transition-colors disabled:opacity-50"
            >
              CANCEL
            </button>
          </div>
        </form>
      )}

      {/* Greeting reference for assistive tech / data hook */}
      <span className="sr-only" data-hint-name={displayName} />
    </section>
  );
}
