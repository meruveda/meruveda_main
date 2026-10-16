"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export type ToastKind = "success" | "error";

export interface ToastMessage {
  id: number;
  text: string;
  kind: ToastKind;
}

const AUTO_DISMISS_MS = 5000;

/**
 * Minimal toast host.
 *
 * The account area had no notification mechanism, which is why the broken
 * invoice download failed silently into a print dialog. This is deliberately
 * tiny and local rather than a new dependency: it needs one message, one
 * dismiss, and an auto-hide.
 */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback((text: string | null, kind: ToastKind = "error") => {
    if (!text) {
      setToast(null);
      return;
    }
    setToast({ id: Date.now(), text, kind });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return { toast, showToast };
}

export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  if (!toast) return null;

  const isError = toast.kind === "error";
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md"
    >
      <div
        className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-xs font-semibold shadow-lg ${
          isError
            ? "bg-red-50 border-red-200 text-red-700"
            : "bg-green-50 border-green-200 text-green-700"
        }`}
      >
        {isError ? (
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
        ) : (
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
        )}
        <span className="flex-1 leading-relaxed">{toast.text}</span>
        <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}