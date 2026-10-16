/**
 * Download the canonical invoice PDF for an order.
 *
 * One invoice, one template, everywhere: this fetches the exact file the backend
 * generated and sent over WhatsApp/email. Nothing here renders a second copy.
 *
 * There is deliberately no `window.open()` and no print fallback — the earlier
 * version fell back to `window.print()` on any error, which printed the
 * "My Orders" page and looked like a successful invoice download.
 */

/** Pull a readable message out of an axios error whose body is a Blob. */
async function extractErrorMessage(err: unknown): Promise<string> {
  const anyErr = err as any;
  const body = anyErr?.response?.data;

  if (typeof Blob !== "undefined" && body instanceof Blob) {
    try {
      const parsed = JSON.parse(await body.text());
      if (parsed?.error?.message) return String(parsed.error.message);
    } catch {
      /* not JSON */
    }
  } else if (body?.error?.message) {
    return String(body.error.message);
  }

  if (anyErr?.response?.status === 409) {
    return "The invoice will be available after payment is verified.";
  }
  if (anyErr?.response?.status === 403) {
    return "You do not have access to this invoice.";
  }
  if (anyErr?.response?.status === 503) {
    return "Invoices are unavailable right now. Please try again shortly.";
  }
  return anyErr?.message || "Could not download the invoice.";
}

export async function downloadInvoicePdf(orderId: string, orderNumber?: string | null): Promise<string> {
  const { default: axiosInstance } = await import("@/api/axiosInstance");

  let blob: Blob;
  try {
    const res = await axiosInstance.get(`/orders/${encodeURIComponent(orderId)}/invoice`, {
      responseType: "blob",
    });
    blob = res.data as Blob;
  } catch (err) {
    throw new Error(await extractErrorMessage(err));
  }

  // The server answers JSON when something is wrong, even though we asked for a
  // blob. Without this check a JSON error body is saved as "Invoice-*.pdf".
  if (blob.type && blob.type.includes("application/json")) {
    let message = "Could not download the invoice.";
    try {
      const parsed = JSON.parse(await blob.text());
      if (parsed?.error?.message) message = String(parsed.error.message);
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  const filename = `Invoice-${(orderNumber || orderId).replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf`;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return filename;
}