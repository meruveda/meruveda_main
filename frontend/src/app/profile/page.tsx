"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/*
 * TEMPORARILY DISABLED — /profile page commented out.
 *
 * The full Myntra-style implementation (breadcrumb, account nav, Profile
 * Details card, recent-order strip, address preview) has been commented
 * out below and does not render. Profile entry points (navbar icon,
 * "My Profile" links, /account guards, /login, order-success guard) now
 * send shoppers to /checkout, whose OTP form is the login.
 *
 * TO RE-ENABLE: delete `ProfileDisabledRedirect` below and uncomment the
 * `MyntraStyleProfilePage` implementation at the bottom of this file,
 * then point the entry points back at /profile.
 */

function ProfileDisabledRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/checkout");
  }, [router]);
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center">
        <Loader2 size={32} className="animate-spin text-gold mx-auto mb-3" />
        <p className="text-sm text-gray-500">Taking you to checkout…</p>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-center">
            <Loader2 size={32} className="animate-spin text-gold mx-auto mb-3" />
            <p className="text-sm text-gray-500">Taking you to checkout…</p>
          </div>
        </div>
      }
    >
      <ProfileDisabledRedirect />
    </Suspense>
  );
}

/*
// ================= COMMENTED OUT — Myntra-style /profile page =================
//
// NOTE: kept as reference only; the live route above redirects to /checkout.
// The supporting components still exist unused and can be rewired on
// re-enable:
//   - src/components/account/ProfileDetails.tsx  (view/edit details card)
//   - src/components/account/ProfileLoginGate.tsx (guest OTP login gate)
//
// ---------------------------------------------------------------------------
// (Previous implementation: breadcrumb Home / My Profile, Hello-name left
// nav grouped as ORDERS / ACCOUNT / SUPPORT linking to /account/*, Profile
// Details card with Full Name, Email ID, Mobile, Gender, DOB, Location,
// Alternate Mobile, Hint Name + inline EDIT form, Recent Order strip,
// default Delivery Address preview, More From Your Account rows, and a
// guest Login/Signup OTP gate with ?next= return support. Data via
// orderService.myOrders(), reviewService.mine(), addressService.list(),
// useWishlist() and readProfileExtra().)
// ============================================================================
*/
