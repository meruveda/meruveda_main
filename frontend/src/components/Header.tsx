"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingCart, User, ChevronDown, Package, Star, MessageSquare, Heart, Settings, LogOut, Menu, X } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { displayEmail } from "@/types/account";
import { useState, useRef, useEffect } from "react";

export default function Header() {
  const { cartCount } = useCart();
  const { user, isAuthenticated, logout } = useAuth();
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
    logout();
    setDropdownOpen(false);
    router.push("/");
  };

  return (
    <header className="bg-plum-deep border-b border-gold/15 px-6 py-1.5 md:py-2 flex justify-between items-center z-50 sticky top-0 print:hidden">
      <Link href="/" className="flex items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo_transparent.svg"
          alt="MERUVEDA WELLNESS"
          className="h-9 md:h-12 w-auto object-contain"
        />
      </Link>

      {/* Nav */}
      <nav className="hidden md:flex items-center gap-8 text-[15px] font-medium text-bg-ivory/80">
        <Link href="/" className="hover:text-gold-antique transition-colors">Home</Link>
        <Link href="/products" className="hover:text-gold-antique transition-colors">Shop</Link>
        <Link href="/about" className="hover:text-gold-antique transition-colors">About Us</Link>
        <Link href="/blog" className="hover:text-gold-antique transition-colors">Journal</Link>
        <Link href="/contact" className="hover:text-gold-antique transition-colors">Contact</Link>
      </nav>

      {/* Right Actions */}
      <div className="flex items-center gap-4">
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

        {/* Auth Area — always visible right next to the cart */}
        {isAuthenticated && user ? (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2 text-bg-ivory hover:text-gold-antique transition-colors"
              aria-haspopup="true"
              aria-expanded={dropdownOpen}
            >
              {user.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar}
                  alt={user.firstName}
                  className="w-7 h-7 rounded-full object-cover border border-gold/40"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gold flex items-center justify-center text-plum-deep text-xs font-bold">
                  {user.firstName?.[0] || 'U'}{user.lastName?.[0] || ''}
                </div>
              )}
              <span className="hidden md:inline text-sm font-semibold">{user.firstName || 'User'}</span>
              <ChevronDown size={14} className={`transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Dropdown */}
            {dropdownOpen && (
              <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50 animate-in fade-in slide-in-from-top-2">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="font-bold text-plum-deep text-sm">{user.firstName} {user.lastName}</p>
                  <p className="text-xs text-gray-500 truncate">{displayEmail(user.email) || user.phone}</p>
                </div>
                <Link
                  href="/login"
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
                  href="/account/reviews"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-bg-ivory hover:text-plum-deep transition-colors"
                >
                  <Star size={15} /> My Reviews
                </Link>
                <Link
                  href="/account/support"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-bg-ivory hover:text-plum-deep transition-colors"
                >
                  <MessageSquare size={15} /> Help & Support
                </Link>
                {user.role === 'admin' ? (
                  <a
                    href={process.env.NEXT_PUBLIC_ADMIN_URL || "/admin"}
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-bg-ivory hover:text-plum-deep transition-colors"
                  >
                    <Settings size={15} /> Admin Dashboard
                  </a>
                ) : (
                  <Link
                    href="/account/settings"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-bg-ivory hover:text-plum-deep transition-colors"
                  >
                    <Settings size={15} /> Settings
                  </Link>
                )}
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
          /* Guest — profile icon sits next to cart and opens the login page. */
          <Link
            href="/login"
            aria-label="My Profile"
            title="My Profile"
            className="flex items-center text-bg-ivory hover:text-gold-antique transition-colors"
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
            <Link
              href="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-gold-antique transition-colors pb-2 border-b border-gold/10"
            >
              My Profile
            </Link>
            <Link
              href="/account/orders"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-gold-antique transition-colors pb-2 border-b border-gold/10"
            >
              My Orders
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
