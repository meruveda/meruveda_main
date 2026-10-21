import Link from "next/link";
import { Package } from "lucide-react";

/**
 * The profile area, seen by a visitor who has no session yet.
 *
 * A profile is created automatically at the CHECKOUT contact step: name,
 * mobile number and email, in one press of "Continue". There is no signup
 * form and no password, so there is nothing to tell this visitor to log into.
 * The page just explains where the profile comes from and offers the shop.
 *
 * It is shown once, without redirecting anywhere, on /account and on every
 * page below it. The component is rendered on the server when the browser
 * has no session cookie at all, so the words are in the very first paint.
 */
export default function ProfileEmptyState() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 md:py-14 max-w-6xl">
      <div className="bg-white p-6 sm:p-10 md:p-14 rounded-2xl border border-gray-100 shadow-sm text-center">
        <div className="w-14 h-14 rounded-full bg-gold/15 flex items-center justify-center mx-auto mb-5">
          <Package size={26} className="text-deep-purple" strokeWidth={1.5} />
        </div>
        <h1 className="font-playfair font-bold text-deep-purple text-2xl md:text-3xl mb-3">
          Place an order to create your profile
        </h1>
        <p className="text-gray-600 max-w-xl mx-auto mb-7 leading-relaxed">
          Your profile is made automatically at checkout - your name, your mobile number and
          your email address. Your order history, your addresses and your invoices will all be
          waiting here after your first order.
        </p>
        <Link
          href="/products"
          className="btn btn-primary inline-flex items-center justify-center"
        >
          Shop Now
        </Link>
      </div>
    </div>
  );
}
