import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "client/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.git/**"],
    root: ".",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
});
