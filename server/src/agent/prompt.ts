import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PageContext } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, "promptTemplate.md");

let cached: string | null = null;
function loadTemplate(): string {
  if (cached) return cached;
  cached = readFileSync(TEMPLATE_PATH, "utf8");
  return cached;
}

function renderPageContext(pc: PageContext): string {
  const entries = Object.entries(pc).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "No specific page context.";
  return entries.map(([k, v]) => `- ${k}: ${v}`).join("\n");
}

export function buildSystemPrompt(args: {
  today: string;
  currentWeekStart: string;
  pageContext: PageContext;
}): string {
  return loadTemplate()
    .replace("{today}", args.today)
    .replace("{currentWeekStart}", args.currentWeekStart)
    .replace("{pageContext}", renderPageContext(args.pageContext));
}
