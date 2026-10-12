"use client";

import { useAuth } from "@/context/AuthContext";
import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle,
  Package,
  MapPin,
  Calendar,
  CreditCard,
  Loader2,
  ArrowRight,
  Download,
  ShoppingBag,
} from "lucide-react";
import axiosInstance from "@/api/axiosInstance";
import { useCart } from "@/context/CartContext";

interface OrderDetails {
  id: string;
  order_number: string;
  status: string;
  payment_method: string;
  payment_status: string;
  total: number;
  subtotal: number;
  discount: number;
  shipping_fee: number;
  tax: number;
  created_at: string;
  shipping_address: {
    fullName: string;
    addressLine: string;
    city: string;
    state: string;
    zipCode: string;
    phone: string;
  };
  order_items: Array<{
    id: string;
    product_name: string;
    quantity: number;
    price: number;
    total: number;
    image_url?: string;
  }>;
}

export default function CheckoutSuccessPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { clearCart } = useCart();
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cartCleared, setCartCleared] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      // Order-success links need a session: email login, then back here.
      router.replace(`/login?next=${encodeURIComponent(`/checkout/success/${orderId}`)}`);
    }
  }, [authLoading, user, router, orderId]);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const fetchOrder = async () => {
      if (!orderId) return;
      try {
        const res = await axiosInstance.get(`/orders/${orderId}`);
        const orderData = res.data.data;
        if (cancelled) return;
        setOrder(orderData);

        // Clear cart only once after CONFIRMED payment (processing/paid/COD).
        // Never clear while the order is still pending_payment/pending: a QR
        // payment completed on the phone may still be verifying, and clearing
        // early would strand the checkout if verification fails.
        const isConfirmed =
          orderData.status === "processing" ||
          orderData.payment_status === "paid" ||
          String(orderData.payment_method || "").toLowerCase().includes("cash");
        if (!cartCleared && isConfirmed) {
          await clearCart();
          setCartCleared(true);
        }
        // Payment completed on the phone but the laptop still shows a pending
        // order: keep polling the verified status until PayU's server-side
        // callback confirms (or fails) the payment. Never trust URL params.
        const stillPending =
          orderData.payment_status !== "paid" &&
          orderData.status !== "processing" &&
          !String(orderData.payment_method || "").toLowerCase().includes("cash") &&
          ["pending_payment", "pending", "confirmed"].includes(String(orderData.status));
        if (stillPending && attempts < 40) {
          attempts += 1;
          setTimeout(() => { if (!cancelled) fetchOrder(); }, 3000);
        } else if (!cancelled && (orderData.status === "payment_failed" || orderData.status === "failed")) {
          router.replace(`/checkout/failed?order_id=${orderId}&reason=${encodeURIComponent("Payment was unsuccessful or cancelled.")}`);
        }
      } catch (err: any) {
        if (!cancelled) setError("Unable to load order details.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    if (user) fetchOrder();
    return () => { cancelled = true; };
  }, [orderId, user]);

  if (authLoading || isLoading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4">
        <Loader2 size={40} className="animate-spin text-gold" />
        <p className="text-gray-500 text-sm">Loading your order confirmation...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
        <Package size={48} className="text-gray-300 mb-4" />
        <h2 className="text-xl font-bold text-deep-purple mb-2">Order Not Found</h2>
        <p className="text-gray-500 text-sm mb-6">{error || "We couldn't find this order."}</p>
        <Link href="/account/orders" className="bg-deep-purple text-white px-6 py-3 rounded-xl font-bold text-sm">
          View All Orders
        </Link>
      </div>
    );
  }

  const estimatedDelivery = new Date(order.created_at);
  estimatedDelivery.setDate(estimatedDelivery.getDate() + 5);
  const isPaid = order.status === "processing" || order.payment_status === "paid";
  const isCOD = order.payment_method?.toLowerCase().includes("cash");
  const isPending = !isPaid && !isCOD;

  if (isPending) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-4 p-6 text-center">
        <Loader2 size={40} className="animate-spin text-gold" />
        <h1 className="text-2xl font-playfair font-bold text-deep-purple">Waiting for payment confirmation…</h1>
        <p className="text-gray-500 text-sm max-w-md">
          If you completed the payment on your phone, this page will update automatically once the payment is verified.
          Please do not refresh or close this window.
        </p>
        <p className="text-gold font-bold text-sm">Order #{order.order_number}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ivory/30">
      <div className="container mx-auto px-4 py-12 md:py-20 max-w-3xl">

        {/* Hero Confirmation Banner */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl overflow-hidden mb-8">
          <div className="h-2 bg-gradient-to-r from-gold via-deep-purple to-gold" />
          <div className="p-8 md:p-12 text-center">
            <div className="w-24 h-24 bg-green-50 border border-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
              <CheckCircle size={50} />
            </div>
            <h1 className="text-4xl font-playfair font-bold text-deep-purple mb-2">
              {isCOD ? "Order Placed!" : "Payment Confirmed!"}
            </h1>
            <p className="text-gray-500 text-sm mb-1">
              {isCOD
                ? `Thank you${user?.firstName ? `, ${user.firstName}` : ""}! Your order has been placed successfully.`
                : `Thank you${user?.firstName ? `, ${user.firstName}` : ""}! Your payment was received and your order is being processed.`}
            </p>
            <p className="text-gold font-bold text-sm mt-1">
              Order #{order.order_number}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Delivery Info Card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar size={16} className="text-gold" />
              <h3 className="font-bold text-deep-purple text-sm uppercase tracking-wider">Estimated Delivery</h3>
            </div>
            <p className="text-2xl font-playfair font-bold text-deep-purple">
              {estimatedDelivery.toLocaleDateString("en-IN", { day: "numeric", month: "long" })}
            </p>
            <p className="text-gray-400 text-xs mt-1">{estimatedDelivery.toLocaleDateString("en-IN", { year: "numeric" })}</p>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                {isCOD
                  ? "You'll pay cash when your order arrives."
                  : "Your payment has been confirmed. Fulfillment will begin shortly."}
              </p>
            </div>
          </div>

          {/* Payment Summary Card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard size={16} className="text-gold" />
              <h3 className="font-bold text-deep-purple text-sm uppercase tracking-wider">Payment Summary</h3>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>₹{Number(order.subtotal).toFixed(2)}</span>
              </div>
              {Number(order.discount) > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span>
                  <span>-₹{Number(order.discount).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600">
                <span>Shipping</span>
                <span>{Number(order.shipping_fee) === 0 ? "FREE" : `₹${Number(order.shipping_fee).toFixed(2)}`}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Tax (GST)</span>
                <span>₹{Number(order.tax).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-base text-deep-purple pt-2 border-t border-gray-100">
                <span>Total {isCOD ? "to Pay" : "Paid"}</span>
                <span>₹{Number(order.total).toFixed(2)}</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100">
              <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${
                isCOD 
                  ? "bg-amber-100 text-amber-700"
                  : "bg-green-100 text-green-700"
              }`}>
                {isCOD ? "Cash on Delivery" : "✓ Paid via PayU"}
              </span>
            </div>
          </div>
        </div>

        {/* Shipping Address */}
        {order.shipping_address && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <MapPin size={16} className="text-gold" />
              <h3 className="font-bold text-deep-purple text-sm uppercase tracking-wider">Shipping Address</h3>
            </div>
            <p className="font-bold text-deep-purple">{order.shipping_address.fullName}</p>
            <p className="text-gray-600 text-sm mt-1">{order.shipping_address.addressLine}</p>
            <p className="text-gray-600 text-sm">
              {order.shipping_address.city}, {order.shipping_address.state} — {order.shipping_address.zipCode}
            </p>
            <p className="text-gray-500 text-xs mt-1">📞 {order.shipping_address.phone}</p>
          </div>
        )}

        {/* Order Items */}
        {order.order_items && order.order_items.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Package size={16} className="text-gold" />
              <h3 className="font-bold text-deep-purple text-sm uppercase tracking-wider">Order Items</h3>
            </div>
            <div className="divide-y divide-gray-100">
              {order.order_items.map((item) => (
                <div key={item.id} className="py-3 flex items-center gap-4">
                  <div className="w-12 h-12 bg-ivory rounded-lg flex items-center justify-center font-bold text-gold text-sm shrink-0 border border-gray-100">
                    {item.product_name?.substring(0, 2).toUpperCase() || "MV"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-deep-purple text-sm truncate">{item.product_name}</p>
                    <p className="text-gray-400 text-xs">Qty: {item.quantity}</p>
                  </div>
                  <p className="font-bold text-deep-purple text-sm shrink-0">₹{Number(item.total).toFixed(2)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/account/orders"
            className="bg-deep-purple text-white hover:bg-deep-purple/90 px-8 py-4 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2 shadow-sm"
          >
            <Package size={16} /> View Order History
          </Link>
          <Link
            href="/products"
            className="border-2 border-gold text-gold hover:bg-gold/10 px-8 py-4 rounded-xl font-bold transition-all text-sm flex items-center justify-center gap-2"
          >
            <ShoppingBag size={16} /> Continue Shopping
          </Link>
        </div>

        {/* Help Text */}
        <p className="text-center text-gray-400 text-xs mt-8">
          Questions about your order?{" "}
          <Link href="/contact" className="text-gold hover:underline">Contact support</Link>
        </p>
      </div>
    </div>
  );
}
