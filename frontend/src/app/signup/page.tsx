import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { accountPagesEnabled } from "@/lib/storeConfig";
import SignupInner from "./SignupInner";

/**
 * The sign-up page.
 *
 * While the account pages are switched off (ACCOUNT_PAGES_ENABLED is false on
 * the backend) the visitor is sent back to the shop with a single server-side
 * 307. Nothing is deleted: setting the flag back to true brings this page
 * back exactly as it was.
 */
export default async function SignupPage() {
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
      <SignupInner />
    </Suspense>
  );
}
