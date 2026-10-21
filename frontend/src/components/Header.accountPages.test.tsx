import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

/**
 * The account icon in the header.
 *
 * The icon is ALWAYS visible (even for a visitor with no session) and points
 * at /account - the restored account section. There is never a login or sign
 * up link in the header, and "Track order" is not in the navbar either.
 */

const mockCart = { cartCount: 0 };
const authState: any = {
  user: null,
  isAuthenticated: false,
  hasSession: false,
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

function resetAuth() {
  authState.user = null;
  authState.isAuthenticated = false;
  authState.hasSession = false;
  authState.customerSession = null;
}

describe("the header for a visitor with no session", () => {
  beforeEach(() => {
    cleanup();
    resetAuth();
  });
  afterEach(cleanup);

  it("shows the profile icon pointing at /account and no login links", () => {
    renderHeader(false);

    // The profile icon is always visible and leads to the account section.
    const profile = screen.queryByLabelText("My Profile");
    expect(profile).not.toBeNull();
    expect(profile?.getAttribute("href")).toBe("/account");

    const texts = linkTexts();
    expect(texts).not.toContain("My Orders");
    expect(texts).not.toContain("Login");
    expect(texts).not.toContain("Sign up");
    expect(texts.some((t) => /my account/i.test(t))).toBe(false);
  });

  it("still offers the cart and a way to track an order", () => {
    renderHeader(false);

    const texts = linkTexts();
    expect(texts.some((t) => /track order/i.test(t))).toBe(false);
    // The cart is still there - a guest still shops.
    expect(document.querySelector('a[href="/checkout"]')).not.toBeNull();
  });

  it("shows no login link either - there is nothing to log into", () => {
    renderHeader(false);
    expect(document.querySelector('a[href="/login"]')).toBeNull();
    expect(document.querySelector('a[href="/signup"]')).toBeNull();
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

    fireEvent.click(screen.getByLabelText("Toggle Navigation Menu"));
    const texts = linkTexts();
    expect(texts).toContain("My Profile");
    expect(texts).toContain("My Orders");
  });

  it("never shows a login link", () => {
    renderHeader(false);
    expect(document.querySelector('a[href="/login"]')).toBeNull();
  });
});

describe("the header when the account pages are switched on", () => {
  beforeEach(() => {
    cleanup();
    resetAuth();
  });
  afterEach(cleanup);

  it("keeps the profile icon on /account for a visitor with no session", () => {
    renderHeader(true);

    const profile = screen.queryByLabelText("My Profile");
    expect(profile).not.toBeNull();
    expect(profile?.getAttribute("href")).toBe("/account");
    expect(document.querySelector('a[href="/login"]')).toBeNull();
  });

  it("keeps the track order link out of the navbar", () => {
    renderHeader(true);
    expect(linkTexts().some((t) => /track order/i.test(t))).toBe(false);
  });
});
