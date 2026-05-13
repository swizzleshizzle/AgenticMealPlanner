import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildToolSchemas, dispatchToolCall } from "../../agent/registry.js";
import type { ToolDef, PageContext } from "../../agent/types.js";

const echoTool: ToolDef<{ msg: string }, { echoed: string }> = {
  name: "echo",
  description: "Echoes the input back",
  schema: z.object({ msg: z.string() }),
  handler: async (input) => ({ echoed: input.msg }),
};

const tools = [echoTool];
const ctx: PageContext = {};

describe("buildToolSchemas", () => {
  it("converts ZodSchema to JSON Schema and preserves name/description", () => {
    const schemas = buildToolSchemas(tools);
    expect(schemas).toHaveLength(1);
    expect(schemas[0].name).toBe("echo");
    expect(schemas[0].description).toBe("Echoes the input back");
    expect(schemas[0].input_schema.type).toBe("object");
    expect(schemas[0].input_schema.properties.msg.type).toBe("string");
  });
});

describe("dispatchToolCall", () => {
  it("invokes handler with parsed input and returns output", async () => {
    const result = await dispatchToolCall(tools, "echo", { msg: "hi" }, { pageContext: ctx });
    expect(result.isError).toBe(false);
    expect(result.output).toEqual({ echoed: "hi" });
  });

  it("returns structured error when tool name is unknown", async () => {
    const result = await dispatchToolCall(tools, "nope", {}, { pageContext: ctx });
    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/unknown tool/i);
  });

  it("returns structured error on schema validation failure", async () => {
    const result = await dispatchToolCall(tools, "echo", { wrong: 1 }, { pageContext: ctx });
    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/invalid input|expected/i);
  });

  it("returns structured error when handler throws", async () => {
    const throwTool: ToolDef = {
      name: "boom",
      description: "Throws",
      schema: z.object({}),
      handler: async () => { throw new Error("kaboom"); },
    };
    const result = await dispatchToolCall([throwTool], "boom", {}, { pageContext: ctx });
    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/kaboom/);
  });
});
