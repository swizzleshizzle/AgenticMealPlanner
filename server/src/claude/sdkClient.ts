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
 * See ./binaryResolver.ts for implementation details.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolveClaudeBinary } from "./binaryResolver.js";

export interface CallClaudeViaSdkArgs {
  userPrompt: string;
  systemPrompt?: string;
  /** If provided, enables these built-in Claude tools (e.g. ["Read"] for file OCR). */
  allowedTools?: string[];
  /** Extra directories Claude is permitted to read from. */
  additionalDirectories?: string[];
  timeoutMs?: number;
  /** Pin a model; defaults to claude-opus-4-8. Pass claude-haiku-4-5 for cheap passes. */
  model?: string;
}

export class SdkNotLoggedInError extends Error {
  constructor() {
    super(
      "Claude Code is not logged in on this host — run `claude login` (interactive) as the app user, then retry.",
    );
    this.name = "SdkNotLoggedInError";
  }
}

/**
 * The SDK surfaces auth expiry as a normal-looking result string, which
 * downstream JSON parsers then misreport as "no parseable JSON". Detect it
 * at the boundary and fail with an actionable message instead.
 */
export function assertSdkResultUsable(raw: string): string {
  if (/^not logged in\b/i.test(raw.trim())) throw new SdkNotLoggedInError();
  return raw;
}

export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

/**
 * Options for one-shot parses. Host-isolated (issue #44) and root-safe:
 * requested built-in tools are granted via an explicit allowedTools
 * allowlist (auto-approved, no prompts) instead of
 * allowDangerouslySkipPermissions, which Claude Code refuses when the
 * process runs as root — observed as an opaque "process exited with code 1"
 * on the photo-parse path.
 */
export function buildOneShotQueryOptions(input: {
  systemPrompt?: string;
  allowedTools?: string[];
  additionalDirectories?: string[];
  model?: string;
}): Record<string, any> {
  const options: Record<string, any> = {
    persistSession: false,
    mcpServers: {},
    // Host isolation (issue #44): without these, the SDK loads the host
    // user's own Claude Code settings — their CLAUDE.md, hooks, and personal
    // MCP servers — into every one-shot parse, adding ~10k cache-creation
    // tokens per call and exposing tools this process has no business seeing.
    settingSources: [],
    strictMcpConfig: true,
    // Pin the model so one-shot parses don't drift across SDK binary upgrades.
    model: input.model ?? "claude-opus-4-8",
  };
  if (input.systemPrompt !== undefined) options.systemPrompt = input.systemPrompt;
  if (input.allowedTools !== undefined) {
    options.tools = input.allowedTools;
    options.allowedTools = input.allowedTools;
  } else {
    options.tools = [];
  }
  if (input.additionalDirectories !== undefined) {
    options.additionalDirectories = input.additionalDirectories;
  }
  return options;
}

export async function callClaudeViaSdk(args: CallClaudeViaSdkArgs): Promise<string> {
  const { userPrompt, systemPrompt, allowedTools, additionalDirectories, timeoutMs, model } = args;
  // Resolved per call (success is cached inside the resolver): a module-load
  // freeze is how a transient startup failure wedged every later request.
  const CLAUDE_BIN = resolveClaudeBinary();

  const controller = new AbortController();
  const options: any = {
    ...buildOneShotQueryOptions({ systemPrompt, allowedTools, additionalDirectories, model }),
    // Lets the timeout branch actually cancel the underlying query.
    abortController: controller,
    // Surface the CLI's real complaint instead of an opaque exit code.
    stderr: (data: string) => console.error("[sdkClient stderr]", data.slice(0, 500)),
  };
  if (CLAUDE_BIN !== undefined) {
    options.pathToClaudeCodeExecutable = CLAUDE_BIN;
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

  let timer: ReturnType<typeof setTimeout> | undefined;
  const raw = timeoutMs
    ? await Promise.race([
        collect(),
        new Promise<string>((_, rej) => {
          timer = setTimeout(() => {
            // Cancel the underlying query so it doesn't keep running (and
            // burning tokens) after we've given up waiting.
            controller.abort();
            rej(new Error(`SDK call timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      })
    : await collect();

  return stripFences(assertSdkResultUsable(raw));
}
