import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { accountPagesEnabled } from "@/lib/storeConfig";
import LoginInner from "./LoginInner";

/**
 * The sign-in page.
 *
 * While the account pages are switched off (ACCOUNT_PAGES_ENABLED is false on
 * the backend) the page is not shown at all: the visitor is sent back to the
 * shop with a single server-side 307. The page itself is untouched - setting
 * the flag back to true brings it (and every other account page) back
 * unchanged.
 */
export default async function LoginPage() {
  if (!(await accountPagesEnabled())) {
    redirect("/");
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-gold" />
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
