import { describe, it, expect, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { shoppingTools } from "../../../agent/tools/shopping.js";
import { receiptTools } from "../../../agent/tools/receipts.js";

const prisma = new PrismaClient();
const ctx = { pageContext: {} };
const getShopping = shoppingTools.find((t) => t.name === "get_shopping_list")!;
const getReceipts = receiptTools.find((t) => t.name === "get_recent_receipts")!;

beforeEach(async () => {
  await prisma.receiptItem.deleteMany({ where: { receipt: { store: { startsWith: "test-" } } } });
  await prisma.receipt.deleteMany({ where: { store: { startsWith: "test-" } } });
  await prisma.plannedMeal.deleteMany({ where: { meal: { name: { startsWith: "test-" } } } });
  await prisma.weeklyPlan.deleteMany({ where: { weekStartDate: new Date("2026-05-11") } });
  await prisma.meal.deleteMany({ where: { name: { startsWith: "test-" } } });
});

describe("get_shopping_list", () => {
  it("returns an items array (possibly empty) for a known planId", async () => {
    const plan = await prisma.weeklyPlan.create({ data: { weekStartDate: new Date("2026-05-11"), status: "active" } });
    const result: any = await getShopping.handler({ planId: plan.id }, ctx);
    expect(Array.isArray(result.items)).toBe(true);
  });
});

describe("get_recent_receipts", () => {
  it("returns a list with totalSpend across the listed receipts", async () => {
    await prisma.receipt.create({
      data: { tripDate: new Date("2026-05-10"), store: "test-Mart", total: 42.5 as any, source: "paste" },
    });
    const result: any = await getReceipts.handler({ limit: 5 }, ctx);
    const testReceipts = result.receipts.filter((r: any) => r.store === "test-Mart");
    expect(testReceipts.length).toBeGreaterThanOrEqual(1);
    expect(typeof result.totalSpend).toBe("number");
  });
});
