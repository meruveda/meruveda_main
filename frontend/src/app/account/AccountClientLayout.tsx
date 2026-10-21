"use client";

import { useAuth } from "@/context/AuthContext";
import { displayEmail } from "@/types/account";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  User,
  Package,
  Truck,
  Star,
  Heart,
  MapPin,
  CreditCard,
  Settings,
  LogOut,
  Loader2,
  ChevronDown,
  LifeBuoy,
} from "lucide-react";

const MENU = [
  { name: "Overview", href: "/account", icon: LayoutDashboard, exact: true },
  { name: "My Profile", href: "/account/profile", icon: User },
  { name: "My Orders", href: "/account/orders", icon: Package },
  { name: "Track Orders", href: "/account/track", icon: Truck },
  { name: "Reviews & Feedback", href: "/account/reviews", icon: Star },
  { name: "Wishlist", href: "/account/wishlist", icon: Heart },
  { name: "Addresses", href: "/account/addresses", icon: MapPin },
  { name: "Payment Methods", href: "/account/payment-methods", icon: CreditCard },
  { name: "Help & Support", href: "/account/support", icon: LifeBuoy },
  { name: "Account Settings", href: "/account/settings", icon: Settings },
];

/**
 * The guard against a redirect loop.
 *
 * The account pages send a visitor who is not signed in to /login. If the
 * session is in a state where the login page sends them straight back (for
 * example a guest checkout session, which has a user but is not a real
 * account), the browser bounces between the two pages.
 *
 * Every redirect is therefore counted, per target, in a short window. Once the
 * limit is reached the page stops redirecting and asks the visitor to sign in,
 * so the loop is always broken.
 */
const REDIRECT_KEY = "mv_auth_redirects";
const REDIRECT_LIMIT = 2;
const REDIRECT_WINDOW_MS = 10000;

function countRedirect(path: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem(REDIRECT_KEY);
    const now = Date.now();
    const state = raw ? (JSON.parse(raw) as { path: string; count: number; at: number }) : null;
    if (!state || state.path !== path || now - state.at > REDIRECT_WINDOW_MS) {
      window.sessionStorage.setItem(REDIRECT_KEY, JSON.stringify({ path, count: 1, at: now }));
      return 1;
    }
    const count = state.count + 1;
    window.sessionStorage.setItem(REDIRECT_KEY, JSON.stringify({ path, count, at: now }));
    return count;
  } catch {
    return 1;
  }
}

function clearRedirects() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(REDIRECT_KEY);
  } catch {
    /* ignore */
  }
}

