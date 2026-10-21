"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingCart, User, ChevronDown, Package, Star, MessageSquare, Heart, Settings, LogOut, Menu, X, MapPin, LayoutDashboard } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useAccountPages } from "@/context/StoreConfigContext";
import { displayEmail } from "@/types/account";
import { useState, useRef, useEffect } from "react";

export default function Header() {
  const { cartCount } = useCart();
  const { user, isAuthenticated, hasSession, logout, closeSession } = useAuth();
  /**
   * Are the storefront account pages switched on?
   *
   * While they are off there is no /login and no /signup. The profile icon is
   * shown to EVERY visitor - it opens /account, where the checkout-created
   * profile lives. "Track order" is not part of the navbar any more: it is in
   * the footer, on the order success page and in the order history.
   */
  const accountPages = useAccountPages();
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    // A checkout session is closed with the session endpoint; a real login
    // with the normal logout. The orders stay in the database either way.
    if (hasSession) {
      void closeSession();
    } else {
      logout();
    }
    setDropdownOpen(false);
    router.push("/");
  };

  // Full name for the navbar chip — truncated with a tooltip when it is long.
  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "User";

  return (
    <header className="bg-plum-deep border-b border-gold/15 px-6 py-1.5 md:py-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 z-50 sticky top-0 print:hidden">
      <Link href="/" className="flex items-center justify-self-start">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo_transparent.svg"
          alt="MERUVEDA WELLNESS"
          className="h-9 md:h-12 w-auto object-contain"
        />
      </Link>

      {/* Nav */}
      <nav className="hidden md:flex items-center justify-self-center gap-8 text-[15px] font-medium text-bg-ivory/80">
        <Link href="/" className="hover:text-gold-antique transition-colors">Home</Link>
        <Link href="/products" className="hover:text-gold-antique transition-colors">Shop</Link>
        <Link href="/about" className="hover:text-gold-antique transition-colors">About Us</Link>
        <Link href="/blog" className="hover:text-gold-antique transition-colors">Journal</Link>
        <Link href="/contact" className="hover:text-gold-antique transition-colors">Contact</Link>
      </nav>

      {/* Right Actions */}
      <div className="flex items-center justify-self-end gap-4 min-w-0">
        {/* Shop Now — compact pill sitting right beside the cart */}
        <Link
          href="/products"
          className="shrink-0 whitespace-nowrap rounded-full border border-gold/45 bg-gold px-2.5 py-1 text-[11px] font-bold tracking-wide text-plum-deep hover:bg-gold-light transition-colors sm:px-4 sm:py-1.5 sm:text-xs"
        >
          Shop Now
        </Link>

        {/* Cart — opens checkout directly (there is no separate cart page) */}
        <Link
          href="/checkout"
          className="flex items-center gap-2 text-bg-ivory hover:text-gold-antique transition-colors"
        >
          <ShoppingCart size={20} strokeWidth={1.5} />
          <span className="text-sm font-medium font-ibm-plex-mono">{cartCount}</span>
        </Link>

        {/**
         * The profile icon - ALWAYS visible, for every visitor, sitting right
         * beside the cart. It opens /account: the profile area that the
         * checkout creates automatically.
         *
         * A visitor with no session gets the plain icon and an empty state
         * that explains how a profile is created; there is no /login to send
         * them to. With a session (or a sign-in, while the account pages are
         * on) the icon carries the name and opens the dropdown menu.
         */}
        {(hasSession || (accountPages && isAuthenticated && user)) ? (
          <div className="relative shrink-0" ref={dropdownRef}>
            {/**
             * The account icon opens the profile area. It is a LINK (not a
             * button) so it works without JavaScript and so it can be reached
             * with the keyboard; the chevron next to it opens the menu.
             */}
            <Link
              href="/account"
              onClick={() => setDropdownOpen(false)}
              className="flex shrink-0 items-center gap-2 text-bg-ivory hover:text-gold-antique transition-colors"
              aria-label="My Profile"
            >
              {user?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar}
                  alt={user.firstName}
                  className="w-7 h-7 shrink-0 rounded-full object-cover border border-gold/40"
                />
              ) : (
                <div className="w-7 h-7 shrink-0 rounded-full bg-gold flex items-center justify-center text-plum-deep text-xs font-bold">
                  {(user?.firstName?.[0] || fullName?.[0] || 'U').toUpperCase()}
                  {(user?.lastName?.[0] || '').toUpperCase()}
                </div>
              )}
              <span
                className="hidden lg:inline text-sm font-semibold max-w-[120px] truncate"
                title={fullName}
              >
                {fullName}
              </span>
            </Link>
            <button
              onClick={() => setDropdownOpen((prev) => !prev)}
              className="flex shrink-0 items-center text-bg-ivory hover:text-gold-antique transition-colors -ml-1"
              aria-haspopup="true"
              aria-expanded={dropdownOpen}
              aria-label="Account menu"
            >
              <ChevronDown size={14} className={`transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Dropdown */}
            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50 animate-in fade-in slide-in-from-top-2">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="font-bold text-plum-deep text-sm">{fullName}</p>
                  <p className="text-xs text-gray-500 truncate">{displayEmail(user?.email) || user?.phone}</p>
                </div>
                <Link
                  href="/account"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-bg-ivory hover:text-plum-deep transition-colors"
                >
                  <LayoutDashboard size={15} /> Dashboard
                </Link>
                <Link
                  href="/account/profile"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-bg-ivory hover:text-plum-deep transition-colors"
                >
                  <User size={15} /> My Profile
                </Link>
                <Link
                  href="/account/orders"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-bg-ivory hover:text-plum-deep transition-colors"
                >
                  <Package size={15} /> My Orders
                </Link>
                <Link
                  href="/account/addresses"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-bg-ivory hover:text-plum-deep transition-colors"
                >
                  <MapPin size={15} /> Addresses
                </Link>
                {user?.role === 'admin' ? (
                  <a
                    href={process.env.NEXT_PUBLIC_ADMIN_URL || "/admin"}
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-bg-ivory hover:text-plum-deep transition-colors"
                  >
                    <Settings size={15} /> Admin Dashboard
                  </a>
                ) : null}
                <div className="border-t border-gray-100 mt-1 pt-1">
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 w-full transition-colors"
                  >
                    <LogOut size={15} /> Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Link
            href="/account"
            aria-label="My Profile"
            title="My Profile"
            className="flex shrink-0 items-center text-bg-ivory hover:text-gold-antique transition-colors"
          >
            <User size={20} strokeWidth={1.5} />
          </Link>
        )}

        {/* Mobile Menu Toggle Button */}
        <button
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          className="md:hidden text-bg-ivory hover:text-gold-antique transition-colors p-1"
          aria-label="Toggle Navigation Menu"
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed top-[53px] left-0 right-0 bottom-0 bg-plum-deep/95 backdrop-blur-md z-40 flex flex-col p-6 gap-6 animate-in fade-in slide-in-from-top-5 duration-200">
          <nav className="flex flex-col gap-6 text-lg font-medium text-bg-ivory/90">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-gold-antique transition-colors pb-2 border-b border-gold/10"
            >
              Home
            </Link>
            <Link
              href="/products"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-gold-antique transition-colors pb-2 border-b border-gold/10"
            >
              Shop
            </Link>
            <Link
              href="/about"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-gold-antique transition-colors pb-2 border-b border-gold/10"
            >
              About Us
            </Link>
            <Link
              href="/blog"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-gold-antique transition-colors pb-2 border-b border-gold/10"
            >
              Journal
            </Link>
            <Link
              href="/contact"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-gold-antique transition-colors pb-2 border-b border-gold/10"
            >
              Contact
            </Link>
            {/* The profile is always there: it opens /account. A visitor
                without a session sees how one is created. */}
            <Link
              href="/account"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-gold-antique transition-colors pb-2 border-b border-gold/10"
            >
              My Profile
            </Link>
            {/* The orders exist only when there is something to show. */}
            {(hasSession || (accountPages && isAuthenticated)) && (
              <Link
                href="/account/orders"
                onClick={() => setMobileMenuOpen(false)}
                className="hover:text-gold-antique transition-colors pb-2 border-b border-gold/10"
              >
                My Orders
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
