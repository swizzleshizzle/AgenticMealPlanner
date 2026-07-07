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

export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

// Resolved once at module load; undefined means let the SDK handle it.
const CLAUDE_BIN = resolveClaudeBinary();

export async function callClaudeViaSdk(args: CallClaudeViaSdkArgs): Promise<string> {
  const { userPrompt, systemPrompt, allowedTools, additionalDirectories, timeoutMs, model } = args;

  const controller = new AbortController();
  const options: any = {
    persistSession: false,
    mcpServers: {},
    // Pin the model so one-shot parses don't drift across SDK binary upgrades.
    model: model ?? "claude-opus-4-8",
    // Lets the timeout branch actually cancel the underlying query.
    abortController: controller,
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

  return stripFences(raw);
}
