import React, { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, ShoppingBag, Heart, ShoppingCart, ShieldAlert } from 'lucide-react'
import { customerService } from '../../services/customerService'
import { orderService } from '../../services/orderService'
import { Customer, CustomerAddress, Order } from '../../types'
import { formatCurrency, formatDate } from '@meruveda/shared'
import { StatusBadge } from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'

export const CustomerProfilePage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [addresses, setAddresses] = useState<CustomerAddress[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [cartItems, setCartItems] = useState<any[]>([])
  const [preferences, setPreferences] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchProfileData = async () => {
      if (!id) return
      setIsLoading(true)
      try {
        const [profile, addrs, allOrders, cart, prefs] = await Promise.all([
          customerService.getCustomerById(id),
          customerService.getCustomerAddresses(id),
          orderService.getOrders(),
          customerService.getCustomerCart(id),
          customerService.getCustomerPreferences(id),
        ])

        setCustomer(profile)
        setAddresses(addrs)
        setCartItems(cart)
        setPreferences(prefs)
        // Filter orders by email/name for this client
        setOrders(allOrders.filter((o) => o.customerId === profile.id))
      } catch (err) {
        toast.error('Customer not found')
        navigate('/customers')
      } finally {
        setIsLoading(false)
      }
    }
    fetchProfileData()
  }, [id, navigate])

  if (isLoading || !customer) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-pulse text-slate-400">Loading customer profile...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex items-center gap-3">
        <Link
          to="/customers"
          className="p-2 bg-white dark:bg-slate-800 border rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="page-title">{customer.name}</h1>
          <p className="text-xs text-slate-400">Joined on {formatDate(customer.createdAt)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Summary details & addresses */}
        <div className="lg:col-span-1 space-y-6">
          {/* Card: Bio */}
          <div className="card p-6 space-y-4">
            <div className="flex flex-col items-center text-center">
              <img
                src={customer.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=1200&h=1200&fit=crop'}
                alt={customer.name}
                className="h-20 w-20 rounded-full object-cover border-2 border-primary-500 shadow-sm"
              />
              <h3 className="font-bold text-lg text-slate-900 dark:text-white mt-3">{customer.name}</h3>
              <p className="text-xs text-slate-400">{customer.email}</p>
              <div className="mt-2.5">
                <StatusBadge status={customer.isBlocked ? 'cancelled' : 'active'} />
              </div>
            </div>

            <div className="border-t dark:border-slate-800 pt-4 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Total Purchase</span>
                <span className="font-bold">{formatCurrency(customer.lifetimeSpend)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Orders completed</span>
                <span className="font-semibold">{customer.totalOrders}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Last Active</span>
                <span className="font-medium text-slate-500">{formatDate(customer.lastLogin)}</span>
              </div>
            </div>
          </div>

          {/* Card: Notification Preferences */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5 font-bold">
              <ShieldAlert className="h-5 w-5 text-slate-400" /> Notification Preferences
            </h3>
            {preferences ? (
              <div className="space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
                <div className="flex justify-between items-center border-b dark:border-slate-800 pb-1.5">
                  <span>SMS Order Alerts</span>
                  <span className={`font-semibold ${preferences.smsOrder ? 'text-green-600' : 'text-slate-400'}`}>
                    {preferences.smsOrder ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b dark:border-slate-800 pb-1.5">
                  <span>WhatsApp Chat Alerts</span>
                  <span className={`font-semibold ${preferences.whatsappAlerts ? 'text-green-600' : 'text-slate-400'}`}>
                    {preferences.whatsappAlerts ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b dark:border-slate-800 pb-1.5">
                  <span>Promotional Offers (Email)</span>
                  <span className={`font-semibold ${preferences.emailPromo ? 'text-green-600' : 'text-slate-400'}`}>
                    {preferences.emailPromo ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Ayurvedic Journal (Email)</span>
                  <span className={`font-semibold ${preferences.emailNewsletter ? 'text-green-600' : 'text-slate-400'}`}>
                    {preferences.emailNewsletter ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">No preference settings recorded yet.</p>
            )}
          </div>

          {/* Card: Addresses */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5">
              <MapPin className="h-5 w-5 text-slate-400" /> Saved Addresses
            </h3>
            <div className="space-y-4">
              {addresses.length === 0 ? (
                <p className="text-xs text-slate-400">No saved addresses on profile.</p>
              ) : (
                addresses.map((addr) => (
                  <div
                    key={addr.id}
                    className="p-3 border rounded-xl bg-slate-5/20 text-xs leading-relaxed relative"
                  >
                    {addr.isDefault && (
                      <span className="absolute top-3 right-3 text-[9px] bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded-md font-bold uppercase">
                        Default
                      </span>
                    )}
                    <p className="font-bold">{addr.fullName}</p>
                    <p>{addr.addressLine1}</p>
                    {addr.addressLine2 && <p>{addr.addressLine2}</p>}
                    <p>
                      {addr.city}, {addr.state} - {addr.pincode}
                    </p>
                    <p>{addr.country}</p>
                    <p className="mt-1 font-semibold text-slate-500">Phone: {addr.phone}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right column: Orders & wishlist highlights */}
        <div className="lg:col-span-2 space-y-6">
          {/* Card: Order History */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5">
              <ShoppingBag className="h-5 w-5 text-slate-400" /> Order History
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b dark:border-slate-800 text-slate-400 text-xs font-semibold">
                    <th className="pb-3">Order Number</th>
                    <th className="pb-3">Date</th>
                    <th className="pb-3">Items Count</th>
                    <th className="pb-3">Grand Total</th>
                    <th className="pb-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  {orders.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-400">
                        No orders recorded for this customer.
                      </td>
                    </tr>
                  ) : (
                    orders.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10">
                        <td className="py-3 font-semibold text-primary-600 dark:text-primary-400">
                          <Link to={`/orders/${o.id}`}>{o.orderNumber}</Link>
                        </td>
                        <td className="py-3 text-xs text-slate-500">{formatDate(o.createdAt)}</td>
                        <td className="py-3">{o.items.reduce((sum: number, item: any) => sum + item.quantity, 0)} items</td>
                        <td className="py-3 font-semibold">{formatCurrency(o.total)}</td>
                        <td className="py-3 text-right">
                          <StatusBadge status={o.status} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cart section */}
          <div className="card p-6 space-y-4">
            <h3 className="section-title flex items-center gap-1.5">
              <ShoppingCart className="h-4.5 w-4.5 text-slate-400" /> Shopping Cart ({cartItems.length} items)
            </h3>
            
            {cartItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-20 text-center text-xs text-slate-400">
                <ShoppingCart className="h-6 w-6 text-slate-300 mb-1" />
                No items currently inside cart.
              </div>
            ) : (
              <div className="space-y-3">
                {cartItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between border-b dark:border-slate-800 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <img
                        src={item.products?.thumbnail || item.products?.images?.[0]?.url || '/images/placeholder-product.png'}
                        alt={item.products?.name}
                        className="h-10 w-10 rounded object-cover"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {item.products?.name}
                        </p>
                        <p className="text-[10px] text-primary-600 font-bold">₹{item.products?.selling_price}</p>
                      </div>
                    </div>
                    <div className="text-xs font-semibold text-slate-500">
                      Qty: {item.quantity}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
export default CustomerProfilePage
