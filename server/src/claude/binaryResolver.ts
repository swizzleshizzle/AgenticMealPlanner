/**
 * binaryResolver.ts — shared Claude Code binary resolver for the SDK.
 *
 * The SDK's own platform resolution tries the musl package before glibc on
 * Linux with no libc detection, so merely having the musl optional package
 * installed breaks glibc hosts (the musl loader is absent → exec ENOENT,
 * misreported by the SDK as "binary not found"). We select by libc detection
 * + file existence instead and pass the result as pathToClaudeCodeExecutable.
 *
 * Deliberately NO exec probing and NO negative caching: the previous
 * implementation exec'd each candidate with a 5s timeout at module load and
 * cached failure for the process lifetime — on a cold post-reboot start the
 * 230MB binary couldn't page in within 5s, and the server stayed wedged on
 * the SDK's broken default until restarted (2026-08-23 receipt-upload
 * incident). Existence + matching libc is sufficient proof it will run.
 */

import { createRequire } from "module";
import { existsSync } from "fs";

export interface ResolverDeps {
  /** require.resolve for a package subpath; throws when not installed. */
  resolvePath: (pkgSubpath: string) => string;
  exists: (path: string) => boolean;
  /** True when the runtime links glibc (musl binaries cannot exec there). */
  glibc: () => boolean;
  platform: NodeJS.Platform;
  arch: string;
  warn: (message: string) => void;
}

function defaultGlibc(): boolean {
  try {
    return (process.report?.getReport() as any)?.header?.glibcVersionRuntime != null;
  } catch {
    return false;
  }
}

let warned = false;
let cachedSuccess: string | undefined;

export function resolveClaudeBinary(deps?: Partial<ResolverDeps>): string | undefined {
  // Success is stable for the process; failure is always retried.
  if (deps === undefined && cachedSuccess !== undefined) return cachedSuccess;

  const d: ResolverDeps = {
    resolvePath: createRequire(import.meta.url).resolve,
    exists: existsSync,
    glibc: defaultGlibc,
    platform: process.platform,
    arch: process.arch,
    warn: (m) => console.warn(m),
    ...deps,
  };

  let candidates: string[];
  if (d.platform === "linux") {
    candidates = d.glibc()
      ? // glibc host: the musl binary can never exec here — do not offer it.
        [`@anthropic-ai/claude-agent-sdk-linux-${d.arch}/claude`]
      : // musl host: musl first; glibc binaries generally cannot run.
        [
          `@anthropic-ai/claude-agent-sdk-linux-${d.arch}-musl/claude`,
          `@anthropic-ai/claude-agent-sdk-linux-${d.arch}/claude`,
        ];
  } else {
    const ext = d.platform === "win32" ? ".exe" : "";
    candidates = [`@anthropic-ai/claude-agent-sdk-${d.platform}-${d.arch}/claude${ext}`];
  }

  for (const pkg of candidates) {
    let resolved: string;
    try {
      resolved = d.resolvePath(pkg);
    } catch {
      continue;
    }
    if (!d.exists(resolved)) continue;
    if (deps === undefined) cachedSuccess = resolved;
    return resolved;
  }

  // Once per process on the default path (log hygiene); always when deps are
  // injected so the behavior stays observable in tests.
  if (deps !== undefined || !warned) {
    warned = true;
    d.warn(
      `[binaryResolver] no runnable Claude Code binary found for ${d.platform}/${d.arch}` +
        ` (glibc=${d.glibc()}) — falling back to the SDK's own resolution, which may pick` +
        ` an unrunnable platform package. Will retry on next call.`,
    );
  }
  return undefined;
}
