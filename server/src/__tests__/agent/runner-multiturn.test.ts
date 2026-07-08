import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { runAgent } from "../../agent/runner.js";

// This makes a REAL Claude Agent SDK call, so it only runs where credentials
// are available (dev box via `claude login`, or an ANTHROPIC key). It is
// skipped in credential-less environments like CI so the suite stays green.
const hasClaudeAuth =
  !!process.env.ANTHROPIC_API_KEY ||
  !!process.env.ANTHROPIC_AUTH_TOKEN ||
  existsSync(join(homedir(), ".claude", ".credentials.json"));

describe.skipIf(!hasClaudeAuth)("runAgent multi-turn", () => {
  it("uses prior turns to resolve ambiguous references", async () => {
    // First turn: ask what's in pantry
    const turn1 = await runAgent({
      userMessage: "What's in my pantry? Just give me a number, no list.",
      pageContext: {},
      history: [],
    });
    expect(turn1.message).toMatch(/\d+/); // some number

    // Second turn: reference the prior turn
    const turn2 = await runAgent({
      userMessage: "Is that more or less than 30?",
      pageContext: {},
      history: [
        { role: "user", content: "What's in my pantry? Just give me a number, no list." },
        { role: "assistant", content: turn1.message },
      ],
    });
    // The follow-up should reference the count, proving history was honored
    expect(turn2.message.toLowerCase()).toMatch(/more|less|equal|exactly|fewer|greater/);
  }, 120_000);
});
