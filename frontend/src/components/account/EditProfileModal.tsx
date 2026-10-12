"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Pencil } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { isValidEmail, isValidPhone, normalizePhone10 } from "@/types/account";
import { displayEmail } from "@/types/account";
import { Notice } from "@/components/account/ui";

/**
 * Edit-profile modal: photo preview (URL), first/last name, email, phone,
 * DOB + gender (stored locally until the backend adds columns), and a
 * password-change shortcut. Validates inline, never echoes secrets.
 */
export function EditProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, saveProfile } = useAuth();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", avatar: "", dob: "", gender: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    if (open && user) {
      let dob = "";
      let gender = "";
      try {
        const extra = JSON.parse(localStorage.getItem("meruveda_profile_extra") || "{}");
        dob = extra.dob || "";
        gender = extra.gender || "";
      } catch {
        /* ignore */
      }
      setForm({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: displayEmail(user.email),
        phone: user.phone || "",
        avatar: user.avatar || "",
        dob,
        gender,
      });
      setErrors({});
      setNotice(null);
    }
  }, [open, user]);

  if (!open) return null;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (form.firstName.trim().length < 2) e.firstName = "Enter your first name.";
    if (form.email && !isValidEmail(form.email)) e.email = "Enter a valid email address.";
    if (form.phone && !isValidPhone(form.phone)) e.phone = "Enter a valid 10-digit mobile number.";
    if (form.dob) {
      const d = new Date(form.dob);
      if (Number.isNaN(d.getTime()) || d > new Date()) e.dob = "Enter a valid date of birth.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setNotice(null);
    try {
      const phone = form.phone ? `+91 ${normalizePhone10(form.phone)}` : undefined;
      await saveProfile({
        name: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
        email: form.email.trim() || undefined,
        phone,
      });
      try {
        localStorage.setItem("meruveda_profile_extra", JSON.stringify({ dob: form.dob, gender: form.gender }));
      } catch {
        /* ignore */
      }
      setNotice({ tone: "success", msg: "Profile updated successfully." });
      setTimeout(onClose, 900);
    } catch (err: unknown) {
      setNotice({ tone: "error", msg: (err as Error)?.message || "Could not save changes. Try again." });
    } finally {
      setSaving(false);
    }
  };

  const input = "w-full border border-gray-300 rounded-lg px-4 py-2.5 outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 transition-all text-sm";
  const label = "block text-gray-700 font-medium mb-1.5 text-sm";
  const err = "text-xs text-red-600 mt-1";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Edit profile">
      <div className="absolute inset-0 bg-deep-purple/50 backdrop-blur-[2px]" onClick={saving ? undefined : onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-6 md:p-7">
        <div className="flex items-center gap-4 mb-6">
          {form.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.avatar} alt="Profile preview" className="w-14 h-14 rounded-full object-cover border-2 border-gold/40" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-gold flex items-center justify-center text-deep-purple text-xl font-bold">
              {(form.firstName?.[0] || "U").toUpperCase()}
            </div>
          )}
          <div>
            <h2 className="text-xl font-playfair font-bold text-deep-purple flex items-center gap-2">
              <Pencil size={17} className="text-gold" /> Edit Profile
            </h2>
            <p className="text-xs text-gray-500">Only your name, email and phone are synced to the server.</p>
          </div>
        </div>

        {notice && <Notice tone={notice.tone}>{notice.msg}</Notice>}

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <label className={label} htmlFor="ep-avatar">Profile photo URL</label>
            <input id="ep-avatar" className={input} value={form.avatar} onChange={set("avatar")} placeholder="https://…" inputMode="url" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="ep-fn">First name *</label>
              <input id="ep-fn" className={input} value={form.firstName} onChange={set("firstName")} required autoComplete="given-name" />
              {errors.firstName && <p className={err}>{errors.firstName}</p>}
            </div>
            <div>
              <label className={label} htmlFor="ep-ln">Last name</label>
              <input id="ep-ln" className={input} value={form.lastName} onChange={set("lastName")} autoComplete="family-name" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="ep-email">Email</label>
              <input id="ep-email" type="email" className={input} value={form.email} onChange={set("email")} placeholder="you@example.com" autoComplete="email" />
              {errors.email && <p className={err}>{errors.email}</p>}
            </div>
            <div>
              <label className={label} htmlFor="ep-phone">Phone number</label>
              <input id="ep-phone" className={input} value={form.phone} onChange={set("phone")} placeholder="98765 43210" inputMode="tel" autoComplete="tel" />
              {errors.phone && <p className={err}>{errors.phone}</p>}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label} htmlFor="ep-dob">Date of birth <span className="text-gray-400 font-normal">(optional)</span></label>
              <input id="ep-dob" type="date" className={input} value={form.dob} onChange={set("dob")} max={new Date().toISOString().slice(0, 10)} />
              {errors.dob && <p className={err}>{errors.dob}</p>}
            </div>
            <div>
              <label className={label} htmlFor="ep-gender">Gender <span className="text-gray-400 font-normal">(optional)</span></label>
              <select id="ep-gender" className={input} value={form.gender} onChange={set("gender")}>
                <option value="">Prefer not to say</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <p className="text-xs text-gray-500 bg-ivory/60 border border-gray-100 rounded-lg px-3.5 py-2.5">
            To change your password, use <Link href="/account/settings" className="font-bold text-gold hover:underline">Account Settings → Security</Link>. We never display your current password here.
          </p>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2.5 border border-gray-200 hover:bg-gray-50 rounded-lg text-sm font-semibold text-gray-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-deep-purple text-white hover:bg-deep-purple/90 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
