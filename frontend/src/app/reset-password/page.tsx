import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { accountPagesEnabled } from "@/lib/storeConfig";
import ResetPasswordInner from "./ResetPasswordInner";

/**
 * The "reset password" page.
 *
 * While the account pages are switched off (ACCOUNT_PAGES_ENABLED is false on
 * the backend) the visitor is sent back to the shop with a single server-side
 * 307.
 */
export default async function ResetPasswordPage() {
  if (!(await accountPagesEnabled())) {
    redirect("/");
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <Loader2 className="animate-spin text-gold" size={40} />
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
