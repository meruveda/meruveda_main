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

  if (anyErr?.response?.status === 403) {
    return "You do not have access to this invoice.";
  }
  if (anyErr?.response?.status === 404) {
    return "Order not found.";
  }
  if (anyErr?.response?.status === 410) {
    return "This invoice was already issued and its stored file is no longer available. Contact support for a copy.";
  }
  if (anyErr?.response?.status === 503) {
    return "Your invoice is being prepared. Please try again in a moment.";
  }
  return anyErr?.message || "Could not download the invoice.";
}

/**
 * The filename the browser will save.
 *
 * The server sends `Content-Disposition: attachment; filename="Invoice-<n>.pdf"`,
 * so the invoice number from the authoritative header is preferred; this is only
 * the fallback for when the header is missing.
 */
function filenameFromDisposition(disposition: string | undefined, fallback: string): string {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition || "");
  if (!match) return fallback;
  const name = decodeURIComponent(match[1].trim());
  return /^[\w.-]+\.pdf$/i.test(name) ? name : fallback;
}

export async function downloadInvoicePdf(orderId: string, orderNumber?: string | null): Promise<string> {
  const { default: axiosInstance } = await import("@/api/axiosInstance");

  let blob: Blob;
  let disposition: string | undefined;
  try {
    const res = await axiosInstance.get(`/orders/${encodeURIComponent(orderId)}/invoice`, {
      responseType: "blob",
    });
    blob = res.data as Blob;
    disposition = res.headers?.["content-disposition"];
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

  const filename = filenameFromDisposition(
    disposition,
    `Invoice-${(orderNumber || orderId).replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf`
  );
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