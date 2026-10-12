"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Eye, EyeOff, Loader2, Lock, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { isValidEmail, isValidPhone } from "@/types/account";
import { displayEmail } from "@/types/account";
import { ConfirmDialog, Notice } from "@/components/account/ui";

type Prefs = {
  orderUpdates: boolean;
  deliveryUpdates: boolean;
  promo: boolean;
  email: boolean;
  whatsapp: boolean;
};

const DEFAULT_PREFS: Prefs = {
  orderUpdates: true,
  deliveryUpdates: true,
  promo: true,
  email: true,
  whatsapp: true,
};

function Toggle({ on, onFlip, label, blurb }: { on: boolean; onFlip: () => void; label: string; blurb: string }) {
  return (
    <button
      onClick={onFlip}
      role="switch"
      aria-checked={on}
      className="w-full flex items-start gap-3 text-left py-1"
    >
      <span className={`relative mt-0.5 w-10 h-5.5 h-[22px] rounded-full transition-colors shrink-0 ${on ? "bg-gold" : "bg-gray-200"}`}>
        <span className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-[3px]"}`} />
      </span>
      <span>
        <span className="block text-sm font-semibold text-deep-purple">{label}</span>
        <span className="block text-xs text-gray-500 mt-0.5">{blurb}</span>
      </span>
    </button>
  );
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  const [contact, setContact] = useState({ email: "", phone: "" });
  const [contactBusy, setContactBusy] = useState(false);

  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; msg: string } | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    if (user?.role === "admin") {
      window.location.href = process.env.NEXT_PUBLIC_ADMIN_URL || "/admin";
      return;
    }
    if (user) {
      setContact({ email: displayEmail(user.email), phone: user.phone || "" });
    }
    const load = async () => {
      try {
        const { default: axiosInstance } = await import("@/api/axiosInstance");
        const res = await axiosInstance.get("/auth/preferences");
        const d = res.data?.data || {};
        // Merge legacy keys (smsOrder/whatsappAlerts/…) into the new schema.
        setPrefs({
          orderUpdates: d.orderUpdates ?? d.smsOrder ?? true,
          deliveryUpdates: d.deliveryUpdates ?? d.whatsappAlerts ?? true,
          promo: d.promo ?? d.emailPromo ?? true,
          email: d.email ?? d.emailNewsletter ?? d.emailPromo ?? true,
          whatsapp: d.whatsapp ?? d.whatsappAlerts ?? true,
        });
      } catch {
        /* defaults stand */
      } finally {
        setPrefsLoaded(true);
      }
    };
    load();
  }, [user]);

  if (user?.role === "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
        <Loader2 size={36} className="animate-spin text-gold" />
        <p className="text-deep-purple font-medium text-sm">Redirecting to Admin Dashboard…</p>
      </div>
    );
  }

  const say = (tone: "success" | "error" | "info", msg: string) => {
    setNotice({ tone, msg });
    setTimeout(() => setNotice(null), 4000);
  };

  const flipPref = async (key: keyof Prefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      const { default: axiosInstance } = await import("@/api/axiosInstance");
      await axiosInstance.post("/auth/preferences", {
        ...next,
        // legacy mirrors so older readers keep working
        smsOrder: next.orderUpdates,
        whatsappAlerts: next.whatsapp,
        emailPromo: next.promo,
        emailNewsletter: next.email,
      });
    } catch {
      setPrefs(prefs);
      say("error", "Could not save that preference.");
    }
  };

  const changePassword = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (pw.next.length < 6) return say("error", "New password must be at least 6 characters.");
    if (pw.next !== pw.confirm) return say("error", "New passwords do not match.");
    setPwBusy(true);
    try {
      const { default: axiosInstance } = await import("@/api/axiosInstance");
      // Backend exposes reset-password by token; try a change-password route
      // first (future-proof), then fall back to reset request email.
      try {
        await axiosInstance.post("/auth/change-password", { currentPassword: pw.current, newPassword: pw.next });
        say("success", "Password changed successfully.");
      } catch (e: unknown) {
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          await axiosInstance.post("/auth/forgot-password", { identifier: displayEmail(user?.email) || user?.phone });
          say("info", "Password change needs email verification — we just sent you a reset link.");
        } else {
          throw e;
        }
      }
      setPw({ current: "", next: "", confirm: "" });
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string };
      say("error", err?.response?.data?.error?.message || err?.message || "Could not change password.");
    } finally {
      setPwBusy(false);
    }
  };

  const saveContact = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (contact.email && !isValidEmail(contact.email)) return say("error", "Enter a valid email address.");
    if (contact.phone && !isValidPhone(contact.phone)) return say("error", "Enter a valid 10-digit mobile number.");
    setContactBusy(true);
    try {
      const { default: axiosInstance } = await import("@/api/axiosInstance");
      await axiosInstance.put("/auth/profile", {
        email: contact.email || undefined,
        phone: contact.phone || undefined,
      });
      say("success", "Contact details updated.");
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string };
      say("error", err?.response?.data?.error?.message || err?.message || "Could not update contact details.");
    } finally {
      setContactBusy(false);
    }
  };

  const input = "w-full border border-gray-300 rounded-lg px-4 py-2.5 outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 transition-all text-sm";
  const label = "block text-gray-700 font-medium mb-1.5 text-sm";

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl md:text-3xl font-playfair font-bold text-deep-purple mb-1">Account Settings</h1>
        <p className="text-gray-500 text-sm">Personal info, security, notifications and privacy — all in one place.</p>
      </div>

      {notice && <Notice tone={notice.tone}>{notice.msg}</Notice>}

      {/* Migration nudge — logins now use the mobile number. */}
      {user && !user.phone && (
        <Notice tone="info">
          Logins now use your mobile number. Add it below under Contact Details so you can always sign back in.
        </Notice>
      )}

      {/* Personal information */}
      <section aria-label="Personal information">
        <h2 className="font-playfair font-bold text-deep-purple text-lg mb-1 flex items-center gap-2">
          <UserRound size={18} className="text-gold" /> Personal Information
        </h2>
        <p className="text-xs text-gray-500 mb-4">Name and photo live in <button onClick={() => router.push("/account")} className="font-bold text-gold hover:underline">Overview → Edit Profile</button>. Update contact details here.</p>
        <form onSubmit={saveContact} className="grid sm:grid-cols-2 gap-4 max-w-2xl" noValidate>
          <div>
            <label className={label} htmlFor="st-email">Email address</label>
            <input id="st-email" type="email" className={input} value={contact.email} onChange={(e) => setContact((p) => ({ ...p, email: e.target.value }))} placeholder="you@example.com" autoComplete="email" />
          </div>
          <div>
            <label className={label} htmlFor="st-phone">Phone number</label>
            <input id="st-phone" className={input} value={contact.phone} onChange={(e) => setContact((p) => ({ ...p, phone: e.target.value }))} placeholder="98765 43210" inputMode="tel" autoComplete="tel" />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={contactBusy} className="bg-deep-purple text-white px-6 py-2.5 rounded-lg font-bold hover:bg-deep-purple/90 text-sm disabled:opacity-50 flex items-center gap-2">
              {contactBusy && <Loader2 size={15} className="animate-spin" />} Save Contact Details
            </button>
          </div>
        </form>
      </section>

      <hr className="border-gray-100" />

      {/* Security */}
      <section aria-label="Security">
        <h2 className="font-playfair font-bold text-deep-purple text-lg mb-1 flex items-center gap-2">
          <Lock size={18} className="text-gold" /> Security
        </h2>
        <p className="text-xs text-gray-500 mb-4">Change your password. Active sessions stay on this device; use Logout below to sign out everywhere on shared devices.</p>
        <form onSubmit={changePassword} className="space-y-4 max-w-md" noValidate>
          <div>
            <label className={label} htmlFor="st-cur">Current password</label>
            <div className="relative">
              <input id="st-cur" type={showPw ? "text" : "password"} required className={`${input} pr-11`} value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} placeholder="••••••••" autoComplete="current-password" />
              <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-deep-purple" aria-label={showPw ? "Hide passwords" : "Show passwords"}>
                {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="st-new">New password</label>
            <input id="st-new" type={showPw ? "text" : "password"} required minLength={6} className={input} value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} placeholder="Min. 6 characters" autoComplete="new-password" />
          </div>
          <div>
            <label className={label} htmlFor="st-conf">Confirm new password</label>
            <input id="st-conf" type={showPw ? "text" : "password"} required className={input} value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} placeholder="Repeat new password" autoComplete="new-password" />
          </div>
          <button type="submit" disabled={pwBusy} className="bg-deep-purple text-white px-6 py-2.5 rounded-lg font-bold hover:bg-deep-purple/90 text-sm disabled:opacity-50 flex items-center gap-2">
            {pwBusy && <Loader2 size={15} className="animate-spin" />} Change Password
          </button>
        </form>

        <div className="mt-5 max-w-md bg-ivory/50 border border-gray-100 rounded-xl px-4 py-3.5 text-xs text-gray-600 flex items-start gap-2.5">
          <ShieldCheck size={16} className="text-sage shrink-0 mt-0.5" />
          <p>Signed in as <span className="font-bold text-deep-purple">{displayEmail(user?.email) || user?.phone || "you"}</span>. If this isn&apos;t you, change your password and log out immediately.</p>
        </div>
      </section>

      <hr className="border-gray-100" />

      {/* Notifications */}
      <section aria-label="Notifications">
        <h2 className="font-playfair font-bold text-deep-purple text-lg mb-1 flex items-center gap-2">
          <Bell size={18} className="text-gold" /> Notifications
        </h2>
        <p className="text-xs text-gray-500 mb-4">Choose what we may send you, and where. Transactional order SMS can&apos;t be fully disabled for active orders.</p>
        {!prefsLoaded ? (
          <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading preferences…</p>
        ) : (
          <div className="space-y-4 max-w-xl divide-y divide-gray-50">
            <Toggle on={prefs.orderUpdates} onFlip={() => flipPref("orderUpdates")} label="Order updates" blurb="Placed, confirmed, shipped and delivered alerts." />
            <Toggle on={prefs.deliveryUpdates} onFlip={() => flipPref("deliveryUpdates")} label="Delivery updates" blurb="Out-for-delivery and delay notices." />
            <Toggle on={prefs.promo} onFlip={() => flipPref("promo")} label="Promotional notifications" blurb="Offers, launches and festive sales." />
            <Toggle on={prefs.email} onFlip={() => flipPref("email")} label="Email notifications" blurb="Order mail, invoices and the Ayurvedic journal." />
            <Toggle on={prefs.whatsapp} onFlip={() => flipPref("whatsapp")} label="WhatsApp / SMS notifications" blurb="Tracking and support messages on your phone." />
          </div>
        )}
      </section>

      <hr className="border-gray-100" />

      {/* Privacy */}
      <section aria-label="Privacy">
        <h2 className="font-playfair font-bold text-deep-purple text-lg mb-1 flex items-center gap-2">
          <ShieldCheck size={18} className="text-gold" /> Privacy & Sessions
        </h2>
        <p className="text-xs text-gray-500 mb-4">We only use your details for orders, support and the alerts you opted into. Only you can access this account&apos;s data.</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setConfirmLogout(true)} className="flex items-center gap-2 px-5 py-2.5 border border-gray-200 hover:bg-gray-50 rounded-lg text-xs font-bold text-gray-700">
            <LogOut size={14} /> Log out this device
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmLogout}
        title="Log out?"
        message="You will need your phone/email to sign back in."
        confirmLabel="Log Out"
        onConfirm={() => {
          logout();
          router.push("/");
        }}
        onClose={() => setConfirmLogout(false)}
      />
    </div>
  );
}
