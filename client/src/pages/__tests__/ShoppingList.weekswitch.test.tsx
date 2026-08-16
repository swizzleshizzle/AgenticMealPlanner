// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ShoppingList from "../ShoppingList";
import { parseWeekParam, formatLocalDate, localMidnightFromISO } from "../../api/plans";
import type { ShoppingItem } from "../../api/shopping";

// Mock only the network calls; keep the pure week helpers real.
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

const weekA = parseWeekParam(null); // current week (never "past", so rows render live)
const weekB = (() => {
  const d = localMidnightFromISO(weekA);
  d.setDate(d.getDate() + 7);
  return formatLocalDate(d);
})();

const item = (id: number, name: string): ShoppingItem => ({
  id,
  quantityNeeded: 2,
  quantityOnHand: 0,
  quantityToBuy: 2,
  checked: false,
  partial: false,
  ingredient: { id, name, category: "produce", defaultUnit: "count" } as ShoppingItem["ingredient"],
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("ShoppingList week switching", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(getPlans).mockResolvedValue([
      { id: 1, weekStartDate: weekA, status: "active", plannedMeals: [] },
      { id: 2, weekStartDate: weekB, status: "active", plannedMeals: [] },
    ]);
    vi.mocked(getLowStockSuggestions).mockResolvedValue([]);
    vi.mocked(getCustomShoppingItems).mockResolvedValue([]);
  });

  it("never shows the previous week's items under the new week's header", async () => {
    const weekBFetch = deferred<{ items: ShoppingItem[]; staples: string[] }>();
    vi.mocked(getShoppingList).mockImplementation((planId: number) =>
      planId === 1
        ? Promise.resolve({ items: [item(11, "cranberries")], staples: [] })
        : weekBFetch.promise,
    );

    render(
      <MemoryRouter initialEntries={[`/shopping?week=${weekA}`]}>
        <ShoppingList />
      </MemoryRouter>,
    );
    await screen.findByText("cranberries");

    // Switch weeks. Week B's fetch is still in flight — the old week's items
    // must NOT keep rendering under the new week's header.
    fireEvent.click(screen.getByLabelText("Next week"));
    expect(screen.queryByText("cranberries")).toBeNull();

    await act(async () => {
      weekBFetch.resolve({ items: [item(22, "bananas")], staples: [] });
    });
    await screen.findByText("bananas");
    expect(screen.queryByText("cranberries")).toBeNull();
  });

  it("ignores a slow response for a week the user has already left", async () => {
    const weekBFetch = deferred<{ items: ShoppingItem[]; staples: string[] }>();
    vi.mocked(getShoppingList).mockImplementation((planId: number) =>
      planId === 1
        ? Promise.resolve({ items: [item(11, "cranberries")], staples: [] })
        : weekBFetch.promise,
    );

    render(
      <MemoryRouter initialEntries={[`/shopping?week=${weekA}`]}>
        <ShoppingList />
      </MemoryRouter>,
    );
    await screen.findByText("cranberries");

    // A → B → back to A while B's fetch never resolved…
    fireEvent.click(screen.getByLabelText("Next week"));
    fireEvent.click(screen.getByLabelText("Previous week"));
    await screen.findByText("cranberries");

    // …then B's response finally lands. It must not clobber week A's list.
    await act(async () => {
      weekBFetch.resolve({ items: [item(22, "bananas")], staples: [] });
    });
    expect(screen.queryByText("bananas")).toBeNull();
    await screen.findByText("cranberries");
  });
});
