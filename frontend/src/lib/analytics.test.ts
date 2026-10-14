import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_KEY,
  claimPurchaseOnce,
  getConsent,
  gaEnabled,
  pixelEnabled,
  sanitizeParams,
  setBeacon,
  setConsent,
  track,
} from "./analytics";

/**
 * The consent contract, which is the whole point of this module:
 *   - GA4 / Meta Pixel never receive anything before the visitor accepts.
 *   - Nothing fires at all when the ids are missing (scripts not loaded).
 *   - purchase is counted once per order, across refreshes.
 *
 * The first-party beacon is consent-free by design (it is our own database),
 * so it is stubbed here and asserted separately.
 */

function makeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };
}

/** Minimal browser-ish global: window + localStorage/sessionStorage + location. */
function installBrowser() {
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  const listeners: Record<string, Array<() => void>> = {};

  const win: any = {
    localStorage,
    sessionStorage,
    location: { pathname: "/products" },
    addEventListener: (type: string, fn: () => void) => {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    dispatchEvent: () => true,
    CustomEvent: class {
      constructor(public type: string, public init?: any) {}
    },
  };

  (globalThis as any).window = win;
  (globalThis as any).CustomEvent = win.CustomEvent;

  return {
    win,
    localStorage,
    reset: () => {
      localStorage.clear();
      sessionStorage.clear();
      delete win.gtag;
      delete win.fbq;
    },
  };
}

/**
 * One shared fake browser for the whole file. Describe bodies all run BEFORE
 * any test, so installing a fresh `window` per describe would leave the module
 * reading a newer object than the tests were writing to.
 */
const env = installBrowser();

describe("track()", () => {
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    env.reset();
    beacon = vi.fn();
    setBeacon((path, body) => beacon(path, body));
    // The module reads these at call time, so each test can set them freely.
    delete process.env.NEXT_PUBLIC_GA_ID;
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
  });

  it("sends the first-party beacon even without consent (it is our own database)", () => {
    track("view_item", { items: [{ item_id: "p1", item_name: "Ashwagandha", price: 500 }] });

    expect(beacon).toHaveBeenCalledTimes(1);
    const [path, body] = beacon.mock.calls[0];
    expect(path).toBe("/analytics/event");
    expect(body.event).toBe("view_item");
    expect(body.product_id).toBe("p1");
  });

  it("is a no-op for GA4 and Meta Pixel without consent", () => {
    const gtag = vi.fn();
    const fbq = vi.fn();
    env.win.gtag = gtag;
    env.win.fbq = fbq;

    expect(getConsent()).toBeNull();
    track("add_to_cart", { items: [{ item_id: "p1", price: 500, quantity: 1 }] });

    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).not.toHaveBeenCalled();
    // ...but the cookieless first-party record still happened.
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("still sends nothing to GA4/Meta after the visitor REJECTS", () => {
    const gtag = vi.fn();
    const fbq = vi.fn();
    env.win.gtag = gtag;
    env.win.fbq = fbq;

    setConsent("denied");
    track("add_to_cart", { items: [{ item_id: "p1", price: 500, quantity: 1 }] });

    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).not.toHaveBeenCalled();
    expect(getConsent()).toBe("denied");
  });

  it("does not call the vendor globals when the ids are unset, even if consented", () => {
    setConsent("granted");
    const gtag = vi.fn();
    const fbq = vi.fn();
    // Simulates a global left over from somewhere else: with no id configured,
    // gaEnabled()/pixelEnabled() are false because the scripts were never rendered.
    env.win.gtag = gtag;
    env.win.fbq = fbq;

    expect(gaEnabled()).toBe(false);
    expect(pixelEnabled()).toBe(false);

    track("add_to_cart", { items: [{ item_id: "p1", price: 500, quantity: 1 }] });

    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).not.toHaveBeenCalled();
  });

  it("fans out to GA4 and Meta Pixel once consent is granted", () => {
    process.env.NEXT_PUBLIC_GA_ID = "G-TEST123";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "9876543210";
    const gtag = vi.fn();
    const fbq = vi.fn();
    env.win.gtag = gtag;
    env.win.fbq = fbq;
    setConsent("granted");

    track("add_to_cart", { items: [{ item_id: "p1", item_name: "Ashwagandha", price: 500, quantity: 2 }] });

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag.mock.calls[0][0]).toBe("event");
    expect(gtag.mock.calls[0][1]).toBe("add_to_cart");
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq.mock.calls[0][0]).toBe("track");
    expect(fbq.mock.calls[0][1]).toBe("add_to_cart");
    expect((fbq.mock.calls[0][3] as any).eventID).toEqual(expect.any(String));
  });

  it("strips PII from every destination", () => {
    const gtag = vi.fn();
    process.env.NEXT_PUBLIC_GA_ID = "G-TEST123";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "9876543210";
    env.win.gtag = gtag;
    setConsent("granted");

    // `as any` on purpose: the PII fields below are exactly what the type
    // system rejects at compile time. This proves the RUNTIME scrub drops them
    // too, for any caller that manages to pass them (e.g. JS or a future refactor).
    track("purchase", {
      transaction_id: "MV-123456",
      value: 600,
      currency: "INR",
      payment_type: "cod",
      email: "buyer@example.com",
      phone: "+919876543210",
      shipping_address: { city: "Pune" },
      user_id: "user-42",
      items: [{ item_id: "p1", item_name: "Ashwagandha", price: 500, quantity: 1 }],
    } as any);

    const gaPayload = gtag.mock.calls[0][2] as Record<string, unknown>;
    expect(gaPayload.email).toBeUndefined();
    expect(gaPayload.phone).toBeUndefined();
    expect(gaPayload.shipping_address).toBeUndefined();
    expect(gaPayload.user_id).toBeUndefined();
    // The safe commerce fields survive.
    expect(gaPayload.transaction_id).toBe("MV-123456");
    expect(gaPayload.payment_type).toBe("cod");

    const beaconBody = beacon.mock.calls[0][1];
    expect(beaconBody.email).toBeUndefined();
    expect(beaconBody.user_id).toBeUndefined();
  });

  it("fires purchase exactly once per order, even on refresh", () => {
    const gtag = vi.fn();
    process.env.NEXT_PUBLIC_GA_ID = "G-TEST123";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "9876543210";
    env.win.gtag = gtag;
    setConsent("granted");

    const params = {
      transaction_id: "MV-654321",
      value: 1250,
      currency: "INR",
      payment_type: "payu",
      items: [{ item_id: "p1", price: 1200, quantity: 1 }],
    };

    track("purchase", params);
    // The success page polls while PayU confirms, and a refresh re-runs it.
    track("purchase", params);
    track("purchase", params);

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("counts a different order separately", () => {
    const gtag = vi.fn();
    process.env.NEXT_PUBLIC_GA_ID = "G-TEST123";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "9876543210";
    env.win.gtag = gtag;
    setConsent("granted");

    track("purchase", { transaction_id: "MV-1", value: 100, items: [{ item_id: "p1", price: 100, quantity: 1 }] });
    track("purchase", { transaction_id: "MV-2", value: 200, items: [{ item_id: "p2", price: 200, quantity: 1 }] });

    expect(gtag).toHaveBeenCalledTimes(2);
  });

  it("does not send purchase at all when the order number is missing", () => {
    const gtag = vi.fn();
    env.win.gtag = gtag;
    setConsent("granted");

    track("purchase", { value: 100 });

    expect(gtag).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("claimPurchaseOnce is idempotent per order id", () => {
    expect(claimPurchaseOnce("MV-777")).toBe(true);
    expect(claimPurchaseOnce("MV-777")).toBe(false);
    expect(claimPurchaseOnce("MV-778")).toBe(true);
  });

  it("only forwards known commerce events to the first-party table", () => {
    track("order_placed", { value: 10 });
    expect(beacon).not.toHaveBeenCalled();

    track("begin_checkout", { value: 10 });
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("survives a beacon that throws", () => {
    setBeacon(() => {
      throw new Error("network down");
    });
    expect(() => track("view_item", { items: [{ item_id: "p1", price: 1, quantity: 1 }] })).not.toThrow();
  });
});

describe("sanitizeParams", () => {
  it("keeps commerce fields and drops identity fields", () => {
    const clean = sanitizeParams({
      value: 500,
      currency: "INR",
      transaction_id: "MV-1",
      payment_type: "cod",
      email: "a@b.c",
      user_id: "u1",
      customer_id: "c1",
      first_name: "Asha",
      phone_number: "9876543210",
      session_id: "sid-123",
    } as any);

    expect(clean).toEqual({
      value: 500,
      currency: "INR",
      transaction_id: "MV-1",
      payment_type: "cod",
      session_id: "sid-123",
    });
  });
});

describe("consent storage", () => {
  it("round-trips the choice under meruveda_consent", () => {
    setConsent("granted");
    expect(env.localStorage.getItem(CONSENT_KEY)).toBe("granted");
    expect(getConsent()).toBe("granted");
  });

  it("is NOT wiped by the card-vault cleanup pattern", () => {
    // CardVaultCleanup removes keys matching /^meruveda_.*(card|vault)/i.
    const VAULT_KEY = /^meruveda_.*(card|vault)/i;
    expect(VAULT_KEY.test(CONSENT_KEY)).toBe(false);
    expect(VAULT_KEY.test("meruveda_purchase_seen")).toBe(false);
  });
});