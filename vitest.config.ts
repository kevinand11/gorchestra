import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["libs/**/*.{test,spec}.ts"],
    includeSource: ["libs/**/src/**/*.ts"],
    exclude: ["node_modules/**", "dist/**", "coverage/**"],
  },
});
