"use client";

import { useEffect } from "react";
import { setBeacon } from "@/lib/analytics";
import axiosInstance from "@/api/axiosInstance";

/**
 * Hands the existing axios instance to lib/analytics, so every analytics event
 * (not just pageviews) can reach our own first-party endpoint through the same
 * client that already carries auth and error handling. Injected here, in the
 * root layout, to keep lib/analytics free of app-level imports.
 */
export default function BeaconProvider() {
  useEffect(() => {
    setBeacon((path, body) => {
      void axiosInstance.post(path, body).catch(() => {
        /* fire-and-forget */
      });
    });
    return () => setBeacon(() => {});
  }, []);

  return null;
}