export default function AccountClientLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, hasSession, isLoading, logout, closeSession } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [redirectBlocked, setRedirectBlocked] = useState(false);

  /**
   * The customer has a session (the profile created at the checkout) or is
   * signed in: the area is open.
   *
   * Without one there is nothing to show - and no /login to send them to,
   * because the account pages are switched off. The server already sent them
   * to the shop; this is the belt-and-braces guard that stops any loop.
   */
  const allowed = hasSession || isAuthenticated;

  useEffect(() => {
    if (isLoading || allowed) {
      // A session: the counter is not needed any more.
      if (allowed) clearRedirects();
      return;
    }
    if (countRedirect(pathname) > REDIRECT_LIMIT) {
      // The loop is broken: stay here and explain.
      setRedirectBlocked(true);
      return;
    }
    router.push(`/?profile=required`);
  }, [isLoading, allowed, router, pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (isLoading || (!user && !hasSession)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ivory">
        <div className="text-center">
          <Loader2 size={40} className="animate-spin text-gold mx-auto mb-4" />
          <p className="text-deep-purple font-medium font-playfair">Loading your account…</p>
        </div>
      </div>
    );
  }

  /**
   * The redirect guard stopped the loop. The visitor has no session, so the
   * page says so plainly and offers the way in - instead of bouncing forever.
   */
  if (redirectBlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ivory px-6">
        <div className="card max-w-md w-full p-8 text-center">
          <h1 className="font-playfair font-bold text-deep-purple text-2xl mb-3">
            Place an order to create your profile
          </h1>
          <p className="text-gray-600 mb-6">
            Your profile is created automatically when you check out - your name, your mobile
            number and your email address. Place an order and your order history will be
            waiting for you here.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/products" className="btn btn-primary inline-flex items-center justify-center">
              Continue shopping
            </Link>
            <button
              type="button"
              onClick={() => {
                clearRedirects();
                setRedirectBlocked(false);
                router.refresh();
              }}
              className="btn btn-outline inline-flex items-center justify-center"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    // Nested order-detail pages keep "My Orders" highlighted.
    return pathname === href || pathname.startsWith(href + "/");
  };

  const activeItem = [...MENU].reverse().find((m) => isActive(m.href, (m as { exact?: boolean }).exact)) || MENU[0];

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 md:py-14 max-w-6xl">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 md:gap-8">
        {/* Sidebar — desktop */}
        <aside className="hidden lg:block lg:col-span-1 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm h-fit sticky top-24">
          <div className="flex items-center gap-4 pb-6 border-b border-gray-100 mb-6">
            {user?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user?.avatar} alt={user?.firstName} className="w-14 h-14 rounded-full object-cover border-2 border-gold/40" />
            ) : (
              <div className="w-14 h-14 rounded-full bg-gold flex items-center justify-center text-deep-purple text-lg font-bold shrink-0">
                {(user?.firstName?.[0] || "U").toUpperCase()}{(user?.lastName?.[0] || "").toUpperCase()}
              </div>
            )}
            <div className="truncate">
              <h2 className="font-playfair font-bold text-deep-purple text-lg leading-tight truncate">
                {user?.firstName} {user?.lastName}
              </h2>
              <p className="text-xs text-gray-500 truncate">{displayEmail(user?.email) || user?.phone}</p>
            </div>
          </div>

          <nav className="space-y-1" aria-label="Account sections">
            {MENU.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href, (item as { exact?: boolean }).exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    active ? "bg-deep-purple text-white shadow-sm" : "text-gray-600 hover:bg-ivory hover:text-deep-purple"
                  }`}
                >
                  <Icon size={17} className={active ? "text-gold" : "text-gray-400"} />
                  {item.name}
                </Link>
              );
            })}
            <button
              onClick={() => {
                logout();
                router.push("/");
              }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold text-red-500 hover:bg-red-50 w-full transition-all text-left mt-4 border-t border-gray-100 pt-4"
            >
              <LogOut size={17} className="text-red-400" />
              Logout
            </button>
          </nav>
        </aside>

        {/* Mobile nav — dropdown + horizontal chips, no overflow */}
        <div className="lg:hidden">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-3 mb-4">
            <button
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-ivory/70 text-deep-purple font-bold text-sm"
            >
              <span className="flex items-center gap-2.5">
                <activeItem.icon size={17} className="text-gold" />
                {activeItem.name}
              </span>
              <ChevronDown size={17} className={`transition-transform ${mobileOpen ? "rotate-180" : ""}`} />
            </button>
            {mobileOpen && (
              <nav className="grid grid-cols-1 gap-1 mt-2 max-h-[50vh] overflow-y-auto" aria-label="Account sections">
                {MENU.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href, (item as { exact?: boolean }).exact);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold ${
                        active ? "bg-deep-purple text-white" : "text-gray-600 hover:bg-ivory"
                      }`}
                    >
                      <Icon size={16} className={active ? "text-gold" : "text-gray-400"} />
                      {item.name}
                    </Link>
                  );
                })}
                <button
                  onClick={() => {
                    logout();
                    router.push("/");
                  }}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-red-500 hover:bg-red-50 text-left"
                >
                  <LogOut size={16} /> Logout
                </button>
              </nav>
            )}
          </div>
        </div>

        {/* Content */}
        <main className="lg:col-span-3 min-w-0">
          <div className="bg-white p-5 sm:p-6 md:p-8 rounded-2xl border border-gray-100 shadow-sm min-h-[50vh]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
