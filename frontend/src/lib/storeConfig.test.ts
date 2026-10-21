import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The store configuration the storefront reads.
 *
 * The account-pages switch is NOT a hardcoded flag in the frontend: it comes
 * from the backend's public GET /api/auth/otp/config, exactly like
 * `otpRequired`. These tests cover both states.
 */

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockConfigResponse(data: Record<string, unknown>) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data }),
  })) as unknown as typeof fetch;
}

describe("the store configuration", () => {
  it("reads accountPages=false from the backend", async () => {
    mockConfigResponse({ otpRequired: false, mode: "off", guestCheckout: true, accountPages: false });
    const { getStoreConfig, accountPagesEnabled } = await import("@/lib/storeConfig");

    const config = await getStoreConfig({ fresh: true });
    expect(config.accountPages).toBe(false);
    expect(config.otpRequired).toBe(false);
    expect(await accountPagesEnabled()).toBe(false);
  });

  it("reads accountPages=true from the backend", async () => {
    mockConfigResponse({ otpRequired: false, mode: "off", guestCheckout: true, accountPages: true });
    const { getStoreConfig, accountPagesEnabled } = await import("@/lib/storeConfig");

    const config = await getStoreConfig({ fresh: true });
    expect(config.accountPages).toBe(true);
    expect(await accountPagesEnabled()).toBe(true);
  });

  it("keeps the account pages off when the backend cannot be reached", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const { getStoreConfig, accountPagesEnabled } = await import("@/lib/storeConfig");

    const config = await getStoreConfig({ fresh: true });
    expect(config.accountPages).toBe(false);
    expect(await accountPagesEnabled()).toBe(false);
  });

  it("asks the backend for the configuration - there is no build-time flag", async () => {
    const spy = mockConfigResponse({ otpRequired: false, accountPages: false });
    const { getStoreConfig } = await import("@/lib/storeConfig");

    await getStoreConfig({ fresh: true });

    const called = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(String(called)).toContain("/auth/otp/config");
  });
});
