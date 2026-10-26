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
  /** Continue sends the OTP; only verify opens the session. */
  getOtpConfig: vi.fn(async () => ({ otpRequired: true, mode: "on", guestCheckout: false, message: null })),
  sendOtp: vi.fn(async () => ({ expiresInSeconds: 300 })),
  resendOtp: vi.fn(async () => ({ expiresInSeconds: 300 })),
  verifyOtp: vi.fn(async () => {}),
  /** The checkout opens the customer session (the profile) after verify. */
  openSession: vi.fn(async (name: string, phone: string, email: string) => ({
    name,
    phone,
    email,
    phoneVerified: true,
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

  const stateBox = screen.getByLabelText("State / Union Territory") as HTMLInputElement;
  fireEvent.focus(stateBox);
  fireEvent.change(stateBox, { target: { value: "Madhya Pradesh" } });
  fireEvent.keyDown(stateBox, { key: "Enter" });

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
  authState.getOtpConfig = vi.fn().mockResolvedValue({
    otpRequired: true,
    mode: "on",
    guestCheckout: false,
    message: null,
  });
  authState.sendOtp = vi.fn().mockResolvedValue({ expiresInSeconds: 300 });
  authState.resendOtp = vi.fn().mockResolvedValue({ expiresInSeconds: 300 });
  authState.verifyOtp = vi.fn().mockResolvedValue(undefined);
  authState.openSession = vi.fn(async (name: string, phone: string, email: string) => ({
    name,
    phone,
    email,
    phoneVerified: true,
  }));
});

afterEach(() => cleanup());

describe("checkout — contact step verifies the number with a WhatsApp OTP", () => {
  it("Continue sends the OTP and reveals the OTP input", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));
    fillContact();
    fillContactEmail();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    // The OTP was requested for the full phone (with country code).
    await waitFor(() =>
      expect(authState.sendOtp).toHaveBeenCalledWith("919876543210")
    );
    // The OTP input is now visible.
    await waitFor(() => expect(document.getElementById("checkout-otp")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Verify & Continue/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Change number/i })).toBeTruthy();
    // The session has NOT opened yet — verify must come first.
    expect(authState.openSession).not.toHaveBeenCalled();
  });

  it("verifies the OTP then opens the session and unlocks Place Order", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));
    fillContact();
    fillContactEmail();
    fillAddress();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));
    await waitFor(() => expect(document.getElementById("checkout-otp")).toBeTruthy());

    // Type the 6-digit code and verify.
    const otpInput = document.getElementById("checkout-otp") as HTMLInputElement;
    fireEvent.change(otpInput, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify & Continue/i }));

    await waitFor(() =>
      expect(authState.verifyOtp).toHaveBeenCalledWith("919876543210", "123456", "Atharva Bhargava")
    );
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
    expect(screen.getByText(/Contact confirmed/i)).toBeTruthy();
  });

  it("shows the server message when OTP send fails with a response", async () => {
    // A 4xx/5xx with a body must surface the backend's real message.
    authState.sendOtp = vi.fn().mockRejectedValue({
      response: { data: { error: { message: "This WhatsApp number cannot receive messages." } } },
    });
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));
    fillContact();
    fillContactEmail();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() =>
      screen.getByText(/This WhatsApp number cannot receive messages/i)
    );
    expect(document.getElementById("checkout-otp")).toBeNull();
  });

  it("shows the friendly connect message on a transport failure (no response)", async () => {
    // Axios surfaces a transport failure as a bare "Network Error" with no
    // .response — the customer sees the friendly connect message.
    authState.sendOtp = vi.fn().mockRejectedValue(new Error("Network Error"));
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));
    fillContact();
    fillContactEmail();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => screen.getByText(/check your internet and try again/i));
  });

  it("Change number returns to the contact form", async () => {
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));
    fillContact();
    fillContactEmail();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));
    await waitFor(() => expect(document.getElementById("checkout-otp")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Change number/i }));

    await waitFor(() => expect(document.getElementById("checkout-otp")).toBeNull());
    expect(screen.getByRole("button", { name: /^Continue$/i })).toBeTruthy();
  });

  it("shows the server message when OTP verify fails", async () => {
    authState.verifyOtp = vi.fn().mockRejectedValue({
      response: { data: { error: { message: "The OTP you entered is incorrect." } } },
    });
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));
    fillContact();
    fillContactEmail();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));
    await waitFor(() => expect(document.getElementById("checkout-otp")).toBeTruthy());

    const otpInput = document.getElementById("checkout-otp") as HTMLInputElement;
    fireEvent.change(otpInput, { target: { value: "999999" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify & Continue/i }));

    await waitFor(() => screen.getByText(/The OTP you entered is incorrect/i));
    // The session must NOT have opened.
    expect(authState.openSession).not.toHaveBeenCalled();
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
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));

    fillContact();
    fillContactEmail();
    fillAddress();
    const button = placeOrderButton() as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(screen.queryByRole("button", { name: /Processing/i })).toBeNull();
  });

  it("skips the OTP entirely when the backend says none is required", async () => {
    // OTP_MODE=off / template unapproved -> the config reports otpRequired:false
    // and Continue must open the session directly with no OTP input.
    authState.getOtpConfig = vi.fn().mockResolvedValue({
      otpRequired: false,
      mode: "off",
      guestCheckout: true,
      message: null,
    });
    render(<CheckoutPage />);
    await waitFor(() => screen.getByRole("button", { name: /^Continue$/i }));
    fillContact();
    fillContactEmail();

    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() =>
      expect(authState.openSession).toHaveBeenCalledWith(
        "Atharva Bhargava",
        "919876543210",
        "atharva@example.com",
        expect.objectContaining({ website: "" })
      )
    );
    // No OTP input ever appeared, and no OTP was requested.
    expect(document.getElementById("checkout-otp")).toBeNull();
    expect(authState.sendOtp).not.toHaveBeenCalled();
    expect(screen.getByText(/Contact confirmed/i)).toBeTruthy();
  });
});
