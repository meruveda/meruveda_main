/**
 * The message the server actually sent.
 *
 * The admin used to show a generic "Upload failed" for everything, so a
 * perfectly clear answer from the backend ("That image is too large. The
 * maximum is 4 MB...") was thrown away and the operator was left staring at
 * "Request failed with status code 500".
 */
export function apiErrorMessage(err: any, fallback: string): string {
  const data = err?.response?.data;
  const message =
    data?.error?.message ||
    data?.message ||
    (typeof data === 'string' && data.trim() ? data.trim() : '') ||
    '';
  if (message) return String(message);

  // The platform rejected the body before the function ran, so there is no
  // JSON body at all.
  if (err?.response?.status === 413) {
    return 'That file is too large to upload. The maximum is 4 MB - please resize or compress it and try again.';
  }
  if (err?.code === 'ERR_NETWORK' || err?.message === 'Network Error') {
    return 'Could not reach the server. Please check your connection and try again.';
  }
  if (err?.response?.status === 401 || err?.response?.status === 403) {
    return 'Your admin session has expired. Please sign in again.';
  }
  return fallback;
}

export default apiErrorMessage;
