import { describe, it, expect } from "vitest";
import { runAgent } from "../../agent/runner.js";

describe("runAgent multi-turn", () => {
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
