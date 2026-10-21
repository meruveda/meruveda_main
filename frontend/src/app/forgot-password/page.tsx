import { redirect } from "next/navigation";
import { accountPagesEnabled } from "@/lib/storeConfig";
import ForgotPasswordInner from "./ForgotPasswordInner";

/**
 * The "forgot password" page.
 *
 * While the account pages are switched off (ACCOUNT_PAGES_ENABLED is false on
 * the backend) the visitor is sent back to the shop with a single server-side
 * 307.
 */
export default async function ForgotPasswordPage() {
  if (!(await accountPagesEnabled())) {
    redirect("/");
  }

  return <ForgotPasswordInner />;
}
