"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { X, User } from "lucide-react";

/**
 * "Place an order to create your profile".
 *
 * A visitor without a session who opens /account is sent to the shop once,
 * with this line. It explains where the profile comes from - the checkout
 * contact step - and it can be dismissed. It is never a loop: the notice
 * only reads the query parameter, it never redirects.
 */
export default function ProfileRequiredNotice() {
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(searchParams.get("profile") === "required");
  }, [searchParams]);

  if (!visible) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
      <div className="container mx-auto flex items-start sm:items-center gap-3">
        <User size={16} className="text-amber-700 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-900 flex-1">
          <span className="font-semibold">Place an order to create your profile.</span>{" "}
          Your profile is made automatically at checkout - your name, your mobile number and
          your email address.{" "}
          <Link href="/products" className="font-semibold underline underline-offset-2">
            Continue shopping
          </Link>
        </p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          className="text-amber-700 hover:text-amber-900 p-1 shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
