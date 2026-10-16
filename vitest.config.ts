import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The pump SDK is CommonJS and loaded through createRequire; keep it out of Vite's transform.
    server: { deps: { external: [/@pump-fun/, /@coral-xyz/] } },
    testTimeout: 20_000,
  },
});
