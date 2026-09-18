// Runs against the vitest DB. Verifies commit-time unit normalization:
// receipt batches historically stored the parser's unit raw (62% of linked
// food lines mismatched their ingredient's default unit), endlessly
// re-creating mixed-unit batch sets.
import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { commitReceipt } from "../services/receiptService.js";
import { stashReceiptParse } from "../services/receiptParseSessions.js";

const prisma = new PrismaClient();

async function reset() {
  await prisma.pantryBatch.deleteMany();
  await prisma.receiptItem.deleteMany();
  await prisma.receipt.deleteMany();
  await prisma.ingredient.deleteMany();
}

function stash(items: Array<{ rawName: string }>) {
  return stashReceiptParse(
    { store: "Walmart", tripDate: "2026-09-18", subtotal: null, tax: null, total: 10, items: items as any },
    null,
    null,
  );
}

const editBase = {
  kind: "food" as const,
  isCommitted: true,
  price: 2.5,
  categoryGuess: "dairy",
  locationGuess: "fridge" as const,
  expirationDate: null,
};

describe("commitReceipt — batch unit normalization", () => {
  beforeEach(reset);

  it("converts the batch to the ingredient's default unit when hints allow", async () => {
    const ing = await prisma.ingredient.create({
      data: { name: "sour cream", category: "dairy", defaultUnit: "tbsp", densityGPerMl: 0.96 },
    });
    const parseId = stash([{ rawName: "SOUR CREAM 24OZ" }]);
    await commitReceipt({
      parseId, store: "Walmart", tripDate: "2026-09-18", subtotal: null, tax: null, total: 10,
      items: [{ ...editBase, index: 0, parsedName: "sour cream", ingredientId: ing.id, quantity: 24, unit: "oz" }],
    } as any);

    const batch = await prisma.pantryBatch.findFirst({ where: { ingredientId: ing.id } });
    expect(batch!.unit).toBe("tbsp");
    // 24 oz ≈ 680.4 g ÷ 0.96 g/mL ≈ 708.7 mL ÷ 14.7868 ≈ 47.93 tbsp
    expect(batch!.quantity).toBeCloseTo(47.93, 1);
    // The receipt line keeps the raw parsed unit as historical record.
    const line = await prisma.receiptItem.findFirst({ where: { ingredientId: ing.id } });
    expect(line!.unit).toBe("oz");
  });

  it("keeps the parsed unit when conversion is impossible", async () => {
    const ing = await prisma.ingredient.create({
      data: { name: "buttermilk ranch dressing", category: "condiment", defaultUnit: "tsp" },
    });
    const parseId = stash([{ rawName: "RANCH 16OZ" }]);
    await commitReceipt({
      parseId, store: "Walmart", tripDate: "2026-09-18", subtotal: null, tax: null, total: 10,
      items: [{ ...editBase, index: 0, parsedName: "buttermilk ranch dressing", ingredientId: ing.id, quantity: 16, unit: "oz" }],
    } as any);

    const batch = await prisma.pantryBatch.findFirst({ where: { ingredientId: ing.id } });
    expect(batch!.unit).toBe("oz"); // no density → oz cannot reach tsp — stored honestly
    expect(batch!.quantity).toBe(16);
  });

  it("leaves same-unit batches untouched", async () => {
    const ing = await prisma.ingredient.create({
      data: { name: "green bean", category: "produce", defaultUnit: "oz" },
    });
    const parseId = stash([{ rawName: "GREEN BEANS 12OZ" }]);
    await commitReceipt({
      parseId, store: "Walmart", tripDate: "2026-09-18", subtotal: null, tax: null, total: 10,
      items: [{ ...editBase, index: 0, parsedName: "green bean", ingredientId: ing.id, quantity: 12, unit: "oz" }],
    } as any);

    const batch = await prisma.pantryBatch.findFirst({ where: { ingredientId: ing.id } });
    expect(batch!.unit).toBe("oz");
    expect(batch!.quantity).toBe(12);
  });
});
