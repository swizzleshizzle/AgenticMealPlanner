import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the entire SDK ─────────────────────────────────────────────────────
// The runner calls createSdkMcpServer() and query(). We mock both.
// createSdkMcpServer captures the tool handlers so we can invoke them in the
// mock query to simulate real tool-call round-trips.

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
const capturedHandlers: Record<string, ToolHandler> = {};

const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: vi.fn(
    (opts: { name: string; tools: Array<{ name: string; handler: ToolHandler }> }) => {
      // Capture handlers so the mockQuery can invoke them
      for (const t of opts.tools ?? []) {
        capturedHandlers[t.name] = t.handler;
      }
      return { type: "sdk", name: opts.name, instance: {} };
    },
  ),
  query: mockQuery,
}));

// ── Mock dispatchToolCall so the test doesn't need a live DB ──────────────
vi.mock("../../agent/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agent/registry.js")>();
  return {
    ...actual,
    dispatchToolCall: vi.fn().mockResolvedValue({
      output: { batches: [] },
      isError: false,
    }),
  };
});

// ── Mock allTools so we control what is registered ───────────────────────
vi.mock("../../agent/tools/index.js", () => ({
  allTools: [
    {
      name: "get_pantry",
      description: "List pantry batches",
      // ZodObject-like: provide a .shape property so runner can read it
      schema: {
        shape: {},
        safeParse: (v: unknown) => ({ success: true, data: v }),
      },
    },
  ],
}));

describe("agent runner", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    // Clear captured handlers between tests
    for (const k of Object.keys(capturedHandlers)) {
      delete capturedHandlers[k];
    }
  });

  it("returns the final assistant message and any tool calls", async () => {
    // Simulate SDK streaming: result message contains the final text.
    // The MCP server handles tool dispatch internally — our runner reads
    // the SDKResultSuccess.result field for the final message.
    mockQuery.mockImplementation(async function* () {
      // Simulate a result message (the SDK streams the outcome directly)
      yield {
        type: "result",
        subtype: "success",
        result: "Your pantry is empty.",
        is_error: false,
        num_turns: 1,
        duration_ms: 100,
        duration_api_ms: 90,
        stop_reason: "end_turn",
        total_cost_usd: 0,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        uuid: "test-uuid",
        session_id: "test-session",
      };
    });

    const { runAgent } = await import("../../agent/runner.js");
    const out = await runAgent({
      userMessage: "what's in my pantry?",
      pageContext: {},
    });

    expect(out.message).toContain("pantry is empty");
  });

  it("returns error message when SDK emits error result", async () => {
    mockQuery.mockImplementation(async function* () {
      yield {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["Something went wrong"],
        num_turns: 0,
        duration_ms: 10,
        duration_api_ms: 5,
        stop_reason: null,
        total_cost_usd: 0,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        uuid: "test-uuid-2",
        session_id: "test-session",
      };
    });

    const { runAgent } = await import("../../agent/runner.js");
    const out = await runAgent({
      userMessage: "list my pantry",
      pageContext: {},
    });

    expect(out.message).toMatch(/error|went wrong/i);
    expect(out.toolCalls).toHaveLength(0);
  });

  it("calls query with systemPrompt and mcpServers options", async () => {
    mockQuery.mockImplementation(async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "Done.",
        is_error: false,
        num_turns: 1,
        duration_ms: 50,
        duration_api_ms: 40,
        stop_reason: "end_turn",
        total_cost_usd: 0,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        uuid: "test-uuid-3",
        session_id: "test-session",
      };
    });

    const { runAgent } = await import("../../agent/runner.js");
    await runAgent({ userMessage: "hello", pageContext: {} });

    expect(mockQuery).toHaveBeenCalledOnce();
    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options?.systemPrompt).toBeDefined();
    expect(callArgs.options?.systemPrompt).toContain("meal-planning assistant");
    expect(callArgs.options?.mcpServers).toBeDefined();
    expect(callArgs.options?.tools).toEqual([]);
  });
});
