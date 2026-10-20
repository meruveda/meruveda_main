import React, { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Truck, FileText, User, ShoppingBag, Trash2, Clock } from 'lucide-react'
import { orderService, toneClass } from '../../services/orderService'
import { Order, OrderStatus } from '../../types'
import { formatCurrency, formatDateTime } from '@meruveda/shared'
import { StatusBadge } from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'
import { shiprocketService } from '../../services/shiprocketService'

export const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<Order | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Tracking details
  const [trackingNo, setTrackingNo] = useState('')
  const [isUpdatingTracking, setIsUpdatingTracking] = useState(false)

  // Shiprocket states
  const [isGeneratingAwb, setIsGeneratingAwb] = useState(false)
  const [isSchedulingPickup, setIsSchedulingPickup] = useState(false)
  const [isDownloadingLabel, setIsDownloadingLabel] = useState(false)
  const [isViewingInvoice, setIsViewingInvoice] = useState(false)
  const [isRefreshingTracking, setIsRefreshingTracking] = useState(false)
  const [isCancellingOrder, setIsCancellingOrder] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPushingShiprocket, setIsPushingShiprocket] = useState(false)
  const [isResendingInvoice, setIsResendingInvoice] = useState(false)
  // Last push failure, kept visible so a failed auto-push is diagnosable and
  // retryable instead of failing silently (backend logs carry the details).
  const [shiprocketError, setShiprocketError] = useState<string | null>(null)

  const handlePushToShiprocket = async () => {
    if (!order) return;
    setIsPushingShiprocket(true);
    setShiprocketError(null);
    try {
      await shiprocketService.pushOrderToShiprocket(order.id);
      toast.success('Order pushed to Shiprocket');
      fetchOrderDetail();
    } catch (err: any) {
      const message = err.response?.data?.error?.message || err.message || 'Failed to push to Shiprocket';
      setShiprocketError(message);
      toast.error(message);
    } finally {
      setIsPushingShiprocket(false);
    }
  };

  /**
   * Resend a FAILED invoice.
   *
   * The invoice document itself is never re-rendered — the same PDF that was
   * generated is re-delivered, so the GST series stays sound.
   */
  const handleResendInvoice = async () => {
    if (!order) return;
    setIsResendingInvoice(true);
    try {
      await orderService.resendInvoice(order.id);
      toast.success('Invoice queued for delivery');
      fetchOrderDetail();
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || err.message || 'Failed to resend the invoice');
    } finally {
      setIsResendingInvoice(false);
    }
  };

  const handleGenerateAwb = async () => {
    const shipmentId = (order as any)?.shipment_id || order?.shipmentId;
    if (!shipmentId) return;
    setIsGeneratingAwb(true);
    try {
      const response = await shiprocketService.generateAwb(shipmentId);
      if (response.success) {
        toast.success('AWB generated successfully');
        fetchOrderDetail();
      } else {
        toast.error(response.message || 'Failed to generate AWB');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Failed to generate AWB');
    } finally {
      setIsGeneratingAwb(false);
    }
  }

  const handleSchedulePickup = async () => {
    const shipmentId = (order as any)?.shipment_id || order?.shipmentId;
    if (!shipmentId) return;
    setIsSchedulingPickup(true);
    try {
      const response = await shiprocketService.schedulePickup(shipmentId);
      if (response.success) {
        toast.success('Pickup scheduled successfully');
        fetchOrderDetail();
      } else {
        toast.error(response.message || 'Failed to schedule pickup');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Failed to schedule pickup');
    } finally {
      setIsSchedulingPickup(false);
    }
  }

  const handleDownloadLabel = async () => {
    const shipmentId = (order as any)?.shipment_id || order?.shipmentId;
    if (!shipmentId) return;
    setIsDownloadingLabel(true);
    try {
      const response = await shiprocketService.getLabel(shipmentId);
      const labelUrl = response?.data?.label_url || response?.data?.response?.data?.label_url;
      if (labelUrl) {
        window.open(labelUrl, '_blank');
        toast.success('Label opened in new tab');
      } else {
        toast.error('Label URL not found in response');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Failed to download label');
    } finally {
      setIsDownloadingLabel(false);
    }
  }

  /**
   * Fetch the stored invoice through the same authenticated endpoint the
   * customer uses. One template everywhere: this is the exact file that went out
   * on WhatsApp and email, never a re-render.
   */
  const handleViewInvoice = async (orderId: string) => {
    setIsViewingInvoice(true);
    try {
      await orderService.downloadInvoice(orderId, order?.invoiceNumber, order?.orderNumber);
    } catch (err: any) {
      // Errors come back as JSON while we asked for a blob, so the message has
      // to be read out of the blob before it can be shown.
      let message = err?.message || 'Failed to load the invoice';
      const body = err?.response?.data;
      if (typeof Blob !== 'undefined' && body instanceof Blob) {
        try {
          const parsed = JSON.parse(await body.text());
          if (parsed?.error?.message) message = parsed.error.message;
        } catch {
          /* not JSON — keep the generic message */
        }
      } else if (body?.error?.message) {
        message = body.error.message;
      }
      toast.error(message);
    } finally {
      setIsViewingInvoice(false);
    }
  };

  const handleRefreshTracking = async () => {
    const awbCode = (order as any)?.awb_code || order?.awbCode;
    if (!awbCode) return;
    setIsRefreshingTracking(true);
    try {
      const response = await shiprocketService.trackShipment(awbCode);
      if (response.success) {
        toast.success('Tracking data refreshed');
        fetchOrderDetail();
      } else {
        toast.error('Failed to refresh tracking');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Failed to refresh tracking');
    } finally {
      setIsRefreshingTracking(false);
    }
  }

  const handleCancelShipment = async () => {
    if (!order) return;
    if (!window.confirm('Are you sure you want to cancel this order both locally and on Shiprocket?')) return;
    setIsCancellingOrder(true);
    try {
      const response = await shiprocketService.cancelOrder(order.id);
      if (response.success) {
        toast.success('Shipment cancelled successfully');
        fetchOrderDetail();
      } else {
        toast.error(response.message || 'Failed to cancel shipment');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Failed to cancel shipment');
    } finally {
      setIsCancellingOrder(false);
    }
  }

  const handleDeleteOrder = async () => {
    if (!order) return
    if (!window.confirm('Are you sure you want to permanently delete this order? This action cannot be undone and will delete it for both the admin and the customer.')) return
    setIsDeleting(true)
    try {
      await orderService.deleteOrder(order.id)
      toast.success('Order deleted successfully')
      navigate('/orders')
    } catch (err: any) {
      toast.error(err.response?.data?.message || err.message || 'Failed to delete order')
    } finally {
      setIsDeleting(false)
    }
  }

  const fetchOrderDetail = async () => {
    if (!id) return
    setIsLoading(true)
    try {
      const data = await orderService.getOrderById(id)
      setOrder(data)
      setTrackingNo(data.trackingNumber || '')

      // Invoice state lives in Storage, not on the order row, so the detail
      // page is the one place it can be read. Read-only: this never sends.
      try {
        const inv = await orderService.getInvoiceStatus(id)
        setOrder((prev) => prev && ({
          ...prev,
          invoiceNumber: inv.invoiceNumber,
          invoiceIssuedAt: inv.issuedAt,
          invoiceUrl: inv.invoiceUrl,
          invoiceSentAt: inv.sentAt,
          invoiceError: inv.error,
          invoiceAttempts: inv.attempts,
          invoiceWhatsappStatus: inv.whatsapp,
          invoiceStatus: inv.status,
        }))
      } catch {
        // A status read must never break the order page. A missing state.json
        // simply leaves the card on "Pending".
      }
    } catch (err) {
      toast.error('Order not found')
      navigate('/orders')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchOrderDetail()
  }, [id])

  const handleStatusChange = async (newStatus: OrderStatus) => {
    if (!order) return
    try {
      await orderService.updateOrderStatus(order.id, newStatus)
      toast.success(`Fulfillment updated to ${newStatus}`)
      fetchOrderDetail()
    } catch (err) {
      toast.error('Failed to update status')
    }
  }

  const handleTrackingSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!order || !trackingNo) return
    setIsUpdatingTracking(true)
    try {
      await orderService.updateTrackingNumber(order.id, trackingNo)
      toast.success('Tracking number saved. Order marked as Shipped!')
      fetchOrderDetail()
    } catch (err) {
      toast.error('Failed to update tracking')
    } finally {
      setIsUpdatingTracking(false)
    }
  }

  if (isLoading || !order) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-pulse text-slate-400">Loading order details...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Title block */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/orders"
            className="p-2 bg-white dark:bg-slate-800 border rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="page-title">{order.orderNumber}</h1>
            <p className="text-xs text-slate-500">Ordered on {formatDateTime(order.createdAt)}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleDeleteOrder}
            disabled={isDeleting}
            className="btn-danger inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
          >
            <Trash2 className="h-4 w-4" /> Delete Order
          </button>
        </div>
      </div>

      {/* Screen layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Items */}
        <div className="lg:col-span-2 space-y-6">
          {/* Card: Items listing */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5">
              <ShoppingBag className="h-5 w-5 text-slate-400" /> Order Items ({order.items.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b dark:border-slate-800 text-slate-400 text-xs font-semibold">
                    <th className="pb-3">Product Description</th>
                    <th className="pb-3">SKU</th>
                    <th className="pb-3 text-center">Qty</th>
                    <th className="pb-3 text-right">Price</th>
                    <th className="pb-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {order.items.map((item: any) => (
                    <tr key={item.id}>
                      <td className="py-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={item.thumbnail || item.image_url || "/images/placeholder-product.png"}
                            alt={item.productName}
                            className="h-10 w-10 rounded-lg object-cover border"
                            onError={(e) => { e.currentTarget.src = "/images/placeholder-product.png" }}
                          />
                          <span className="font-semibold">{item.productName}</span>
                        </div>
                      </td>
                      <td className="py-4 font-mono text-xs">{item.sku}</td>
                      <td className="py-4 text-center">{item.quantity}</td>
                      <td className="py-4 text-right">{formatCurrency(item.price)}</td>
                      <td className="py-4 text-right font-semibold">
                        {formatCurrency(item.price * item.quantity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Calculations pricing breakdown */}
            <div className="border-t dark:border-slate-800 pt-4 flex justify-end">
              <div className="w-64 space-y-2 text-sm">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal</span>
                  <span>{formatCurrency(order.subtotal)}</span>
                </div>
                {order.discount > 0 && (
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>Coupon Discount</span>
                    <span>-{formatCurrency(order.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-500">
                  <span>Shipping Charges</span>
                  <span>{order.shippingCharge === 0 ? 'FREE' : formatCurrency(order.shippingCharge)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>GST Taxes</span>
                  <span>{formatCurrency(order.tax)}</span>
                </div>
                <div className="border-t dark:border-slate-800 pt-2 flex justify-between font-bold text-base text-slate-900 dark:text-white">
                  <span>Grand Total</span>
                  <span>{formatCurrency(order.total)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card: Order Notes */}
          {order.notes && (
            <div className="card p-6 space-y-2 bg-amber-50/20 dark:bg-amber-950/10 border-amber-100 dark:border-amber-900/30">
              <h3 className="section-title text-amber-800 dark:text-amber-400 flex items-center gap-1.5 font-bold">
                <FileText className="h-5 w-5 text-amber-500" /> Customer Order Notes
              </h3>
              <p className="text-sm text-slate-700 dark:text-slate-350 italic whitespace-pre-wrap">
&ldquo;{order.notes}&rdquo;
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Customer information & status controls */}
        <div className="space-y-6">

          {/* Order Status Update card */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5 font-bold">
              <ShoppingBag className="h-5 w-5 text-slate-400" /> Order Status
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 text-sm">Current Status</span>
                <span
                  title="Fulfilment state"
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-semibold ${
                    toneClass(order.automation?.fulfilment?.tone)
                  }`}
                >
                  {order.automation?.fulfilment?.label || order.status}
                </span>
              </div>

              <div className="space-y-2">
                <label className="label">Update Status</label>
                <select
                  value={order.status}
                  onChange={(e) => handleStatusChange(e.target.value as OrderStatus)}
                  className="input w-full py-2 pr-8 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 capitalize"
                >
                  <option value="pending">Pending</option>
                  <option value="processing">Processing</option>
                  <option value="shipped">Shipped</option>
                  <option value="delivered">Delivered</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="returned">Returned</option>
                </select>
              </div>
            </div>
          </div>

          {/* Order timeline: every step of the pipeline in the order it
              happened. Failures are red, so a broken order is obvious. */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5 font-bold">
              <Clock className="h-5 w-5 text-slate-400" /> Order Timeline
            </h3>
            {order.orderTrackingHistory && order.orderTrackingHistory.length > 0 ? (
              <ol className="space-y-3">
                {order.orderTrackingHistory.map((event: any, index: number) => {
                  const activity = String(event.activity || event.tracking_status || '');
                  const isFailure = /fail|error|skip|cancel/i.test(activity);
                  return (
                    <li key={event.id || index} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${
                            isFailure ? 'bg-red-500' : 'bg-emerald-500'
                          }`}
                        />
                        {index < (order.orderTrackingHistory?.length || 0) - 1 && (
                          <span className="w-px flex-1 bg-slate-200 dark:bg-slate-700 my-1" />
                        )}
                      </div>
                      <div className="pb-1 min-w-0">
                        <p
                          className={`text-sm font-semibold ${
                            isFailure ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {activity}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {formatDateTime(event.created_at)}
                          {event.location ? ` · ${event.location}` : ''}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-xs text-slate-400">
                No timeline events recorded for this order yet.
              </p>
            )}
          </div>

          {/* Invoice card — READ ONLY.
              One invoice, one template, everywhere: the PDF rendered by the
              backend generator is what goes out on WhatsApp, what the customer
              downloads, and what is linked here. Delivery is automatic — it
              fires at order creation for every order — with a sweep retrying
              failures, so there is deliberately no Send / Resend / Download
              button: a manual trigger is a second way to deliver the same tax
              document, and the once-only claim is what keeps the GST series
              sound. */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5 font-bold">
              <FileText className="h-5 w-5 text-slate-400" /> Invoice
              <span className="ml-auto text-[10px] font-normal uppercase tracking-wide text-slate-400">
                Automatic
              </span>
            </h3>
            <div className="space-y-3 text-sm">
              {(() => {
                // The backend owns the label; the admin only colours it.
                const automation = order.automation?.invoice
                const status = order.invoiceStatus || 'pending'
                const styles: Record<string, string> = {
                  sent: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-900/50',
                  failed: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50',
                  pending: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50',
                }
                const label = automation?.label
                  || (status === 'sent' ? 'Sent' : status === 'failed' ? 'Failed' : 'Pending')
                const whatsapp = order.invoiceWhatsappStatus
                const whatsappStyles: Record<string, string> = {
                  sent: 'text-green-600',
                  failed: 'text-red-600',
                }
                // "Not configured" is a normal state, not a failure: Meta is not
                // active yet, so WhatsApp was skipped quietly and the invoice
                // was still issued and is still downloadable.
                const whatsappLabel: Record<string, string> = {
                  sent: 'Sent',
                  failed: 'Failed',
                  pending: 'Pending',
                  not_configured: 'Not configured',
                  awaiting_template: 'Awaiting template approval',
                }

                return (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Status</span>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[11px] font-semibold ${
                          automation ? toneClass(automation.tone) : (styles[status] || styles.pending)
                        }`}
                      >
                        {label}
                      </span>
                    </div>

                    {order.invoiceNumber && (
                      <div className="flex justify-between items-center gap-3">
                        <span className="text-slate-500">Invoice #</span>
                        <span className="font-semibold font-mono text-right break-all">
                          {order.invoiceNumber}
                        </span>
                      </div>
                    )}

                    {status === 'sent' && order.invoiceSentAt && (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Sent at</span>
                        <span className="font-semibold">{formatDateTime(order.invoiceSentAt)}</span>
                      </div>
                    )}

                    {whatsapp && (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">WhatsApp</span>
                        <span
                          className={`font-semibold ${
                            whatsappStyles[whatsapp] || 'text-slate-500'
                          }`}
                        >
                          {whatsappLabel[whatsapp] || whatsapp}
                        </span>
                      </div>
                    )}

                    {order.invoiceEmailStatus && (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Email</span>
                        <span className="font-semibold capitalize">{order.invoiceEmailStatus}</span>
                      </div>
                    )}

                    {!!order.invoiceAttempts && order.invoiceAttempts > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Attempts</span>
                        <span className="font-semibold">
                          {order.invoiceAttempts} of {order.invoiceMaxAttempts ?? 5}
                        </span>
                      </div>
                    )}

                    {status === 'failed' && order.invoiceError && (
                      <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900 rounded-lg p-3">
                        <span className="font-semibold">Reason: </span>
                        {order.invoiceError}
                        <p className="mt-1 text-red-500/80">Retrying automatically. No action needed.</p>
                      </div>
                    )}

                    {status === 'pending' && !order.invoiceError && (
                      <p className="text-xs text-slate-400">
                        Issued automatically when the order is placed, for every order.
                      </p>
                    )}

                    {/* Same stored file the customer and WhatsApp received. A link, not a
                        button: fetching it is a read, and the invoice is never
                        re-rendered because a link was followed. It is available as
                        soon as the invoice exists — the customer can download it
                        even while the WhatsApp template is still pending. */}
                    {(order.invoiceNumber || order.invoiceUrl) && (
                      <div className="text-xs pt-1">
                        <span className="text-slate-500">PDF: </span>
                        <button
                          type="button"
                          onClick={() => handleViewInvoice(order.id)}
                          className="text-deep-purple hover:underline font-semibold"
                        >
                          Download invoice
                        </button>
                        {order.invoiceUrl && (
                          <span className="font-mono text-slate-500 break-all"> {order.invoiceUrl}</span>
                        )}
                      </div>
                    )}

                    {/* Resend is offered ONLY when the invoice actually failed.
                        A successful invoice is never re-sent (one tax document
                        per order), and a pending one needs no nudge — the sweep
                        sends it the moment the template is approved. */}
                    {status === 'failed' && (
                      <button
                        type="button"
                        onClick={handleResendInvoice}
                        disabled={isResendingInvoice}
                        className="btn-secondary text-xs py-2 justify-center w-full"
                      >
                        {isResendingInvoice ? 'Sending…' : 'Resend invoice'}
                      </button>
                    )}
                  </>
                )
              })()}
            </div>
          </div>

          {/* Logistics tracking */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5">
              <Truck className="h-5 w-5 text-slate-400" /> Logistics Tracking
            </h3>
            <form onSubmit={handleTrackingSubmit} className="space-y-3">
              <div>
                <label className="label">Tracking / AWB Number</label>
                <input
                  type="text"
                  value={trackingNo}
                  onChange={(e) => setTrackingNo(e.target.value)}
                  placeholder="e.g. DEL-29183-IND"
                  className="input"
                />
              </div>
              <button type="submit" disabled={isUpdatingTracking} className="btn-primary w-full justify-center text-xs">
                {isUpdatingTracking ? 'Saving...' : 'Update Tracking Info'}
              </button>
            </form>
          </div>

          {!((order as any).shiprocket_order_id || (order as any).shipment_id) && (
            <div className="card p-6 space-y-4">
              <h3 className="section-title flex items-center gap-1.5">
                <Truck className="h-5 w-5 text-slate-400" /> Shiprocket Logistics
              </h3>
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500">Push status</span>
                {(() => {
                  const auto = order.automation?.shiprocket
                  if (auto?.label) {
                    return (
                      <span
                        title={auto.nextAttemptAt ? `Next automatic retry: ${auto.nextAttemptAt}` : auto.reason}
                        className={`inline-flex items-center px-2 py-0.5 rounded-lg border text-[11px] font-semibold ${toneClass(auto.tone)}`}
                      >
                        {auto.label}
                      </span>
                    )
                  }
                  const failed = !!(order.shiprocketPushError || order.shiprocketPushStatus === 'failed')
                  return (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-lg border font-semibold ${
                        failed
                          ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/50'
                          : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/50'
                      }`}
                    >
                      {failed ? 'Failed' : order.shiprocketPushStatus === 'in_progress' ? 'In progress' : 'Queued'}
                    </span>
                  )
                })()}
              </div>
              <p className="text-xs text-slate-500">
                {order.automation?.shiprocket?.tone === 'muted'
                  ? 'This order is not pushed to Shiprocket automatically.'
                  : 'This order has not been pushed to Shiprocket yet.'}
              </p>
              {(shiprocketError || order.shiprocketPushError) && (
                <p className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900 rounded-lg p-3">
                  Shiprocket error: {shiprocketError || order.shiprocketPushError}
                </p>
              )}
              {/* The push is automatic. A manual trigger is only offered when the
                  automatic push actually failed, and it is deliberately small —
                  the normal path never shows it. */}
              {(order.automation?.shiprocket?.tone === 'error' || order.shiprocketPushError) && (
                <button
                  disabled={isPushingShiprocket || order.shiprocketPushStatus === 'in_progress'}
                  className="btn-secondary text-xs py-1.5 px-3 justify-center w-fit"
                  onClick={handlePushToShiprocket}
                >
                  {isPushingShiprocket ? 'Pushing…' : 'Retry now'}
                </button>
              )}
            </div>
          )}

          {/* Shiprocket Panel */}
          {((order as any).shiprocket_order_id || (order as any).shipment_id) && (
            <div className="card p-6 space-y-4">
              <h3 className="section-title flex items-center gap-1.5">
                <Truck className="h-5 w-5 text-slate-400" /> Shiprocket Logistics
              </h3>
              <div className="space-y-4 text-sm">
                <div className="flex justify-between border-b dark:border-slate-800 pb-2">
                  <span className="text-slate-500">Order ID</span>
                  <span className="font-mono text-xs font-semibold">{order.shiprocketOrderId || (order as any).shiprocket_order_id}</span>
                </div>
                <div className="flex justify-between border-b dark:border-slate-800 pb-2">
                  <span className="text-slate-500">Shipment ID</span>
                  <span className="font-mono text-xs font-semibold">{order.shipmentId || (order as any).shipment_id}</span>
                </div>
                <div className="flex justify-between border-b dark:border-slate-800 pb-2">
                  <span className="text-slate-500">AWB Code</span>
                  <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                    {(order as any).awb_code || 'Not Assigned'}
                  </span>
                </div>
                <div className="flex justify-between border-b dark:border-slate-800 pb-2">
                  <span className="text-slate-500">Courier Partner</span>
                  <span className="font-semibold">{(order as any).courier_name || 'Not Assigned'}</span>
                </div>
                <div className="flex justify-between border-b dark:border-slate-800 pb-2">
                  <span className="text-slate-500">Pickup Status</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {(order as any).pickup_status || 'Pending Schedule'}
                  </span>
                </div>
                {((order as any).estimated_delivery) && (
                  <div className="flex justify-between border-b dark:border-slate-800 pb-2">
                    <span className="text-slate-500">Est. Delivery</span>
                    <span className="font-semibold text-blue-600">{(order as any).estimated_delivery}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Logistics Status</span>
                  <span className="font-bold text-primary-600">{(order as any).tracking_status || 'NEW'}</span>
                </div>

                {/* Actions Grid */}
                <div className="pt-3 grid grid-cols-2 gap-2 border-t dark:border-slate-800">
                  <button
                    disabled={!!(order as any).awb_code || isGeneratingAwb}
                    className="btn-outline text-xs py-1.5 justify-center"
                    onClick={handleGenerateAwb}
                  >
                    {isGeneratingAwb ? 'Generating...' : 'Generate AWB'}
                  </button>
                  <button
                    disabled={!(order as any).awb_code || (order as any).pickup_status === 'SCHEDULED' || isSchedulingPickup}
                    className="btn-outline text-xs py-1.5 justify-center"
                    onClick={handleSchedulePickup}
                  >
                    {isSchedulingPickup ? 'Scheduling...' : 'Schedule Pickup'}
                  </button>
                  <button
                    disabled={!(order as any).awb_code || isDownloadingLabel}
                    className="btn-outline text-xs py-1.5 justify-center"
                    onClick={handleDownloadLabel}
                  >
                    {isDownloadingLabel ? 'Downloading...' : 'Print Label'}
                  </button>
                  <button
                    disabled={!(order as any).awb_code || isRefreshingTracking}
                    className="btn-outline text-xs py-1.5 justify-center"
                    onClick={handleRefreshTracking}
                  >
                    {isRefreshingTracking ? 'Refreshing...' : 'Refresh Tracking'}
                  </button>
                  <button
                    disabled={(order.status as string) === 'Cancelled' || (order.status as string) === 'Delivered' || isCancellingOrder}
                    className="btn-danger-outline text-xs py-1.5 col-span-2 justify-center mt-1"
                    onClick={handleCancelShipment}
                  >
                    {isCancellingOrder ? 'Cancelling...' : 'Cancel Shipment'}
                  </button>
                </div>

                {/* Timeline */}
                {(order as any).order_tracking_history && (order as any).order_tracking_history.length > 0 && (
                  <div className="pt-4 border-t dark:border-slate-800">
                    <h4 className="font-semibold text-xs text-slate-400 uppercase tracking-wider mb-3">Shipment Timeline</h4>
                    <div className="relative border-l border-slate-200 dark:border-slate-700 pl-4 space-y-4 ml-1">
                      {[...(order as any).order_tracking_history]
                        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) // Show newest first in timeline
                        .map((step: any) => (
                          <div key={step.id} className="relative">
                            <span className="absolute -left-[21px] top-1.5 bg-primary-600 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-slate-900" />
                            <div className="text-xs">
                              <p className="font-semibold text-slate-900 dark:text-white">{step.activity}</p>
                              {step.location && <p className="text-slate-400 text-[10px]">Location: {step.location}</p>}
                              <p className="text-[10px] text-slate-400">{formatDateTime(step.created_at)}</p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Customer profiles */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5">
              <User className="h-5 w-5 text-slate-400" /> Customer Information
            </h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{order.customerName}</p>
                <p className="text-xs text-slate-400">{order.customerEmail}</p>
                <p className="text-xs text-slate-400">{order.customerPhone}</p>
              </div>

              <div className="border-t dark:border-slate-800 pt-3">
                <span className="text-xs font-semibold text-slate-400 uppercase">Shipping Address</span>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-350 leading-relaxed">
                  <p className="font-semibold">{order.shippingAddress.fullName}</p>
                  <p>{order.shippingAddress.addressLine1}</p>
                  {order.shippingAddress.addressLine2 && <p>{order.shippingAddress.addressLine2}</p>}
                  <p>
                    {order.shippingAddress.city}, {order.shippingAddress.state} - {order.shippingAddress.pincode}
                  </p>
                  <p>{order.shippingAddress.country}</p>
                  <p className="mt-1 font-semibold">Phone: {order.shippingAddress.phone}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
export default OrderDetailPage
