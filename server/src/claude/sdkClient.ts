/**
 * sdkClient.ts — thin SDK wrapper for one-shot Claude completions.
 *
 * Replaces the legacy callClaude() subprocess shell-out. Used by receiptParser,
 * mealPlanner, and recipeParser for non-agentic LLM calls.
 *
 * Auth: no ANTHROPIC_API_KEY needed — SDK reads ~/.claude/.credentials.json.
 *
 * Binary resolution: on glibc Linux the SDK incorrectly prefers the musl
 * optional package when it is installed but unrunnable. We detect this and
 * fall back to the glibc build via pathToClaudeCodeExecutable.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createRequire } from "module";
import { execFileSync } from "child_process";

export interface CallClaudeViaSdkArgs {
  userPrompt: string;
  systemPrompt?: string;
  /** If provided, enables these built-in Claude tools (e.g. ["Read"] for file OCR). */
  allowedTools?: string[];
  /** Extra directories Claude is permitted to read from. */
  additionalDirectories?: string[];
  timeoutMs?: number;
}

export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

/**
 * Resolve a runnable Claude Code binary path.
 *
 * The SDK tries musl before glibc on Linux. When the musl package is installed
 * but the musl interpreter is absent (glibc-only host), the binary resolves but
 * crashes at exec time. We verify each candidate with a quick --version probe
 * and return the first working path.
 */
function resolveClaudeBinary(): string | undefined {
  const req = createRequire(import.meta.url);
  const candidates = [
    "@anthropic-ai/claude-agent-sdk-linux-x64/claude",
    "@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude",
    "@anthropic-ai/claude-agent-sdk-linux-arm64/claude",
    "@anthropic-ai/claude-agent-sdk-linux-arm64-musl/claude",
    "@anthropic-ai/claude-agent-sdk-darwin-x64/claude",
    "@anthropic-ai/claude-agent-sdk-darwin-arm64/claude",
  ];
  for (const pkg of candidates) {
    let resolved: string;
    try {
      resolved = req.resolve(pkg);
    } catch {
      continue;
    }
    try {
      execFileSync(resolved, ["--version"], { timeout: 5000, stdio: "ignore" });
      return resolved;
    } catch {
      // binary exists but can't run (e.g. musl on glibc host) — try next
    }
  }
  return undefined;
}

// Resolved once at module load; undefined means let the SDK handle it.
const CLAUDE_BIN = resolveClaudeBinary();

export async function callClaudeViaSdk(args: CallClaudeViaSdkArgs): Promise<string> {
  const { userPrompt, systemPrompt, allowedTools, additionalDirectories, timeoutMs } = args;

  const options: any = {
    persistSession: false,
    mcpServers: {},
  };
  if (CLAUDE_BIN !== undefined) {
    options.pathToClaudeCodeExecutable = CLAUDE_BIN;
  }
  if (systemPrompt !== undefined) options.systemPrompt = systemPrompt;
  if (allowedTools !== undefined) {
    options.tools = allowedTools;
    options.permissionMode = "bypassPermissions";
    options.allowDangerouslySkipPermissions = true;
  } else {
    options.tools = [];
  }
  if (additionalDirectories !== undefined) {
    options.additionalDirectories = additionalDirectories;
  }

  const iterator = query({ prompt: userPrompt, options });

  const collect = async (): Promise<string> => {
    for await (const msg of iterator) {
      if (msg.type === "result") {
        if (msg.subtype === "success") {
          return (msg as any).result ?? "";
        }
        const errors: string[] = (msg as any).errors ?? [];
        throw new Error(
          errors.length > 0 ? `SDK error: ${errors.join("; ")}` : `SDK stopped: ${msg.subtype}`,
        );
      }
    }
    throw new Error("SDK iterator ended without a result message");
  };

  const raw = timeoutMs
    ? await Promise.race([
        collect(),
        new Promise<string>((_, rej) =>
          setTimeout(() => rej(new Error(`SDK call timed out after ${timeoutMs}ms`)), timeoutMs),
        ),
      ])
    : await collect();

  return stripFences(raw);
}
