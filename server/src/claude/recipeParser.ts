import { callClaude } from "./cli.js";
import { readFile } from "fs/promises";
import path from "path";

interface ParsedRecipe {
  name: string;
  description: string;
  mealType: "batch_prep" | "cook_fresh";
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
  const ext = path.extname(filePath).toLowerCase();
  const fileContent = await readFile(filePath);
  const base64 = fileContent.toString("base64");

  const mediaType = ext === ".pdf" ? "application/pdf"
    : ext === ".png" ? "image/png"
    : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : "application/octet-stream";

  const prompt = `You are a recipe parser. You will receive a Hello Fresh recipe card (as a ${mediaType} file encoded in base64). Extract all recipe information and return ONLY valid JSON matching this exact schema — no markdown, no explanation:

{
  "name": "string",
  "description": "string (1-2 sentence summary)",
  "mealType": "cook_fresh",
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

For tags, include protein type, cuisine, and any relevant descriptors (quick, vegetarian, etc).

Base64 file content:
${base64}`;

  const raw = await callClaude(prompt, { timeout: 180_000 });

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to extract JSON from Claude response");
  }

  const parsed: ParsedRecipe = JSON.parse(jsonMatch[0]);
  return parsed;
}
