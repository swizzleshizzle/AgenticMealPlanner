import { describe, it, expect } from "vitest";
import { buildAgentQueryOptions } from "../../agent/queryOptions.js";

const base = {
  systemPrompt: "test prompt",
  toolNames: ["get_pantry", "swap_meal"],
  claudeBin: "/nm/claude",
};

describe("buildAgentQueryOptions — agent isolation (issue #44)", () => {
  it("never inherits the host machine's Claude Code settings", () => {
    // Without settingSources: [], the SDK loads the host user's own config —
    // verified 2026-09-18: the agent's init tool list included the owner's
    // Gmail, Google Calendar, Google Drive, and Claude Docs MCP servers.
    expect(buildAgentQueryOptions(base).settingSources).toEqual([]);
  });

  it("rejects MCP servers beyond the ones we pass explicitly", () => {
    expect(buildAgentQueryOptions(base).strictMcpConfig).toBe(true);
  });

  it("allowlists exactly the meal-planner tools, nothing else", () => {
    expect(buildAgentQueryOptions(base).allowedTools).toEqual([
      "mcp__meal-planner-tools__get_pantry",
      "mcp__meal-planner-tools__swap_meal",
    ]);
  });

  it("disables built-in Claude tools", () => {
    expect(buildAgentQueryOptions(base).tools).toEqual([]);
  });

  it("does not use the root-incompatible permission bypass", () => {
    // allowDangerouslySkipPermissions is refused when running as root and is
    // unnecessary with an explicit allowlist (allowlisted tools need no
    // prompt). Its absence must be deliberate and pinned.
    const opts = buildAgentQueryOptions(base);
    expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
    expect(opts.permissionMode).toBeUndefined();
  });

  it("keeps the resolved binary path and skips it when unresolved", () => {
    expect(buildAgentQueryOptions(base).pathToClaudeCodeExecutable).toBe("/nm/claude");
    expect(
      buildAgentQueryOptions({ ...base, claudeBin: undefined }).pathToClaudeCodeExecutable,
    ).toBeUndefined();
  });

  it("threads the abort controller through when provided", () => {
    const ac = new AbortController();
    expect(buildAgentQueryOptions({ ...base, abortController: ac }).abortController).toBe(ac);
    expect(buildAgentQueryOptions(base).abortController).toBeUndefined();
  });

  it("pins model and disables session persistence", () => {
    const opts = buildAgentQueryOptions(base);
    expect(opts.model).toBe("claude-opus-4-8");
    expect(opts.persistSession).toBe(false);
    expect(opts.systemPrompt).toBe("test prompt");
  });
});
