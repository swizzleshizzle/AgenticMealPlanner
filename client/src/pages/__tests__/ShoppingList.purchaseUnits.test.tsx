// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ShoppingList from "../ShoppingList";
import { parseWeekParam } from "../../api/plans";
import type { ShoppingItem } from "../../api/shopping";

vi.mock("../../api/plans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/plans")>()),
  getPlans: vi.fn(),
}));
vi.mock("../../api/shopping", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/shopping")>()),
  getShoppingList: vi.fn(),
  getLowStockSuggestions: vi.fn(),
  getCustomShoppingItems: vi.fn(),
}));

import { getPlans } from "../../api/plans";
import { getShoppingList, getLowStockSuggestions, getCustomShoppingItems } from "../../api/shopping";

const week = parseWeekParam(null);

const item = (over: Partial<ShoppingItem> & { id: number; ingredient: any }): ShoppingItem => ({
  quantityNeeded: 42,
  quantityOnHand: 0,
  quantityToBuy: 42,
  checked: false,
  partial: false,
  ...over,
});

describe("ShoppingList purchase units", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(getPlans).mockResolvedValue([{ id: 1, weekStartDate: week, status: "active", plannedMeals: [] }]);
    vi.mocked(getLowStockSuggestions).mockResolvedValue([]);
    vi.mocked(getCustomShoppingItems).mockResolvedValue([]);
    vi.mocked(getShoppingList).mockResolvedValue({
      items: [
        item({
          id: 1,
          ingredient: {
            id: 101, name: "chicken cutlet", category: "protein", defaultUnit: "oz",
            purchaseUnitName: "1-lb pack", purchaseUnitQty: 16,
          } as any,
        }),
        item({
          id: 2,
          quantityNeeded: 5, quantityToBuy: 5,
          ingredient: { id: 102, name: "scallion", category: "produce", defaultUnit: "piece" } as any,
        }),
      ],
      staples: [],
    });
  });

  it("shows configured items in retail units with the precise amount as fine print", async () => {
    render(
      <MemoryRouter initialEntries={[`/shopping?week=${week}`]}>
        <ShoppingList />
      </MemoryRouter>,
    );
    await screen.findByText("chicken cutlet");
    expect(screen.getByText("3 × 1-lb pack")).toBeTruthy();
    expect(screen.getByText(/42 oz/)).toBeTruthy();
    // Unconfigured items keep the plain recipe-unit amount.
    expect(screen.getByText(/5 piece/)).toBeTruthy();
  });
});
