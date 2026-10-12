"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import axiosInstance from '../api/axiosInstance';
import { useAuth } from './AuthContext';

export type WishlistItem = {
  id: string;
  name: string;
  price: number;
  image: string;
  category?: string;
};

type WishlistContextType = {
  wishlist: WishlistItem[];
  addToWishlist: (item: WishlistItem) => Promise<void>;
  removeFromWishlist: (id: string) => Promise<void>;
  isInWishlist: (id: string) => boolean;
  toggleWishlist: (item: WishlistItem) => Promise<void>;
  toggleWishlistGuarded: (item: WishlistItem, isAuthenticated: boolean, onRedirect: () => void) => Promise<void>;
  clearWishlist: () => void;
  isLoading: boolean;
  wishlistCount: number;
};

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { isAuthenticated } = useAuth();

  const fetchWishlist = async () => {
    if (isAuthenticated) {
      try {
        const response = await axiosInstance.get('/wishlist');
        const dbWishlist = response.data.data.map((item: any) => ({
          id: item.product_id,
          wishlistItemId: item.id,
          name: item.products?.name,
          price: item.products?.selling_price,
          image: item.products?.images?.[0]?.url || '/images/placeholder.jpg',
        }));
        setWishlist(dbWishlist);
      } catch (e) {
        console.error("Failed to fetch wishlist from DB", e);
      }
    } else {
      const savedWishlist = localStorage.getItem('meruveda_wishlist');
      if (savedWishlist) {
        try {
          setWishlist(JSON.parse(savedWishlist));
        } catch (e) {
          console.error("Failed to parse local wishlist");
        }
      }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchWishlist();
  }, [isAuthenticated]);

  const updateLocalWishlist = (newList: WishlistItem[]) => {
    setWishlist(newList);
    if (!isAuthenticated) {
      localStorage.setItem('meruveda_wishlist', JSON.stringify(newList));
    }
  };

  const addToWishlist = async (newItem: WishlistItem) => {
    if (isAuthenticated) {
      try {
        await axiosInstance.post('/wishlist/toggle', { product_id: newItem.id });
        await fetchWishlist();
      } catch (e) {
        console.error(e);
      }
    } else {
      if (!wishlist.some(item => item.id === newItem.id)) {
        updateLocalWishlist([...wishlist, newItem]);
      }
    }
  };

  const removeFromWishlist = async (id: string) => {
    if (isAuthenticated) {
      try {
        const item = wishlist.find(w => w.id === id) as any;
        if (item && item.wishlistItemId) {
          await axiosInstance.delete(`/wishlist/${item.wishlistItemId}`);
          await fetchWishlist();
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      updateLocalWishlist(wishlist.filter(item => item.id !== id));
    }
  };

  const isInWishlist = (id: string) => {
    return wishlist.some(item => item.id === id);
  };

  const toggleWishlist = async (item: WishlistItem) => {
    if (isInWishlist(item.id)) {
      await removeFromWishlist(item.id);
    } else {
      await addToWishlist(item);
    }
  };

  const toggleWishlistGuarded = async (
    item: WishlistItem,
    isAuthenticated: boolean,
    onRedirect: () => void
  ) => {
    if (!isAuthenticated) {
      onRedirect();
      return;
    }
    await toggleWishlist(item);
  };

  const clearWishlist = () => {
    updateLocalWishlist([]); // Only clears local, DB should technically clear via API but rarely needed for wishlist
  };

  const wishlistCount = wishlist.length;

  return (
    <WishlistContext.Provider value={{ wishlist, addToWishlist, removeFromWishlist, isInWishlist, toggleWishlist, toggleWishlistGuarded, clearWishlist, isLoading, wishlistCount }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (context === undefined) {
    throw new Error('useWishlist must be used within a WishlistProvider');
  }
  return context;
}
