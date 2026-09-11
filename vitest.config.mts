import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests run in Node, not jsdom.
 *
 * Everything under test here is pure arithmetic over plain maps — that is the
 * point of keeping `lib/scoring.ts` free of React, Mongoose and `server-only`.
 * Phase 8 adds a jsdom project alongside this one for component tests.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
});
