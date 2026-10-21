import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/utils/apiUrl";
import AccountClientLayout from "./AccountClientLayout";

/**
 * Every page under /account.
 *
 * The profile area is opened by the CHECKOUT, not by a password: the customer
 * presses "Continue" at the contact step, the profile is created and a
 * session is opened in this browser.
 *
 * So a visitor with no session has nothing to see here. They are sent back to
 * the shop ONCE, with a small explanation ("Place an order to create your
 * profile") - no /login, and no redirect loop.
 */
async function hasCustomerSession(): Promise<boolean> {
  try {
    const jar = await cookies();
    const cookie = jar.get('meruveda_auth_token')?.value || jar.get('mv_customer_session')?.value || '';
    if (!cookie) return false;

    const res = await fetch(`${API_BASE_URL}/account/session`, {
      headers: {
        Accept: 'application/json',
        // The session lives in the cookie; the backend decides who it is.
        Authorization: `Bearer ${cookie}`,
      },
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body?.data?.profile);
  } catch (err) {
    console.error('[account] the session check failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  if (!(await hasCustomerSession())) {
    // Once, to the shop, with the reason.
    redirect('/?profile=required');
  }

  return <AccountClientLayout>{children}</AccountClientLayout>;
}
