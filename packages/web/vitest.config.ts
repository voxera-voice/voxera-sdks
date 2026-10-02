import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The client touches document, window and navigator.mediaDevices.
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
  },
});
