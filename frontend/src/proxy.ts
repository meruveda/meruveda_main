import { type NextRequest, NextResponse } from 'next/server'

/**
 * Middleware — lightweight JWT cookie check.
 * The storefront auth is a client-side mock auth system.
 * This middleware checks for the mock auth token cookie on protected paths.
 *
 * When the real backend is integrated, replace the cookie check
 * with a server-side JWT verification call.
 */
export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  const authToken =
    request.cookies.get('meruveda_auth_token')?.value ||
    // Fallback: check Authorization header (for future API use)
    request.headers.get('Authorization')?.replace('Bearer ', '');

  // Protect /account routes.
  //
  // The password pages are switched off, so there is no /login to send a
  // visitor to: the profile is created at the checkout. A visitor with no
  // session is sent ONCE to the shop with a small explanation
  // ("Place an order to create your profile"). The account layout verifies
  // the session with the backend and repeats the redirect when the cookie is
  // stale, so there is never a loop and never a /login.
  if (pathname.startsWith('/account')) {
    const hasSession =
      request.cookies.get('mv_customer_session')?.value ||
      request.cookies.get('meruveda_auth_token')?.value;
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      url.searchParams.set('profile', 'required');
      return NextResponse.redirect(url);
    }
  }

  // /checkout is intentionally public: guests may browse and check out, and
  // identity is collected by the OTP form on the page itself.

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
