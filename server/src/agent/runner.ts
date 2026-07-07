/**
 * agent/runner.ts
 *
 * Wraps @anthropic-ai/claude-agent-sdk and exposes a clean runAgent() interface.
 * This is the ONLY file in the project that knows SDK internals.
 *
 * SDK API surface (v0.2.140):
 *   - query({ prompt, options }) -> AsyncGenerator<SDKMessage>
 *   - createSdkMcpServer({ name, tools }) -> McpSdkServerConfigWithInstance
 *   - SDKMessage variants: assistant, result, system, user, status, ...
 *   - SDKResultSuccess.result: string  (final text answer)
 *   - SDKResultError.errors: string[]
 *
 * Tool registration:
 *   Tools are registered via createSdkMcpServer() which creates an in-process
 *   MCP server. The SDK dispatches tool calls to our handlers automatically.
 *   We wrap each handler to record calls into the toolCalls array.
 *
 * Auth:
 *   No ANTHROPIC_API_KEY needed -- the SDK falls back to ~/.claude/.credentials.json
 *   automatically (set via `claude login`).
 */

import {
  query,
  createSdkMcpServer,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { buildSystemPrompt } from "./prompt.js";
import { dispatchToolCall } from "./registry.js";
import { allTools } from "./tools/index.js";
import type { PageContext, AgentResult, StreamEvent } from "./types.js";
import { resolveClaudeBinary } from "../claude/binaryResolver.js";

export interface RunAgentArgs {
  userMessage: string;
  pageContext: PageContext;
  history?: { role: "user" | "assistant"; content: string }[];
  /** Abort the underlying SDK query when the caller cancels (e.g. SSE client disconnect). */
  abortController?: AbortController;
}

// -- Date helpers -------------------------------------------------------------

function localYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function thisWeekSunday(now: Date): string {
  // JS getDay(): 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
  // Sunday-anchored weeks: subtract dayIndex directly to land on Sunday.
  // Mirrors client/src/api/plans.ts parseWeekParam math.
  const dayIndex = now.getDay();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - dayIndex);
  return localYmd(sunday);
}

// -- Streaming generator ------------------------------------------------------

export async function* runAgentStream(args: RunAgentArgs): AsyncGenerator<StreamEvent> {
  const { userMessage, pageContext } = args;
  const now = new Date();
  const today = localYmd(now);
  const currentWeekStart = thisWeekSunday(now);

  const systemPrompt = buildSystemPrompt({ today, currentWeekStart, pageContext });
  const claudeBin = resolveClaudeBinary();

  // Track tool calls accumulated during the conversation
  const toolCalls: AgentResult["toolCalls"] = [];

  // Build in-process MCP server with all 14 tools.
  // Each handler wraps dispatchToolCall so we can record invocations.
  const sdkTools = allTools.map((toolDef) => {
    // Extract raw Zod shape from the ZodObject schema so the SDK tool()
    // helper can infer types. We skip the SDK tool() helper and build
    // SdkMcpToolDefinition manually to avoid the Zod v4/v3 shape constraint.
    const shape = (toolDef.schema as z.ZodObject<z.ZodRawShape>).shape ?? {};

    return {
      name: toolDef.name,
      description: toolDef.description,
      inputSchema: shape,
      handler: async (rawArgs: Record<string, unknown>) => {
        const { output, isError } = await dispatchToolCall(
          allTools,
          toolDef.name,
          rawArgs,
          { pageContext },
        );
        toolCalls.push({ name: toolDef.name, input: rawArgs, output, isError });

        // MCP CallToolResult format
        return {
          content: [
            {
              type: "text" as const,
              text: typeof output === "string" ? output : JSON.stringify(output),
            },
          ],
          isError,
        };
      },
    };
  });

  const mcpServer = createSdkMcpServer({ name: "meal-planner-tools", tools: sdkTools });

  // Build prompt: prepend conversation history as a transcript if present.
  const promptWithHistory = (args.history && args.history.length > 0)
    ? args.history
        .map((h) => `${h.role === "user" ? "Human" : "Assistant"}: ${h.content}`)
        .join("\n\n") + `\n\nHuman: ${userMessage}`
    : userMessage;

  // Run the query. The SDK dispatches tool calls through the MCP server
  // automatically -- no manual tool-use loop needed.
  const queryIterator = query({
    prompt: promptWithHistory,
    options: {
      systemPrompt,
      // Pin the model so quality/cost/JSON-compliance don't drift when the
      // resolved Claude Code binary updates its default.
      model: "claude-opus-4-8",
      // Disable all built-in Claude tools; only our MCP tools are available.
      tools: [],
      mcpServers: {
        "meal-planner-tools": mcpServer,
      },
      // Disable session persistence for ephemeral API calls
      persistSession: false,
      // Cancel the query (and stop in-flight DB-mutating tool work) when the
      // caller aborts — e.g. the SSE client navigates away.
      ...(args.abortController ? { abortController: args.abortController } : {}),
      ...(claudeBin ? { pathToClaudeCodeExecutable: claudeBin } : {}),
      // Bypass permissions for MCP tool execution (safety vetted)
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  });

  let message = "";
  let sawResult = false;
  let lastEmittedLength = 0;

  for await (const msg of queryIterator) {
    if ((msg as any).type === "assistant") {
      const content = (msg as any).message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            const delta = block.text.slice(lastEmittedLength);
            if (delta) {
              lastEmittedLength = block.text.length;
              yield { type: "text_delta", delta };
            }
          } else if (block.type === "tool_use") {
            yield { type: "tool_call_start", name: block.name.split("__").pop() ?? block.name };
          } else if (block.type === "tool_result") {
            // NOTE: tool_result blocks arrive in SDK "user" messages, not "assistant"
            // messages, so this branch effectively never fires today. The authoritative
            // tool-call state (with isError) is delivered on the "done" event and the
            // client reconciles chip state there.
            const isError = block.is_error === true;
            const last = toolCalls[toolCalls.length - 1];
            yield { type: "tool_call_end", name: last?.name ?? "unknown", isError };
          }
        }
      }
    } else if (msg.type === "result") {
      sawResult = true;
      if (msg.subtype === "success") {
        message = (msg as any).result ?? "";
      } else {
        // Error result
        const errors: string[] = (msg as any).errors ?? [];
        message = errors.length > 0
          ? `Agent error: ${errors.join("; ")}`
          : `Agent stopped with error: ${msg.subtype}`;
      }
      break; // result is always last
    }
  }

  if (!sawResult) {
    yield { type: "error", error: "Agent did not return a result message" };
    return;
  }

  yield { type: "done", message, toolCalls };
}

// -- Buffered runner (delegates to stream) ------------------------------------

export async function runAgent(args: RunAgentArgs): Promise<AgentResult> {
  for await (const ev of runAgentStream(args)) {
    if (ev.type === "done") {
      return { message: ev.message, toolCalls: ev.toolCalls };
    }
    if (ev.type === "error") {
      throw new Error(ev.error);
    }
  }
  throw new Error("Agent stream ended without a done event");
}
