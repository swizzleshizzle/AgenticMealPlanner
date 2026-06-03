import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the entire SDK ─────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: vi.fn(
    (opts: { name: string; tools: Array<{ name: string; handler: unknown }> }) => {
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
      output: {},
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
      schema: {
        shape: {},
        safeParse: (v: unknown) => ({ success: true, data: v }),
      },
    },
  ],
}));

describe("runAgent missing result event", () => {
  beforeEach(() => mockQuery.mockReset());

  it("throws when SDK iterator ends without a result message", async () => {
    mockQuery.mockImplementation(async function* () {
      // No yield of type 'result' — iterator just ends.
    });
    const { runAgent } = await import("../../agent/runner.js");
    await expect(
      runAgent({ userMessage: "hi", pageContext: {} }),
    ).rejects.toThrow(/did not return a result/i);
  });
});
