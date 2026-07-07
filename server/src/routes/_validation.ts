import type { Response } from "express";
import { z } from "zod";

const idSchema = z.coerce.number().int().positive();

/**
 * Parse a route param as a positive integer id. On failure, responds with 400
 * and returns null — callers must `return` when the result is null.
 *
 * Prevents `Number("abc")` → NaN flowing into Prisma `where` clauses (which
 * otherwise throws a 500, or worse, runs a `deleteMany({ where: { planId: NaN }})`).
 */
export function parseId(raw: unknown, res: Response, label = "id"): number | null {
  const parsed = idSchema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid ${label}` });
    return null;
  }
  return parsed.data;
}
