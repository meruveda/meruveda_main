/**
 * Canonical API base URL for server-side fetch calls (RSC / server components).
 *
 * On Vercel, the `BACKEND_SERVICE_URL` binding is injected at runtime and
 * resolves to the backend service's internal URL. We append `/api` because
 * the Express app mounts all routes under that prefix.
 *
 * Falls back to `NEXT_PUBLIC_API_URL` (useful for local dev without bindings)
 * and finally to localhost.
 *
 * Client-side code (hooks, event handlers) should import axiosInstance from
 * "@/api/axiosInstance" instead — it uses a relative `/api` path that routes
 * through the public rewrite.
 */
function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildApiBase(): string {
  const binding = process.env.BACKEND_SERVICE_URL
    ? stripTrailingSlashes(process.env.BACKEND_SERVICE_URL)
    : '';
  // The binding is the service origin (no path) — but guard against a value
  // that already ends in /api (or / + trailing slash) so we never emit `//api`.
  if (binding) {
    if (binding.endsWith('/api')) return binding;
    return `${binding}/api`;
  }
  const publicUrl = process.env.NEXT_PUBLIC_API_URL
    ? stripTrailingSlashes(process.env.NEXT_PUBLIC_API_URL)
    : '';
  if (publicUrl) return publicUrl;
  return 'http://localhost:5000/api';
}

export const API_BASE_URL = buildApiBase();
