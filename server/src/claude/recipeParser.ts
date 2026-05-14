import { callClaudeViaSdk } from "./sdkClient.js";
import path from "path";

interface ParsedRecipe {
  name: string;
  description: string;
  servings: number;
  prepTime: number | null;
  cookTime: number | null;
  tags: string[];
  instructions: string[];
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sodiumMg: number | null;
  ingredients: {
    name: string;
    quantity: number;
    unit: string;
    category: string;
    preparation: string | null;
  }[];
}

export async function parseRecipeFromFile(filePath: string): Promise<ParsedRecipe> {
  const absolutePath = path.resolve(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const fileType = ext === ".pdf" ? "PDF"
    : ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp" ? "image"
    : "file";

  const prompt = `Read the Hello Fresh recipe card ${fileType} at this path: ${absolutePath}

Extract all recipe information and return ONLY valid JSON matching this exact schema — no markdown, no explanation, no commentary:

{
  "name": "string",
  "description": "string (1-2 sentence summary)",
  "servings": number,
  "prepTime": number_or_null (minutes),
  "cookTime": number_or_null (minutes),
  "tags": ["string"],
  "instructions": ["step 1 text", "step 2 text"],
  "calories": number_or_null,
  "proteinG": number_or_null,
  "carbsG": number_or_null,
  "fatG": number_or_null,
  "fiberG": number_or_null,
  "sodiumMg": number_or_null,
  "ingredients": [
    {
      "name": "string (lowercase, singular)",
      "quantity": number,
      "unit": "string",
      "category": "produce|protein|dairy|pantry_staple|grain|spice|condiment|frozen|other",
      "preparation": "string_or_null (e.g. diced, minced)"
    }
  ]
}

For tags, include protein type, cuisine, and any relevant descriptors (quick, vegetarian, etc).`;

  const raw = await callClaudeViaSdk({
    userPrompt: prompt,
    timeoutMs: 300_000,
    additionalDirectories: [path.dirname(absolutePath)],
    allowedTools: ["Read"],
  });

  const jsonText = extractJson(raw);
  if (!jsonText) {
    const debugPath = `/tmp/recipe-parse-fail-${Date.now()}.txt`;
    try {
      const { writeFile } = await import("fs/promises");
      await writeFile(debugPath, `FILE: ${absolutePath}\n\nRAW RESPONSE:\n${raw}`);
    } catch {}
    throw new Error(`Failed to extract JSON from Claude response (raw saved to ${debugPath})`);
  }

  try {
    const parsed: ParsedRecipe = JSON.parse(jsonText);
    return parsed;
  } catch (e: any) {
    throw new Error(`Failed to parse JSON: ${e.message}`);
  }
}

function extractJson(raw: string): string | null {
  // Try fenced code block first (```json ... ``` or ``` ... ```)
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const inside = fenceMatch[1].trim();
    if (inside.startsWith("{") && inside.endsWith("}")) return inside;
  }

  // Fall back to greedy {...} match
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];

  return null;
}
