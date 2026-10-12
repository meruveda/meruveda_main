import React, { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, Truck, FileText, User, ShoppingBag, Trash2 } from 'lucide-react'
import { orderService } from '../../services/orderService'
import { Order, OrderStatus, StoreSettings } from '../../types'
import { formatCurrency, formatDateTime } from '@meruveda/shared'
import { StatusBadge } from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'
import { shiprocketService } from '../../services/shiprocketService'
import { settingsService } from '../../services/settingsService'

// Configurable company header info defaults
export const COMPANY_CONFIG = {
  name: 'MERUVEDA WELLNESS',
  addressLine1: 'Keharsh Enterprises (Sole Proprietorship)',
  addressLine2: 'S/N. 12, Viru City Gym Road, Inside Jalori Gate, Jodhpur - 342001, Rajasthan, India',
  phone: '+91 8097147463',
  email: 'customercare@meruvedawellness.com',
  website: 'meruvedawellness.com',
  gstin: '08BFPPS7045C1Z4'
};

export const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<Order | null>(null)
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Tracking details
  const [trackingNo, setTrackingNo] = useState('')
  const [isUpdatingTracking, setIsUpdatingTracking] = useState(false)

  // Shiprocket states
  const [isGeneratingAwb, setIsGeneratingAwb] = useState(false)
  const [isSchedulingPickup, setIsSchedulingPickup] = useState(false)
  const [isDownloadingLabel, setIsDownloadingLabel] = useState(false)
  const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false)
  const [isResendingInvoice, setIsResendingInvoice] = useState(false)
  const [isRefreshingTracking, setIsRefreshingTracking] = useState(false)
  const [isCancellingOrder, setIsCancellingOrder] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isPushingShiprocket, setIsPushingShiprocket] = useState(false)
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

  const handleDownloadInvoice = async () => {
    if (!order) return;
    // Fixed GST tax invoice (backend pdf-lib template) - same file sent on WhatsApp.
    setIsDownloadingInvoice(true);
    try {
      const token = localStorage.getItem('admin_token') || localStorage.getItem('token') || '';
      const base = (import.meta as any).env?.VITE_API_URL || '/api';
      const res = await fetch(base + '/orders/' + order.id + '/invoice', {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      if (!res.ok) throw new Error('Failed to download invoice');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `Invoice-${(order as any).order_number || order.id}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toast.success('Invoice downloaded');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to download invoice');
    } finally {
      setIsDownloadingInvoice(false);
    }
  }

  const handleResendInvoice = async () => {
    if (!order) return;
    setIsResendingInvoice(true);
    try {
      await orderService.resendInvoice(order.id);
      toast.success('Invoice resent over WhatsApp');
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || err?.message || 'Failed to resend invoice');
    } finally {
      setIsResendingInvoice(false);
    }
  }

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

      try {
        const settingsData = await settingsService.getSettings()
        setStoreSettings(settingsData)
      } catch (settingsErr) {
        console.error('Failed to load store settings', settingsErr)
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

  const handlePrint = () => {
    window.print()
  }

  if (isLoading || !order) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-pulse text-slate-400">Loading order details...</div>
      </div>
    )
  }

  const storeName = storeSettings?.storeName || COMPANY_CONFIG.name;
  const storeAddress = storeSettings?.storeAddress || `${COMPANY_CONFIG.addressLine1}\n${COMPANY_CONFIG.addressLine2}`;
  const storePhone = storeSettings?.storePhone || COMPANY_CONFIG.phone;
  const storeEmail = storeSettings?.storeEmail || COMPANY_CONFIG.email;
  const storeWebsite = storeSettings?.storeWebsite || COMPANY_CONFIG.website;

  return (
    <div className="space-y-6 print:p-0">
      {/* Title block */}
      <div className="flex items-center justify-between print:hidden">
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
            onClick={handlePrint}
            className="btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl"
          >
            <Printer className="h-4 w-4" /> Print Invoice
          </button>
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:hidden">
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
                "{order.notes}"
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
                <StatusBadge status={order.status} />
              </div>

              <div className="space-y-2">
                <label className="label">Update Status</label>
                <select
                  value={order.status}
                  onChange={(e) => handleStatusChange(e.target.value as OrderStatus)}
                  className="input w-full py-2 pr-8 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 capitalize"
                >
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="processing">Processing</option>
                  <option value="shipped">Shipped</option>
                  <option value="delivered">Delivered</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
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
              <p className="text-xs text-slate-500">This order has not been pushed to Shiprocket yet.</p>
              {shiprocketError && (
                <p className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900 rounded-lg p-3">
                  Shiprocket error: {shiprocketError}
                </p>
              )}
              <button
                disabled={isPushingShiprocket}
                className="btn-primary text-xs py-2 justify-center w-full"
                onClick={handlePushToShiprocket}
              >
                {isPushingShiprocket ? 'Pushing...' : 'Push to Shiprocket'}
              </button>
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
                    disabled={isDownloadingInvoice}
                    className="btn-outline text-xs py-1.5 justify-center"
                    onClick={handleDownloadInvoice}
                  >
                    {isDownloadingInvoice ? 'Downloading...' : 'Invoice PDF'}
                  </button>
                  <button
                    disabled={isResendingInvoice}
                    className="btn-outline text-xs py-1.5 justify-center"
                    onClick={handleResendInvoice}
                    title="Resend the PDF invoice over WhatsApp"
                  >
                    {isResendingInvoice ? 'Sending...' : 'Resend Invoice'}
                  </button>
                  <button
                    disabled={!(order as any).awb_code || isRefreshingTracking}
                    className="btn-outline text-xs py-1.5 col-span-2 justify-center"
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

      {/* Print Only Layout */}
      <div className="hidden print:block w-full max-w-4xl mx-auto bg-white text-black font-sans text-sm pb-12 px-6">
        <div className="flex justify-between items-start mb-10 gap-8 border-b pb-6">
          <div className="flex flex-col items-start gap-4 max-w-[55%]">
            <img src="/logo_transparent.png" alt="MeruVeda Wellness Logo" className="h-14 w-auto object-contain" />
            <div>
              <h1 className="text-xl font-bold text-[#2B1820] tracking-wide font-serif">
                {storeName}
              </h1>
              <div className="text-slate-600 text-xs space-y-0.5 mt-1.5 leading-relaxed">
                {storeAddress.split('\n').map((line: string, idx: number) => (
                  <p key={idx}>{line}</p>
                ))}
                <p>Phone: {storePhone} | Email: {storeEmail}</p>
                <p>Website: {storeWebsite}</p>
                {COMPANY_CONFIG.gstin && COMPANY_CONFIG.gstin !== "GSTIN_PENDING" && (
                  <p className="font-semibold text-slate-800">GSTIN: {COMPANY_CONFIG.gstin}</p>
                )}
              </div>
            </div>
          </div>
          <div className="text-right flex-shrink-0 max-w-[40%]">
            <h2 className="text-5xl font-extrabold uppercase mb-4 tracking-wider font-serif" style={{ color: '#C9A227' }}>Invoice</h2>
            <table className="ml-auto text-left border-collapse border border-slate-200 text-xs">
              <tbody>
                <tr>
                  <td className="px-3 py-1.5 border border-slate-200 font-semibold bg-slate-100 uppercase">Date</td>
                  <td className="px-3 py-1.5 border border-slate-200 min-w-[120px] text-right">{new Date(order.createdAt).toLocaleDateString()}</td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5 border border-slate-200 font-semibold bg-slate-100 uppercase">Invoice #</td>
                  <td className="px-3 py-1.5 border border-slate-200 text-right font-mono">{order.orderNumber}</td>
                </tr>
                {(order.awbCode || order.trackingNumber || (order as any).awb_code) ? (
                  <tr>
                    <td className="px-3 py-1.5 border border-slate-200 font-semibold bg-slate-100 uppercase">AWB / Tracking #</td>
                    <td className="px-3 py-1.5 border border-slate-200 text-right font-mono">
                      {order.awbCode || order.trackingNumber || (order as any).awb_code}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <td className="px-3 py-1.5 border border-slate-200 font-semibold bg-slate-100 uppercase">Due Date</td>
                  <td className="px-3 py-1.5 border border-slate-200 text-right">{new Date(order.createdAt).toLocaleDateString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Bill To */}
        <div className="mb-10 w-1/2">
          <h3 className="text-white font-bold uppercase text-xs tracking-wider" style={{ backgroundColor: '#4C1D5B', color: '#FFFFFF', padding: '6px 12px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>Bill To</h3>
          <div className="border border-slate-200 border-t-0 p-3 text-slate-800 text-xs leading-relaxed bg-[#fbfbfc]">
            {((order as any).billingAddress?.fullName || order.shippingAddress?.fullName) ? (
              <>
                <p className="font-bold text-slate-900">{(order as any).billingAddress?.fullName || order.shippingAddress?.fullName}</p>
                <p>{(order as any).billingAddress?.addressLine1 || order.shippingAddress?.addressLine1}</p>
                {((order as any).billingAddress?.addressLine2 || order.shippingAddress?.addressLine2) && (
                  <p>{(order as any).billingAddress?.addressLine2 || order.shippingAddress?.addressLine2}</p>
                )}
                <p>
                  {(order as any).billingAddress?.city || order.shippingAddress?.city},{' '}
                  {(order as any).billingAddress?.state || order.shippingAddress?.state}{' '}
                  {(order as any).billingAddress?.pincode || order.shippingAddress?.pincode}
                </p>
                <p className="font-semibold mt-1">Phone: {(order as any).billingAddress?.phone || order.shippingAddress?.phone}</p>
              </>
            ) : (
              <span className="text-red-500 font-semibold">[Missing Customer Address Data]</span>
            )}
          </div>
        </div>

        {/* Line Items Table */}
        <table className="w-full text-left mb-10 border-collapse border border-slate-200 text-xs">
          <thead>
            <tr style={{ backgroundColor: '#4C1D5B', color: '#FFFFFF', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
              <th className="border border-slate-200" style={{ backgroundColor: '#4C1D5B', color: '#FFFFFF', padding: '6px 12px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>Description</th>
              <th className="border border-slate-200 text-center w-[120px]" style={{ backgroundColor: '#4C1D5B', color: '#FFFFFF', padding: '6px 12px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>SKU</th>
              <th className="border border-slate-200 text-center w-[60px]" style={{ backgroundColor: '#4C1D5B', color: '#FFFFFF', padding: '6px 12px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>Qty</th>
              <th className="border border-slate-200 text-center w-[60px]" style={{ backgroundColor: '#4C1D5B', color: '#FFFFFF', padding: '6px 12px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>Taxed</th>
              <th className="border border-slate-200 text-right w-[120px]" style={{ backgroundColor: '#4C1D5B', color: '#FFFFFF', padding: '6px 12px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {order.items.length > 0 ? (
              order.items.map((item: any, idx: number) => {
                const isEven = idx % 2 !== 0;
                const rowBg = isEven ? '#F5F0F7' : '#FFFFFF';
                return (
                  <tr key={item.id} style={{ backgroundColor: rowBg, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                    <td className="px-4 py-2.5 border border-slate-200 font-medium">
                      {item.productName && item.productName !== 'Unknown Product' ? item.productName : <span className="text-red-500">[Missing Name Data]</span>}
                    </td>
                    <td className="px-4 py-2.5 border border-slate-200 text-center font-mono">{item.sku || <span className="text-red-500">[Missing]</span>}</td>
                    <td className="px-4 py-2.5 border border-slate-200 text-center">{item.quantity}</td>
                    <td className="px-4 py-2.5 border border-slate-200 text-center">X</td>
                    <td className="px-4 py-2.5 border border-slate-200 text-right font-mono">{formatCurrency(item.price * item.quantity)}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-6 border border-slate-200 text-center text-red-500 font-semibold bg-white">[No Items Found]</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Footer grid */}
        <div className="grid grid-cols-2 gap-8 mb-12">
          {/* Comments */}
          <div>
            <h3 className="text-white font-bold uppercase text-xs tracking-wider" style={{ backgroundColor: '#4C1D5B', color: '#FFFFFF', padding: '6px 12px', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>Other Comments & Notes</h3>
            <div className="border border-slate-200 border-t-0 p-3 min-h-[120px] text-xs text-slate-700 leading-relaxed bg-[#fbfbfc]">
              {order.notes ? (
                <div className="mb-4 p-2 bg-amber-50 border border-amber-200 rounded text-amber-900 italic font-sans">
                  <strong>Customer Note:</strong> "{order.notes}"
                </div>
              ) : null}
              <p>1. Total payment due upon receipt.</p>
              <p>2. Please include the invoice number with your payment.</p>
              <p className="mt-2 text-xs font-semibold text-slate-500 uppercase">Payment Details:</p>
              <p>Method: {order.paymentMethod}</p>
            </div>
          </div>

          {/* Calculations */}
          <div>
            <table className="w-full text-left border-collapse border border-slate-200 text-xs">
              <tbody>
                <tr className="bg-white">
                  <td className="px-4 py-2 border border-slate-200 text-right font-semibold text-slate-700">Subtotal</td>
                  <td className="px-4 py-2 border border-slate-200 text-right font-mono min-w-[120px]">{formatCurrency(order.subtotal)}</td>
                </tr>
                {order.discount > 0 && (
                  <tr className="bg-white">
                    <td className="px-4 py-2 border border-slate-200 text-right font-semibold text-red-600">Discount</td>
                    <td className="px-4 py-2 border border-slate-200 text-right font-mono text-red-600">-{formatCurrency(order.discount)}</td>
                  </tr>
                )}
                <tr className="bg-white">
                  <td className="px-4 py-2 border border-slate-200 text-right font-semibold text-slate-700">Taxable</td>
                  <td className="px-4 py-2 border border-slate-200 text-right font-mono">{formatCurrency(order.subtotal - order.discount)}</td>
                </tr>
                {(() => {
                  const state = order.shippingAddress?.state || '';
                  const s = state.trim().toLowerCase();
                  const validMatches = ['rajasthan', 'rj', 'rajsthan', 'rajasthn', 'rajastan', 'rajasthna', 'rajastran', 'raj'];
                  const isIntraState = validMatches.includes(s) || (s.startsWith('raj') && s.length >= 5);

                  if (isIntraState) {
                    return (
                      <>
                        <tr className="bg-white">
                          <td className="px-4 py-2 border border-slate-200 text-right font-semibold text-slate-700">CGST (Included)</td>
                          <td className="px-4 py-2 border border-slate-200 text-right font-mono">{formatCurrency(order.tax / 2)}</td>
                        </tr>
                        <tr className="bg-white">
                          <td className="px-4 py-2 border border-slate-200 text-right font-semibold text-slate-700">SGST (Included)</td>
                          <td className="px-4 py-2 border border-slate-200 text-right font-mono">{formatCurrency(order.tax / 2)}</td>
                        </tr>
                      </>
                    );
                  } else {
                    return (
                      <tr className="bg-white">
                        <td className="px-4 py-2 border border-slate-200 text-right font-semibold text-slate-700">IGST (Included)</td>
                        <td className="px-4 py-2 border border-slate-200 text-right font-mono">{formatCurrency(order.tax)}</td>
                      </tr>
                    );
                  }
                })()}
                <tr className="bg-white">
                  <td className="px-4 py-2 border border-slate-200 text-right font-semibold text-slate-700">Shipping</td>
                  <td className="px-4 py-2 border border-slate-200 text-right font-mono">{order.shippingCharge === 0 ? 'FREE' : formatCurrency(order.shippingCharge)}</td>
                </tr>
                <tr className="bg-slate-100 font-bold text-sm">
                  <td className="px-4 py-2.5 border border-slate-200 text-right uppercase text-slate-900">TOTAL</td>
                  <td className="px-4 py-2.5 border border-slate-200 text-right font-mono text-slate-900">{formatCurrency(order.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Thank You Note */}
        <div className="text-center mt-12 font-medium italic text-slate-700 space-y-1">
          <p>If you have any questions about this invoice, please contact</p>
          <p className="text-slate-900 not-italic font-semibold">{storeEmail}</p>
          <p className="text-lg mt-4 text-[#2B1820] font-bold not-italic font-serif">Thank You For Your Business!</p>
        </div>
      </div>
    </div>
  )
}
export default OrderDetailPage
