import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Written by the copy from the private repository: the workspaces resolve to their sources.
export default defineConfig({
  resolve: {
    alias: {
      "@overtable/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    fileParallelism: false,
  },
});
