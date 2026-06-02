import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import type { ToolDef } from "../types.js";


const getRecentReceipts: ToolDef = {
  name: "get_recent_receipts",
  description: "List the most recent receipts with their totals; also returns sum of totals across the result.",
  schema: z.object({ limit: z.number().int().positive().max(50).optional() }),
  handler: async (input) => {
    const limit = input.limit ?? 10;
    const receipts = await prisma.receipt.findMany({
      orderBy: { tripDate: "desc" },
      take: limit,
      select: { id: true, tripDate: true, store: true, total: true },
    });
    const totalSpend = receipts.reduce((acc, r) => acc + Number(r.total ?? 0), 0);
    return {
      receipts: receipts.map((r) => ({
        id: r.id,
        tripDate: r.tripDate.toISOString().slice(0, 10),
        store: r.store,
        total: Number(r.total ?? 0),
      })),
      totalSpend,
    };
  },
};

export const receiptTools: ToolDef[] = [getRecentReceipts];
