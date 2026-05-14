/**
 * binaryResolver.ts — shared Claude Code binary resolver for the SDK.
 *
 * The SDK platform detection tries musl before glibc on Linux. When the
 * musl optional package is installed but unrunnable (e.g. binary missing or
 * /lib/ld-musl-x86_64.so.1 absent on a glibc host), the SDK throws at exec
 * time. We probe each candidate with `--version` and return the first that
 * actually runs. Returned path is passed as `pathToClaudeCodeExecutable` to
 * SDK options. Returns undefined if no probe succeeds (fall back to the
 * SDK's own resolution and let it error meaningfully).
 */

import { createRequire } from "module";
import { execFileSync } from "child_process";

const CANDIDATES = [
  "@anthropic-ai/claude-agent-sdk-linux-x64/claude",
  "@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude",
  "@anthropic-ai/claude-agent-sdk-linux-arm64/claude",
  "@anthropic-ai/claude-agent-sdk-linux-arm64-musl/claude",
  "@anthropic-ai/claude-agent-sdk-darwin-x64/claude",
  "@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
];

let cached: string | undefined | null = null; // null = not probed yet

export function resolveClaudeBinary(): string | undefined {
  if (cached !== null) return cached ?? undefined;
  const req = createRequire(import.meta.url);
  for (const pkg of CANDIDATES) {
    let resolved: string;
    try {
      resolved = req.resolve(pkg);
    } catch {
      continue;
    }
    try {
      execFileSync(resolved, ["--version"], { timeout: 5000, stdio: "ignore" });
      cached = resolved;
      return resolved;
    } catch {
      // binary exists but can't run (e.g. musl on glibc) — try next
    }
  }
  cached = undefined;
  return undefined;
}
