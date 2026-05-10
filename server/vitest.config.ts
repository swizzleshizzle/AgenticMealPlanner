import { defineConfig } from "vitest/config";

// Many of our tests share a single Postgres database and reset rows in
// `beforeEach`. Running test files in parallel causes them to trample each
// other. Disable file-level parallelism so each file runs to completion
// before the next starts. Test cases inside a file still run sequentially
// via vitest's default per-test ordering.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
