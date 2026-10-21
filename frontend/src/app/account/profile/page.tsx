"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Save, ShieldCheck, User, Mail, Phone } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import axiosInstance from "@/api/axiosInstance";
import toast from "react-hot-toast";

/**
 * The customer profile.
 *
 * The profile is created automatically at the checkout contact step, so there
 * is nothing to sign up for: the customer only corrects a typo in the name
 * or the email.
 *
 * The PHONE is read-only on purpose. It is the identity of the session - it
 * is what the order history and the address book are keyed on - and the
 * number is only "verified" when the WhatsApp OTP is switched on.
 */
export default function AccountProfilePage() {
  const { customerSession, hasSession } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await axiosInstance.get("/account/profile");
        const profile = res.data?.data?.profile || {};
        if (cancelled) return;
        setName(profile.name || "");
        setEmail(profile.email || "");
      } catch (err: any) {
        if (!cancelled) {
          setError(
            err?.response?.data?.error?.message ||
              "We could not load your profile right now. Please try again.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // The session the context already knows about fills the form immediately.
  useEffect(() => {
    if (!customerSession) return;
    setName((current) => current || customerSession.name || "");
    setEmail((current) => current || customerSession.email || "");
  }, [customerSession]);

  const phone = customerSession?.phone || "";
  const verified = customerSession?.phoneVerified === true;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (cleanName.length < 2) {
      setError("Please enter your full name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    setSaving(true);
    try {
      await axiosInstance.put("/account/profile", { name: cleanName, email: cleanEmail });
      toast.success("Profile updated");
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message || "We could not save your profile. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/account"
          className="p-2 bg-white border rounded-xl hover:bg-ivory transition-colors"
          aria-label="Back to overview"
        >
          <ArrowLeft size={18} className="text-deep-purple" />
        </Link>
        <h1 className="text-2xl font-playfair font-bold text-deep-purple">My Profile</h1>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-gray-500 text-sm py-8">
          <Loader2 size={18} className="animate-spin" /> Loading your profile…
        </div>
      ) : (
        <form onSubmit={save} className="bg-white border border-gray-100 rounded-2xl p-6 space-y-5">
          <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 p-4">
            <ShieldCheck size={18} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">
              Your profile was created automatically at checkout. The mobile number is confirmed
              by WhatsApp when you place your first order.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-deep-purple mb-1.5" htmlFor="profile-name">
                <User size={12} className="inline mr-1" /> Full Name
              </label>
              <input
                id="profile-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-deep-purple"
                placeholder="Your name"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-deep-purple mb-1.5" htmlFor="profile-email">
                <Mail size={12} className="inline mr-1" /> Email Address
              </label>
              <input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-deep-purple"
                placeholder="you@example.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-deep-purple mb-1.5" htmlFor="profile-phone">
              <Phone size={12} className="inline mr-1" /> Mobile Number
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                id="profile-phone"
                type="text"
                value={phone}
                readOnly
                disabled
                className="w-full sm:w-64 border border-gray-200 bg-gray-50 rounded-xl px-3.5 py-2.5 text-sm text-gray-500 cursor-not-allowed"
              />
              {verified ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
                  Verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
                  Not verified
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">
              The number is the identity of your profile, so it cannot be changed here.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-gray-500">
              {hasSession ? "Your profile is saved on this device." : "No profile yet."}
            </p>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 bg-deep-purple text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-deep-purple/90 disabled:opacity-60"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Save changes
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
