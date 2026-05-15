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
import type { PageContext, AgentResult } from "./types.js";
import { resolveClaudeBinary } from "../claude/binaryResolver.js";

export interface RunAgentArgs {
  userMessage: string;
  pageContext: PageContext;
  history?: { role: "user" | "assistant"; content: string }[];
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

// -- Runner -------------------------------------------------------------------

export async function runAgent(args: RunAgentArgs): Promise<AgentResult> {
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
      // Disable all built-in Claude tools; only our MCP tools are available.
      tools: [],
      mcpServers: {
        "meal-planner-tools": mcpServer,
      },
      // Disable session persistence for ephemeral API calls
      persistSession: false,
      ...(claudeBin ? { pathToClaudeCodeExecutable: claudeBin } : {}),
      // Bypass permissions for MCP tool execution (safety vetted)
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  });

  let message = "";

  for await (const msg of queryIterator) {
    if (msg.type === "result") {
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
    // Other message types (assistant, system, status, etc.) are ignored
    // for this minimal v1 -- we only need the final result text.
  }

  return { message, toolCalls };
}
