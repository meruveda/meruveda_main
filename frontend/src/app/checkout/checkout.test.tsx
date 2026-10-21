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
  sendOtp: vi.fn(),
  resendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  saveProfile: vi.fn(),
  guestCheckout: vi.fn(),
  /** The checkout opens the customer session (the profile) on Continue. */
  openSession: vi.fn(async (name: string, phone: string, email: string) => ({
    name,
    phone,
    email,
    phoneVerified: false,
  })),
  /**
   * The checkout asks the server whether it needs an OTP. The default here is
   * the OTP flow (an OTP is required), which is what the suite asserts.
   */
  getOtpConfig: vi.fn(async () => ({
    otpRequired: true,
    mode: 'auto' as const,
    guestCheckout: false,
    message: null,
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

/** Fill name + number so the Send OTP handler's own validation passes. */
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
  screen.getByRole("button", { name: /Place Order|Pay Now|Verify your WhatsApp|Complete address|Enter a valid email|Processing/i });

/* ------------------------------------------------------------------ */

beforeEach(() => {
  window.localStorage.clear();
  authState.user = null;
  authState.isAuthenticated = false;
  authState.isLoading = false;
  authState.sendOtp = vi.fn().mockResolvedValue({ expiresInSeconds: 300 });
  authState.resendOtp = vi.fn().mockResolvedValue({ expiresInSeconds: 300 });
  authState.verifyOtp = vi.fn().mockResolvedValue({ token: "t", user: { id: "u1" } });
  authState.saveProfile = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("checkout — identity is WhatsApp OTP, never a login form", () => {
  it("shows Send OTP where Sign up used to be, and no Sign up button at all", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /Send OTP/i }));

    expect(screen.getByRole("button", { name: /Send OTP/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Sign up$/i })).toBeNull();
    // No separate login/signup anywhere on the page.
    expect(screen.queryByText(/Login to continue/i)).toBeNull();
    expect(screen.queryByText(/Create an account/i)).toBeNull();
    expect(screen.queryByText(/Login required/i)).toBeNull();
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

  it("keeps Place Order disabled until the OTP is verified", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /Verify your WhatsApp number to continue/i }));

    fillContact();
  fillContactEmail();
    fillAddress();
    const button = placeOrderButton() as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent || "").toMatch(/Verify your WhatsApp number/i);
  });

  it("reveals the OTP input and a Verify OTP button after Send OTP", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /Send OTP/i }));

    expect(screen.queryByPlaceholderText("Enter 6-digit OTP")).toBeNull();

    fillContact();
  fillContactEmail();
    fireEvent.click(screen.getByRole("button", { name: /Send OTP/i }));

    const otp = await screen.findByPlaceholderText("Enter 6-digit OTP");
    expect(otp).toBeTruthy();
    expect((otp as HTMLInputElement).maxLength).toBe(6);
    expect(screen.getByRole("button", { name: /Verify OTP/i })).toBeTruthy();
    expect(authState.sendOtp).toHaveBeenCalledWith("919876543210");
  });

  it("only enables Verify OTP once exactly six digits are typed", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /Send OTP/i }));
    fillContact();
  fillContactEmail();
    fireEvent.click(screen.getByRole("button", { name: /Send OTP/i }));
    const otp = (await screen.findByPlaceholderText("Enter 6-digit OTP")) as HTMLInputElement;

    const verify = () => screen.getByRole("button", { name: /Verify OTP/i }) as HTMLButtonElement;

    fireEvent.change(otp, { target: { value: "123" } });
    expect(verify().disabled).toBe(true);

    fireEvent.change(otp, { target: { value: "123456" } });
    expect(verify().disabled).toBe(false);
  });

  it("unlocks Place Order after a successful verification", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /Send OTP/i }));
    fillContact();
  fillContactEmail();
    fillAddress();
    fireEvent.click(screen.getByRole("button", { name: /Send OTP/i }));

    const otp = (await screen.findByPlaceholderText("Enter 6-digit OTP")) as HTMLInputElement;
    fireEvent.change(otp, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify OTP/i }));

    await waitFor(() => screen.getByText(/Verified/i));
    expect(authState.verifyOtp).toHaveBeenCalledWith("919876543210", "123456", "Atharva Bhargava");

    // The OTP block and the Send button are gone once verified.
    expect(screen.queryByPlaceholderText("Enter 6-digit OTP")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send OTP/i })).toBeNull();

    const button = placeOrderButton() as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent || "").toMatch(/Place Order|Pay Now/);
  });

  it("keeps Place Order locked when verification fails", async () => {
    authState.verifyOtp = vi.fn().mockRejectedValue(new Error("The OTP you entered is incorrect."));
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /Send OTP/i }));
    fillContact();
  fillContactEmail();
    fillAddress();
    fireEvent.click(screen.getByRole("button", { name: /Send OTP/i }));

    const otp = (await screen.findByPlaceholderText("Enter 6-digit OTP")) as HTMLInputElement;
    fireEvent.change(otp, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify OTP/i }));

    await waitFor(() => screen.getByText(/incorrect/i));
    expect((placeOrderButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("a valid existing session skips the OTP entirely", async () => {
    authState.user = { id: "u1", firstName: "Atharva", lastName: "Bhargava", phone: "9876543210", email: "a@b.com" };
    authState.isAuthenticated = true;

    render(<CheckoutPage />);
    await waitFor(() => screen.getByText(/Verified/i));

    expect(screen.queryByRole("button", { name: /Send OTP/i })).toBeNull();
    expect(screen.queryByPlaceholderText("Enter 6-digit OTP")).toBeNull();
    expect(authState.sendOtp).not.toHaveBeenCalled();

    fillAddress();
    expect((placeOrderButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not place an order before verification, even on a full valid form", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /Send OTP/i }));
    fillContact();
  fillContactEmail();
    fillAddress();

    const button = placeOrderButton() as HTMLButtonElement;
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /Processing/i })).toBeNull();
  });
});