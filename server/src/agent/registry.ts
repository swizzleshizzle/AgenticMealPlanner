import type { ToolDef, PageContext } from "./types.js";

export async function dispatchToolCall(
  tools: ToolDef[],
  name: string,
  rawInput: unknown,
  ctx: { pageContext: PageContext },
): Promise<{ output: unknown; isError: boolean }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return { output: `Unknown tool: ${name}`, isError: true };
  }
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    return { output: `Invalid input for ${name}: ${parsed.error.message}`, isError: true };
  }
  try {
    const output = await tool.handler(parsed.data, ctx);
    return { output, isError: false };
  } catch (err: any) {
    return { output: err?.message ?? String(err), isError: true };
  }
}
