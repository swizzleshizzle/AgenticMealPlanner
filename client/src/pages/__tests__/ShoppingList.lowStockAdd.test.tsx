// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ShoppingList from "../ShoppingList";
import { parseWeekParam } from "../../api/plans";

vi.mock("../../api/plans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/plans")>()),
  getPlans: vi.fn(),
}));
vi.mock("../../api/shopping", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/shopping")>()),
  getShoppingList: vi.fn(),
  getLowStockSuggestions: vi.fn(),
  getCustomShoppingItems: vi.fn(),
  createCustomShoppingItem: vi.fn(),
}));

import { getPlans } from "../../api/plans";
import {
  getShoppingList,
  getLowStockSuggestions,
  getCustomShoppingItems,
  createCustomShoppingItem,
} from "../../api/shopping";

const week = parseWeekParam(null);

describe("ShoppingList low-stock add", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(createCustomShoppingItem).mockClear();
  });

  beforeEach(() => {
    vi.mocked(getPlans).mockResolvedValue([{ id: 1, weekStartDate: week, status: "active", plannedMeals: [] }]);
    vi.mocked(getShoppingList).mockResolvedValue({ items: [], staples: [] });
    vi.mocked(getCustomShoppingItems).mockResolvedValue([]);
    vi.mocked(getLowStockSuggestions).mockResolvedValue([
      { ingredientId: 55, name: "jasmine rice", currentQty: 0.5, currentUnit: "cup", threshold: 3, thresholdUnit: "cup" },
    ]);
    vi.mocked(createCustomShoppingItem).mockResolvedValue({
      id: 900, planId: 1, name: "jasmine rice", qtyText: "2.5 cup", checked: false, createdAt: new Date().toISOString(),
    });
  });

  it("adds the low-stock item to the list as a custom item", async () => {
    render(
      <MemoryRouter initialEntries={[`/shopping?week=${week}`]}>
        <ShoppingList />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /add to list/i }));

    await waitFor(() => expect(createCustomShoppingItem).toHaveBeenCalledTimes(1));
    const [planId, payload] = vi.mocked(createCustomShoppingItem).mock.calls[0];
    expect(planId).toBe(1);
    expect(payload.name).toBe("jasmine rice");
    // Suggested amount: enough to get back to the low-stock threshold.
    expect(payload.qtyText).toBe("2.5 cup");

    // The item lands in the visible custom list and the suggestion row clears.
    await screen.findByText("jasmine rice");
    await waitFor(() => expect(screen.queryByRole("button", { name: /add to list/i })).toBeNull());
  });
});
