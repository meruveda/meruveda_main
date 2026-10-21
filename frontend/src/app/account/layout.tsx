import { cookies } from "next/headers";
import { API_BASE_URL } from "@/utils/apiUrl";
import AccountClientLayout from "./AccountClientLayout";
import ProfileEmptyState from "./ProfileEmptyState";

/**
 * Every page under /account.
 *
 * The profile area is opened by the CHECKOUT, not by a password: the customer
 * presses "Continue" at the contact step, the profile is created and a
 * session is opened in this browser.
 *
 * So a visitor with no session has nothing to see here - and no /login to be
 * sent to, because the password pages are switched off. They are shown the
 * empty state ("Place an order to create your profile" + Shop Now) in place
 * of the area. Nothing redirects: there is no loop, and no login page.
 */
/**
 * A cookie alone is not proof: it may have been closed or may have expired.
 * The backend answers that, and the answer decides whether the area opens.
 */
async function hasLiveSession(cookie: string): Promise<boolean> {
  try {
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
  const jar = await cookies();
  const sessionCookie = jar.get('mv_customer_session')?.value;
  const authCookie = jar.get('meruveda_auth_token')?.value;

  if (!sessionCookie && !authCookie) {
    // No cookie at all: the answer cannot change. The empty state is rendered
    // right away, on the server, so it is in the first paint.
    return <ProfileEmptyState />;
  }

  if (sessionCookie && !authCookie && !(await hasLiveSession(sessionCookie))) {
    // A checkout session cookie that is no longer a session (closed, or
    // expired): the same empty state. A password login keeps its own cookie
    // and is verified by the client area, so it is never caught here.
    return <ProfileEmptyState />;
  }

  return <AccountClientLayout>{children}</AccountClientLayout>;
}
