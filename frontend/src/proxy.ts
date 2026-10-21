import { type NextRequest, NextResponse } from 'next/server'

/**
 * Middleware — the request-level gate of the storefront.
 *
 * It no longer guards /account: the profile area shows its own empty state to
 * a visitor without a session (see app/account/ProfileEmptyState). Nothing on
 * the storefront is behind a login while the password pages are switched off,
 * so every request passes through and the check stays here as the single
 * place a path-based rule would be written.
 */
export async function proxy(_request: NextRequest) {

  // /account is NOT gated here any more.
  //
  // The profile is created at the checkout, so a visitor without a session
  // has nothing to redirect to - there is no /login while the password pages
  // are switched off. They see the profile area's own empty state ("Place an
  // order to create your profile"), once, with no loop. The account layout
  // decides that: it needs the backend's answer about the session cookie.

  // /checkout is intentionally public: guests may browse and check out, and
  // identity is collected by the OTP form on the page itself.

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
