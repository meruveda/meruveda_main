import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

/**
 * The profile icon in the header.
 *
 * It is ALWAYS there - for a visitor with no session, for the profile created
 * at the checkout and for a real sign-in - and it opens /account, where a
 * visitor without a session is told how a profile is created. There is no
 * /login and no /signup anywhere. "Track order" is not part of the navbar
 * any more: it lives in the footer, on the order success page and in the
 * order history.
 */

const mockCart = { cartCount: 0 };
const authState: any = {
  user: null,
  isAuthenticated: false,
  hasSession: false,
  sessionChecked: true,
  customerSession: null,
  logout: vi.fn(),
  closeSession: vi.fn(),
};

vi.mock("@/context/CartContext", () => ({ useCart: () => mockCart }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import Header from "@/components/Header";
import { StoreConfigProvider } from "@/context/StoreConfigContext";

function renderHeader(accountPages: boolean) {
  return render(
    <StoreConfigProvider accountPages={accountPages}>
      <Header />
    </StoreConfigProvider>,
  );
}

/** Every link in the header, by its text. */
function linkTexts(): string[] {
  return Array.from(document.querySelectorAll("a")).map((a) => (a.textContent || "").trim());
}

function openMobileMenu() {
  fireEvent.click(screen.getByLabelText("Toggle Navigation Menu"));
}

function resetAuth() {
  authState.user = null;
  authState.isAuthenticated = false;
  authState.hasSession = false;
  authState.sessionChecked = true;
  authState.customerSession = null;
}

describe("the header for a visitor with no session", () => {
  beforeEach(() => {
    cleanup();
    resetAuth();
  });
  afterEach(cleanup);

  it("shows the profile icon for every visitor, opening the profile area", () => {
    renderHeader(false);

    const profile = screen.queryByLabelText("My Profile");
    expect(profile).not.toBeNull();
    expect(profile?.getAttribute("href")).toBe("/account");
  });

  it("keeps the profile icon in the mobile menu too", () => {
    renderHeader(false);

    openMobileMenu();
    expect(linkTexts()).toContain("My Profile");
  });

  it("keeps the cart - a guest still shops", () => {
    renderHeader(false);
    expect(document.querySelector('a[href="/checkout"]')).not.toBeNull();
  });

  it("shows no login link - there is nothing to log into", () => {
    renderHeader(false);
    expect(document.querySelector('a[href="/login"]')).toBeNull();
    expect(document.querySelector('a[href="/signup"]')).toBeNull();
    expect(linkTexts()).not.toContain("Login");
    expect(linkTexts()).not.toContain("Sign up");
  });

  it("has no 'Track order' in the navbar at all", () => {
    renderHeader(false);

    expect(linkTexts().some((t) => /track order/i.test(t))).toBe(false);

    openMobileMenu();
    expect(linkTexts().some((t) => /track order/i.test(t))).toBe(false);
  });
});

describe("the header for a customer with a session", () => {
  beforeEach(() => {
    cleanup();
    resetAuth();
    authState.hasSession = true;
    authState.customerSession = {
      name: "Test Customer",
      phone: "919876543210",
      email: "test@example.com",
      phoneVerified: false,
    };
    authState.user = {
      id: "s1",
      email: "test@example.com",
      firstName: "Test",
      lastName: "Customer",
      role: "customer",
      phone: "919876543210",
      scope: "customer",
    };
  });
  afterEach(cleanup);

  it("shows the account area with the profile and the orders", () => {
    renderHeader(false);

    const profile = screen.queryByLabelText("My Profile");
    expect(profile).not.toBeNull();
    expect(profile?.getAttribute("href")).toBe("/account");

    openMobileMenu();
    const texts = linkTexts();
    expect(texts).toContain("My Profile");
    expect(texts).toContain("My Orders");
  });

  it("never shows a login link and never 'Track order'", () => {
    renderHeader(false);
    expect(document.querySelector('a[href="/login"]')).toBeNull();
    expect(linkTexts().some((t) => /track order/i.test(t))).toBe(false);
  });
});

describe("the header when the account pages are switched on", () => {
  beforeEach(() => {
    cleanup();
    resetAuth();
  });
  afterEach(cleanup);

  it("still opens the profile area, never the login page", () => {
    renderHeader(true);

    const profile = screen.queryByLabelText("My Profile");
    expect(profile).not.toBeNull();
    expect(profile?.getAttribute("href")).toBe("/account");
    expect(document.querySelector('a[href="/login"]')).toBeNull();
  });

  it("keeps 'Track order' out of the navbar", () => {
    renderHeader(true);
    expect(linkTexts().some((t) => /track order/i.test(t))).toBe(false);
  });
});
