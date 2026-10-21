import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

/* ------------------------------------------------------------------ */
/* Mocks — the checkout page's only outward dependencies.               */
/* ------------------------------------------------------------------ */

const cartItem = {
  id: "p1",
  name: "Joint Pain Oil",
  price: 499,
  quantity: 2,
  slug: "joint-pain-oil",
  image: "/x.png",
};

const mockCart = {
  cart: [cartItem],
  cartTotal: 998,
  removeFromCart: vi.fn(),
  updateQuantity: vi.fn(),
};

const authState: any = {
  user: null,
  isAuthenticated: false,
  /** A checkout-only guest session is NOT an account. */
  isGuestSession: false,
  isLoading: false,
  saveProfile: vi.fn(),
  /** The checkout opens the customer session (the profile) on Continue. */
  openSession: vi.fn(async (name: string, phone: string, email: string) => ({
    name,
    phone,
    email,
    phoneVerified: false,
  })),
};

vi.mock("@/context/CartContext", () => ({ useCart: () => mockCart }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/api/axiosInstance", () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import CheckoutPage from "@/app/checkout/page";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Fill name + number so Continue's own validation passes. */
function fillContact(name = "Atharva Bhargava", mobile = "9876543210") {
  const inputs = document.querySelectorAll('input[type="text"], input[type="tel"]');
  const nameInput = Array.from(inputs).find(
    (i) => (i as HTMLInputElement).placeholder === "Enter your full name"
  ) as HTMLInputElement;
  const mobileInput = document.getElementById("checkout-mobile") as HTMLInputElement;

  fireEvent.change(nameInput, { target: { value: name } });
  fireEvent.change(mobileInput, { target: { value: mobile } });
}

/**
 * The email of the CONTACT step.
 *
 * The profile is created from it when the customer presses "Continue", so it
 * is part of the contact step and not only of the address step.
 */
function fillContactEmail(email = "atharva@example.com") {
  const field = document.getElementById("checkout-contact-email") as HTMLInputElement | null;
  if (field) fireEvent.change(field, { target: { value: email } });
}

/** Fill a complete delivery address so `addressValid` is true. */
function fillAddress() {
  const set = (placeholder: string, value: string) => {
    const el = Array.from(document.querySelectorAll("input")).find(
      (i) => (i as HTMLInputElement).placeholder === placeholder
    ) as HTMLInputElement | undefined;
    if (el) fireEvent.change(el, { target: { value } });
  };
  set("e.g. House No. 12, Flat 301", "12");
  set("e.g. MG Road, Lane 2", "Mahalgaon");
  set("Enter your city", "Gwalior");
  set("Enter 6-digit PIN code", "474011");

  // The state picker is a searchable combobox, not a native <select>.
  const stateBox = screen.getByLabelText("State / Union Territory") as HTMLInputElement;
  fireEvent.focus(stateBox);
  fireEvent.change(stateBox, { target: { value: "Madhya Pradesh" } });
  fireEvent.keyDown(stateBox, { key: "Enter" });

  // There are two email fields now: the one in the CONTACT step (the profile)
  // and the one in the delivery step. Both are filled.
  const emails = Array.from(document.querySelectorAll('input[type="email"]')) as HTMLInputElement[];
  for (const email of emails) {
    fireEvent.change(email, { target: { value: "atharva@example.com" } });
  }
}

const placeOrderButton = () =>
  screen.getByRole("button", { name: /Place Order|Pay Now|Complete address|Enter a valid email|Processing/i });

/* ------------------------------------------------------------------ */

beforeEach(() => {
  window.localStorage.clear();
  authState.user = null;
  authState.isAuthenticated = false;
  authState.isLoading = false;
  authState.saveProfile = vi.fn().mockResolvedValue(undefined);
  /** A fresh success mock every test - a rejecting one must not leak. */
  authState.openSession = vi.fn(async (name: string, phone: string, email: string) => ({
    name,
    phone,
    email,
    phoneVerified: false,
  }));
});

afterEach(() => cleanup());

describe("checkout — identity is the Continue pill, never a login form or an OTP", () => {
  it("shows Continue and no Sign up / Login / OTP anywhere", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));

    expect(screen.getByRole("button", { name: /^Continue$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Sign up$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Send OTP/i })).toBeNull();
    expect(screen.queryByPlaceholderText("Enter 6-digit OTP")).toBeNull();
    expect(screen.queryByText(/Login to continue/i)).toBeNull();
    expect(screen.queryByText(/Create an account/i)).toBeNull();
  });

  it("shows the full form (name, number, address, email) on a guest's first order", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByPlaceholderText("Enter your full name"));

    expect(screen.getByPlaceholderText("Enter your full name")).toBeTruthy();
    expect(document.getElementById("checkout-mobile")).toBeTruthy();
    expect(document.getElementById("checkout-address")).toBeTruthy();
    expect(document.getElementById("checkout-email")).toBeTruthy();
    expect(document.querySelector('input[type="email"]')).toBeTruthy();
  });

  it("keeps Place Order disabled until Continue is pressed", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));

    fillContact();
    fillContactEmail();
    fillAddress();
    const button = placeOrderButton() as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(screen.queryByRole("button", { name: /Processing/i })).toBeNull();
  });

  it("Continue opens the session and unlocks Place Order", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));
    fillContact();
    fillContactEmail();
    fillAddress();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() =>
      expect(authState.openSession).toHaveBeenCalledWith(
        "Atharva Bhargava",
        "919876543210",
        "atharva@example.com",
        expect.objectContaining({ website: "" })
      )
    );

    const button = placeOrderButton() as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(button.textContent || "").toMatch(/Place Order|Pay Now/);
    expect(screen.getByText(/Contact confirmed/i)).toBeTruthy();
  });

  it("keeps Place Order locked when Continue fails and shows a friendly message", async () => {
    // A transport failure (no response) must never surface axios' raw
    // "Network Error" - the customer sees the friendly connect message.
    authState.openSession = vi.fn().mockRejectedValue(new Error("Network Error"));
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));
    fillContact();
    fillContactEmail();
    fillAddress();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => screen.getByText(/check your internet and try again/i));
    expect((placeOrderButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("editing the name after Continue re-locks the contact", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));
    fillContact();
    fillContactEmail();
    fillAddress();
    const pill = screen.getByRole("button", { name: /Continue|Contact confirmed/i });
    fireEvent.click(pill);
    await waitFor(() => expect(pill.getAttribute("data-contact-confirmed")).toBe("yes"));

    const nameInput = Array.from(document.querySelectorAll('input[type="text"]')).find(
      (i) => (i as HTMLInputElement).placeholder === "Enter your full name"
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Atharva B" } });

    await waitFor(() => expect(pill.getAttribute("data-contact-confirmed")).toBe("no"));
  });

  it("a valid existing session still shows no OTP", async () => {
    authState.user = { id: "u1", firstName: "Atharva", lastName: "Bhargava", phone: "9876543210", email: "a@b.com" };
    authState.isAuthenticated = true;

    render(<CheckoutPage />);
    // A signed-in session whose number matches is confirmed automatically, so
    // the pill reads "Contact confirmed" - there is still no OTP anywhere.
    await waitFor(() => screen.getByText(/Contact confirmed/i));

    expect(screen.queryByRole("button", { name: /Send OTP/i })).toBeNull();
    expect(screen.queryByPlaceholderText("Enter 6-digit OTP")).toBeNull();
    // The name is prefilled from the session.
    expect((screen.getByPlaceholderText("Enter your full name") as HTMLInputElement).value).toBe("Atharva Bhargava");
  });

  it("never asks for an OTP, even after a delay (the config cannot flip it)", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));

    // Give any late config fetch time to run — nothing may appear.
    await new Promise((r) => setTimeout(r, 150));

    expect(screen.queryByRole("button", { name: /Send OTP/i })).toBeNull();
    expect(screen.queryByPlaceholderText("Enter 6-digit OTP")).toBeNull();
    expect(screen.queryByRole("button", { name: /Verify OTP/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Resend OTP/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^Continue$/i })).toBeTruthy();
  });
});
