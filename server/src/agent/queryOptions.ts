/**
 * queryOptions.ts — SDK query options for the chat agent, isolated from the
 * host machine (issue #44).
 *
 * Without `settingSources: []` the SDK inherits the host user's own Claude
 * Code configuration — including their personal MCP servers. Verified
 * 2026-09-18 on the prod host: the agent's init tool list contained the
 * owner's Gmail, Google Calendar (full CRUD), Google Drive, and Claude Docs
 * tools, reachable from the app's chat — plus ~10k cache-creation tokens of
 * inherited settings on every turn.
 *
 * The isolation triad (all three required, verified empirically):
 *   settingSources: []   — don't load host CLAUDE.md / hooks / MCP config
 *   strictMcpConfig      — only the MCP servers passed in options exist
 *   allowedTools         — explicit allowlist; also removes the need for
 *                          allowDangerouslySkipPermissions, which Claude Code
 *                          refuses under root.
 */

export interface AgentQueryOptionsInput {
  systemPrompt: string;
  /** Bare tool names registered on the in-process meal-planner MCP server. */
  toolNames: string[];
  claudeBin: string | undefined;
  abortController?: AbortController;
}

export const MCP_SERVER_NAME = "meal-planner-tools";

export function buildAgentQueryOptions(input: AgentQueryOptionsInput): Record<string, unknown> {
  return {
    systemPrompt: input.systemPrompt,
    // Pin the model so quality/cost/JSON-compliance don't drift when the
    // resolved Claude Code binary updates its default.
    model: "claude-opus-4-8",
    // Host isolation — see module doc.
    settingSources: [],
    strictMcpConfig: true,
    tools: [],
    allowedTools: input.toolNames.map((n) => `mcp__${MCP_SERVER_NAME}__${n}`),
    persistSession: false,
    ...(input.abortController ? { abortController: input.abortController } : {}),
    ...(input.claudeBin ? { pathToClaudeCodeExecutable: input.claudeBin } : {}),
  };
}
