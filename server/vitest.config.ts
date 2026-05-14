import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

// Load .env.test BEFORE anything else so DATABASE_URL points at the test DB.
// If .env.test is missing, fail loudly — running tests against the real .env
// would wipe data (some tests use prisma.deleteMany()).
const envTestPath = fileURLToPath(new URL("./.env.test", import.meta.url));
if (!existsSync(envTestPath)) {
  throw new Error(
    `Missing ${envTestPath}. Tests must run against a dedicated test DB. See docs/superpowers/specs/2026-05-13-agent-phase-2-design.md.`
  );
}
loadEnv({ path: envTestPath });

export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
