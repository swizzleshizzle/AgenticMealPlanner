import { describe, it, expect } from "vitest";
import { buildOneShotQueryOptions } from "../claude/sdkClient.js";

describe("buildOneShotQueryOptions — host isolation + root-safe permissions", () => {
  it("isolates from host settings and rejects foreign MCP servers", () => {
    const opts = buildOneShotQueryOptions({});
    expect(opts.settingSources).toEqual([]);
    expect(opts.strictMcpConfig).toBe(true);
    expect(opts.mcpServers).toEqual({});
  });

  it("allowlists requested built-in tools instead of bypassing permissions", () => {
    // allowDangerouslySkipPermissions is refused when the process runs as
    // root — observed as an opaque 'Claude Code process exited with code 1'
    // on the photo-parse path (issue #44 pt 3). An explicit allowlist
    // auto-approves the listed tools and needs no bypass.
    const opts = buildOneShotQueryOptions({ allowedTools: ["Read"] });
    expect(opts.tools).toEqual(["Read"]);
    expect(opts.allowedTools).toEqual(["Read"]);
    expect(opts.allowDangerouslySkipPermissions).toBeUndefined();
    expect(opts.permissionMode).toBeUndefined();
  });

  it("disables all tools when none are requested", () => {
    const opts = buildOneShotQueryOptions({});
    expect(opts.tools).toEqual([]);
    expect(opts.allowedTools).toBeUndefined();
  });

  it("threads additional directories through", () => {
    expect(buildOneShotQueryOptions({ additionalDirectories: ["/x"] }).additionalDirectories).toEqual(["/x"]);
  });
});
