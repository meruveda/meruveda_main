"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from './AuthContext';

export type CartItem = {
  id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  gst?: number;
};

type CartContextType = {
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, 'quantity' | 'gst'> & { quantity?: number, gst?: number }) => Promise<void>;
  addToCartGuarded: (item: Omit<CartItem, 'quantity' | 'gst'> & { quantity?: number, gst?: number }, isAuthenticated: boolean, onRedirect: () => void) => Promise<void>;
  removeFromCart: (id: string) => Promise<void>;
  updateQuantity: (id: string, quantity: number) => Promise<void>;
  cartTotal: number;
  cartCount: number;
  clearCart: () => Promise<void>;
  isLoading: boolean;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

import { motion, AnimatePresence } from 'framer-motion';

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ show: boolean, productName: string, productImage?: string } | null>(null);
  const { isAuthenticated } = useAuth();

  const fetchCartVersionRef = useRef(0);

  const invalidateInFlightFetches = () => {
    fetchCartVersionRef.current += 1;
  };

  const fetchCart = async () => {
    const currentFetchVersion = ++fetchCartVersionRef.current;
    if (isAuthenticated) {
      try {
        // A guest cart must survive OTP verification: push everything that was
        // collected while browsing into the account cart, then clear it so the
        // merge can never run twice.
        const rawGuestCart = localStorage.getItem('meruveda_cart');
        if (rawGuestCart) {
          let guestItems: CartItem[] = [];
          try {
            guestItems = JSON.parse(rawGuestCart);
          } catch {
            guestItems = [];
          }
          if (Array.isArray(guestItems) && guestItems.length > 0) {
            for (const item of guestItems) {
              try {
                await axiosInstance.post('/cart', {
                  product_id: item.id,
                  quantity: item.quantity || 1,
                });
              } catch (mergeErr) {
                // Item may already exist server-side — never fail the merge.
                console.error('Failed to merge guest cart item', item.id, mergeErr);
              }
            }
          }
          localStorage.removeItem('meruveda_cart');
        }

        const response = await axiosInstance.get('/cart');
        if (currentFetchVersion < fetchCartVersionRef.current) {
          return;
        }
        const dbCart = response.data.data.map((item: any) => ({
          id: item.product_id, // For UI consistency, we map product_id to id
          cartItemId: item.id, // Keep the actual cart_item PK
          name: item.products?.name,
          price: item.products?.selling_price,
          image: item.products?.images?.[0]?.url || '/images/placeholder.jpg',
          quantity: item.quantity,
          gst: item.products?.seo_metadata?.gst !== undefined 
            ? item.products.seo_metadata.gst 
            : (item.products?.seoMetadata?.gst !== undefined ? item.products.seoMetadata.gst : 18)
        }));
        setCart(dbCart);
      } catch (e) {
        console.error("Failed to fetch cart from DB", e);
      }
    } else {
      const savedCart = localStorage.getItem('meruveda_cart');
      if (savedCart) {
        try {
          setCart(JSON.parse(savedCart));
        } catch (e) {
          console.error("Failed to parse local cart");
        }
      }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCart();
  }, [isAuthenticated]);

  const updateLocalCart = (newCart: CartItem[]) => {
    setCart(newCart);
    if (!isAuthenticated) {
      localStorage.setItem('meruveda_cart', JSON.stringify(newCart));
    }
  };

  const addToCart = async (newItem: Omit<CartItem, 'quantity' | 'gst'> & { quantity?: number, gst?: number }) => {
    const qty = newItem.quantity || 1;
    const originalCart = [...cart];
    invalidateInFlightFetches();
    
    // Optimistic Update
    const existing = cart.find(item => item.id === newItem.id);
    let updatedCart: CartItem[];
    if (existing) {
      updatedCart = cart.map(item =>
        item.id === newItem.id ? { ...item, quantity: item.quantity + qty } : item
      );
    } else {
      updatedCart = [...cart, { ...newItem, quantity: qty } as CartItem];
    }
    setCart(updatedCart);

    // Show beautiful toast notification
    setToast({ show: true, productName: newItem.name, productImage: newItem.image });
    const timer = setTimeout(() => setToast(null), 3000);

    if (isAuthenticated) {
      try {
        await axiosInstance.post('/cart', { product_id: newItem.id, quantity: qty });
        fetchCart(); // Reconcile in background
      } catch (e) {
        console.error("Optimistic add to cart failed, rolling back", e);
        setCart(originalCart);
        clearTimeout(timer);
        setToast(null);
        alert("Failed to add product to cart. Please try again.");
      }
    } else {
      localStorage.setItem('meruveda_cart', JSON.stringify(updatedCart));
    }
  };

  const addToCartGuarded = async (
    item: Omit<CartItem, 'quantity' | 'gst'> & { quantity?: number, gst?: number },
    isAuthenticated: boolean,
    onRedirect: () => void
  ) => {
    // No login required to shop: guests build a localStorage cart which is
    // merged into their account as soon as the OTP at checkout is verified.
    // `onRedirect` is kept in the signature for backwards compatibility but is
    // intentionally not used.
    void isAuthenticated;
    void onRedirect;
    await addToCart(item);
  };

  const removeFromCart = async (id: string) => {
    const originalCart = [...cart];
    invalidateInFlightFetches();
    // Optimistic Update
    setCart(cart.filter(item => item.id !== id));

    if (isAuthenticated) {
      try {
        const item = originalCart.find(c => c.id === id) as any;
        if (item && item.cartItemId) {
          await axiosInstance.delete(`/cart/${item.cartItemId}`);
          fetchCart();
        }
      } catch (e) {
        console.error("Optimistic remove failed, rolling back", e);
        setCart(originalCart);
      }
    } else {
      localStorage.setItem('meruveda_cart', JSON.stringify(cart.filter(item => item.id !== id)));
    }
  };

  const updateQuantity = async (id: string, quantity: number) => {
    if (quantity <= 0) {
      await removeFromCart(id);
      return;
    }

    const originalCart = [...cart];
    invalidateInFlightFetches();
    // Optimistic Update
    setCart(cart.map(item => item.id === id ? { ...item, quantity } : item));

    if (isAuthenticated) {
      try {
        const item = originalCart.find(c => c.id === id) as any;
        if (item && item.cartItemId) {
          await axiosInstance.patch(`/cart/${item.cartItemId}`, { quantity });
          fetchCart();
        }
      } catch (e) {
        console.error("Optimistic update quantity failed, rolling back", e);
        setCart(originalCart);
      }
    } else {
      const updated = cart.map(item => item.id === id ? { ...item, quantity } : item);
      localStorage.setItem('meruveda_cart', JSON.stringify(updated));
    }
  };

  const clearCart = async () => {
    const originalCart = [...cart];
    invalidateInFlightFetches();
    setCart([]);

    if (isAuthenticated) {
      try {
        await axiosInstance.delete('/cart');
        fetchCart();
      } catch (e) {
        console.error("Failed to clear cart", e);
        setCart(originalCart);
      }
    } else {
      localStorage.setItem('meruveda_cart', JSON.stringify([]));
    }
  };

  const cartTotal = cart.reduce((total, item) => total + ((item.price || 0) * (item.quantity || 1)), 0);
  const cartCount = cart.reduce((count, item) => count + (item.quantity || 1), 0);

  return (
    <CartContext.Provider value={{ cart, addToCart, addToCartGuarded, removeFromCart, updateQuantity, cartTotal, cartCount, clearCart, isLoading }}>
      {children}
      
      {/* Premium Confirmation Toast */}
      <AnimatePresence>
        {toast?.show && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="fixed top-20 md:top-24 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:max-w-sm z-[9999] bg-[#2B1820]/95 backdrop-blur-md text-white px-5 py-4 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.3)] border border-[#C09E5A]/20 flex items-center gap-4"
          >
            {toast.productImage && (
              <div className="relative w-12 h-12 bg-white rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center border border-[#C09E5A]/10">
                <img src={toast.productImage} alt={toast.productName} className="w-full h-full object-contain p-1" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-[#C09E5A] font-bold uppercase tracking-[0.15em] mb-0.5">Added to Cart</p>
              <p className="text-xs font-semibold text-white truncate">{toast.productName}</p>
            </div>
            <button 
              onClick={() => setToast(null)} 
              className="text-white/40 hover:text-white transition-colors text-sm font-bold ml-2 p-1 hover:bg-white/5 rounded-full"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
