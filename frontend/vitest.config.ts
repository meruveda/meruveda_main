import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config.
 *
 * The two existing suites (analytics, reviews) are pure logic and pass either
 * way; the checkout suite needs a DOM, so `jsdom` is the environment and the
 * `@/*` alias the app already declares in tsconfig.json is mirrored here so
 * tests can import modules the same way the app does.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
  },
});