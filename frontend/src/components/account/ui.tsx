"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Package,
  type LucideIcon,
} from "lucide-react";
import { ORDER_FLOW, ORDER_FLOW_LABELS } from "@/types/account";

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon: Icon = Package,
  title,
  message,
  ctaLabel,
  ctaHref,
  onCta,
}: {
  icon?: LucideIcon;
  title: string;
  message: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCta?: () => void;
}) {
  return (
    <div className="text-center py-14 px-6 bg-ivory/50 rounded-2xl border border-dashed border-gray-200">
      <Icon size={44} className="text-gray-400 mx-auto mb-4" strokeWidth={1.5} />
      <h3 className="font-playfair font-bold text-deep-purple text-lg mb-1">{title}</h3>
      <p className="text-sm text-gray-500 max-w-sm mx-auto leading-relaxed">{message}</p>
      {ctaLabel && (ctaHref || onCta) && (
        <div className="mt-6">
          {ctaHref ? (
            <Link
              href={ctaHref}
              className="inline-block bg-deep-purple text-white px-6 py-2.5 rounded-lg font-bold hover:bg-deep-purple/90 transition-colors text-sm"
            >
              {ctaLabel}
            </Link>
          ) : (
            <button
              onClick={onCta}
              className="bg-deep-purple text-white px-6 py-2.5 rounded-lg font-bold hover:bg-deep-purple/90 transition-colors text-sm"
            >
              {ctaLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skeletons / inline states                                            */
/* ------------------------------------------------------------------ */

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="border border-gray-100 rounded-2xl p-5 bg-white animate-pulse" aria-hidden>
      <div className="h-4 bg-gray-100 rounded w-1/3 mb-3" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 bg-gray-100 rounded w-full mb-2" />
      ))}
    </div>
  );
}

export function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-gray-500 text-sm py-14 justify-center" role="status">
      <Loader2 size={18} className="animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="p-4 bg-red-50 text-red-700 text-sm rounded-xl border border-red-100 font-medium flex items-start gap-3">
      <AlertTriangle size={18} className="shrink-0 mt-0.5" />
      <div className="flex-1">
        <p>{message}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-2 font-bold underline underline-offset-2 hover:no-underline">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function Notice({ tone = "success", children }: { tone?: "success" | "error" | "info"; children: ReactNode }) {
  const styles =
    tone === "success"
      ? "bg-green-50 text-green-700 border-green-100"
      : tone === "error"
        ? "bg-red-50 text-red-700 border-red-100"
        : "bg-blue-50 text-blue-800 border-blue-100";
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? AlertTriangle : Info;
  return (
    <div className={`mb-6 p-4 text-sm rounded-xl border font-medium flex items-start gap-2.5 ${styles}`} role="status">
      <Icon size={17} className="shrink-0 mt-0.5" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section header                                                      */
/* ------------------------------------------------------------------ */

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex justify-between items-start gap-4 flex-wrap mb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-playfair font-bold text-deep-purple mb-1">{title}</h1>
        {subtitle && <p className="text-gray-500 text-sm leading-relaxed">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status badges                                                       */
/* ------------------------------------------------------------------ */

export function statusTone(status: string): string {
  const s = status.toLowerCase().replace(/[\s-]+/g, "_");
  if (["delivered", "refund_completed", "completed", "approved"].includes(s))
    return "bg-green-50 text-green-700 border-green-100";
  if (["shipped", "picked_up", "in_transit"].includes(s))
    return "bg-purple-50 text-purple-700 border-purple-100";
  if (["confirmed", "processing", "approved", "pickup_scheduled", "quality_check", "refund_initiated"].includes(s))
    return "bg-blue-50 text-blue-700 border-blue-100";
  if (["placed", "pending", "requested"].includes(s))
    return "bg-amber-50 text-amber-700 border-amber-100";
  if (["cancelled", "failed", "rejected", "return_rejected"].includes(s))
    return "bg-red-50 text-red-700 border-red-100";
  if (["returned", "refunded"].includes(s)) return "bg-gray-100 text-gray-700 border-gray-200";
  return "bg-gray-50 text-gray-700 border-gray-200";
}

export function prettyStatus(status: string): string {
  const s = status.toLowerCase().replace(/[\s-]+/g, "_");
  if (ORDER_FLOW_LABELS[s]) return ORDER_FLOW_LABELS[s];
  const map: Record<string, string> = {
    requested: "Return Requested",
    pickup_scheduled: "Pickup Scheduled",
    picked_up: "Picked Up",
    quality_check: "Quality Check",
    refund_initiated: "Refund Initiated",
    refund_completed: "Refund Completed",
    rejected: "Return Rejected",
    return_rejected: "Return Rejected",
  };
  if (map[s]) return map[s];
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${statusTone(status)}`}>
      {prettyStatus(status)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Order tracking timeline                                             */
/* ------------------------------------------------------------------ */

export function orderFlowIndex(normalized: string): number {
  const idx = ORDER_FLOW.indexOf(normalized as (typeof ORDER_FLOW)[number]);
  return idx === -1 ? -1 : idx;
}

export function OrderTimeline({
  currentNormalized,
  timestamps,
  compact = false,
}: {
  currentNormalized: string;
  timestamps?: Record<string, string | undefined>;
  compact?: boolean;
}) {
  const terminal = ["cancelled", "failed", "returned", "refunded"].includes(currentNormalized);
  const currentIdx = orderFlowIndex(currentNormalized);
  return (
    <div>
      {terminal && (
        <div className="mb-4">
          <StatusBadge status={currentNormalized} />
        </div>
      )}
      <ol className={`flex ${compact ? "flex-row overflow-x-auto gap-0" : "flex-col md:flex-row"} gap-2`} aria-label="Order progress">
        {ORDER_FLOW.map((key, i) => {
          const done = !terminal && i <= currentIdx;
          const isCurrent = !terminal && i === currentIdx;
          return (
            <li key={key} className={`flex-1 min-w-[110px] ${compact ? "" : ""}`}>
              <div className="flex items-center gap-2">
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border-2 ${
                    terminal
                      ? "bg-gray-100 text-gray-400 border-gray-200"
                      : done
                        ? "bg-deep-purple text-white border-deep-purple"
                        : "bg-white text-gray-400 border-gray-200"
                  } ${isCurrent ? "ring-4 ring-gold/25" : ""}`}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {done ? "✓" : i + 1}
                </span>
                {!compact && i < ORDER_FLOW.length - 1 && (
                  <span className={`hidden md:block flex-1 h-0.5 rounded ${i < currentIdx && !terminal ? "bg-deep-purple" : "bg-gray-200"}`} />
                )}
              </div>
              <p className={`mt-2 text-[11px] font-bold leading-tight ${done ? "text-deep-purple" : "text-gray-400"}`}>
                {ORDER_FLOW_LABELS[key]}
              </p>
              {timestamps?.[key] && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {new Date(timestamps[key] as string).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </p>
              )}
              {isCurrent && <p className="text-[10px] font-bold text-gold mt-0.5 uppercase tracking-wide">Current</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Star input                                                          */
/* ------------------------------------------------------------------ */

export function Stars({
  value,
  onChange,
  size = 22,
  readonly = false,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  readonly?: boolean;
}) {
  return (
    <div className="flex gap-1" role={readonly ? "img" : "radiogroup"} aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(s)}
          aria-label={`${s} star`}
          className={`${readonly ? "cursor-default" : "cursor-pointer hover:scale-110 transition-transform"}`}
        >
          <svg width={size} height={size} viewBox="0 0 24 24" fill={s <= value ? "#B08A3E" : "none"} stroke={s <= value ? "#B08A3E" : "#CBD5E1"} strokeWidth={1.8}>
            <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm dialog                                                      */
/* ------------------------------------------------------------------ */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-deep-purple/50 backdrop-blur-[2px]" onClick={busy ? undefined : onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="w-11 h-11 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <AlertTriangle size={20} className="text-red-500" />
        </div>
        <h3 className="font-playfair font-bold text-deep-purple text-lg">{title}</h3>
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{message}</p>
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-4 py-2.5 border border-gray-200 hover:bg-gray-50 rounded-lg text-sm font-semibold text-gray-700 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
