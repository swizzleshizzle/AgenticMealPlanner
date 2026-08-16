// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import CookConfirmModal from "../CookConfirmModal";
import type { CookPreviewLine } from "../../../api/plans";

const pm = {
  id: 1,
  servings: 2,
  status: "planned",
  meal: {
    id: 5,
    name: "Pub-Style Gouda Burgers",
    servings: 2,
    ingredients: [
      { id: 1, quantity: 1, unit: "count", ingredient: { id: 101, name: "onion", defaultUnit: "count" } },
      { id: 2, quantity: 10, unit: "oz", ingredient: { id: 102, name: "ground beef", defaultUnit: "lb" } },
      { id: 3, quantity: 2, unit: "count", ingredient: { id: 103, name: "brioche bun", defaultUnit: "count" } },
    ],
  },
} as any;

const previewLine = (over: Partial<CookPreviewLine> & { sourceIngredientId: number; name: string }): CookPreviewLine => ({
  requestedQuantity: 1,
  requestedUnit: "count",
  matchedIngredientId: over.sourceIngredientId,
  matchedName: over.name,
  matchSource: "id",
  confidence: "exact",
  deductQuantity: 1,
  deductUnit: "count",
  pantryTotals: [{ unit: "count", qty: 8 }],
  projectedRemaining: { qty: 7, unit: "count" },
  included: true,
  ...over,
});

const cleanPreview: CookPreviewLine[] = [
  previewLine({ sourceIngredientId: 101, name: "onion" }),
  previewLine({ sourceIngredientId: 102, name: "ground beef", deductQuantity: 0.63, deductUnit: "lb" }),
  previewLine({ sourceIngredientId: 103, name: "brioche bun", deductQuantity: 2 }),
];

function renderModal(over: {
  onPreview?: (lines: any) => Promise<CookPreviewLine[]>;
} = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onPreview = over.onPreview ?? vi.fn().mockResolvedValue(cleanPreview);
  render(
    <CookConfirmModal
      pm={pm}
      pantryByIngredient={new Map()}
      pantryCards={[]}
      onCancel={() => {}}
      onPreview={onPreview}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onPreview };
}

describe("CookConfirmModal one-tap happy path", () => {
  afterEach(cleanup);

  it("offers a single-tap confirm when every deduction is clean", async () => {
    const { onSubmit } = renderModal();

    const cookIt = await screen.findByRole("button", { name: /cook it/i });
    // No two-step audit: the legacy "Next" gate must be gone in the happy path.
    expect(screen.queryByRole("button", { name: /^next$/i })).toBeNull();
    // Clean rows are collapsed to a summary, not an editable list.
    expect(screen.getByText(/deduct as planned/i)).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();

    fireEvent.click(cookIt);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { ingredientId: 101, quantity: 1, unit: "count" },
      { ingredientId: 102, quantity: 0.63, unit: "lb" },
      { ingredientId: 103, quantity: 2, unit: "count" },
    ]);
  });

  it("surfaces only the flagged rows for attention and excludes them from the submit", async () => {
    const flaggedPreview = [
      cleanPreview[0],
      cleanPreview[1],
      previewLine({ sourceIngredientId: 103, name: "brioche bun", confidence: "estimated", included: false, deductQuantity: 0.25, deductUnit: "package" }),
    ];
    const { onSubmit } = renderModal({ onPreview: vi.fn().mockResolvedValue(flaggedPreview) });

    await screen.findByText(/needs attention/i);
    // The flagged row renders in full (its name is visible as a row)…
    expect(screen.getByText("brioche bun")).toBeTruthy();
    // …while clean rows stay collapsed (no editable inputs for them).
    expect(screen.getAllByRole("spinbutton")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /cook it/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toEqual([
      { ingredientId: 101, quantity: 1, unit: "count" },
      { ingredientId: 102, quantity: 0.63, unit: "lb" },
    ]);
  });

  it("expands to the full deduction review on demand", async () => {
    renderModal();
    fireEvent.click(await screen.findByRole("button", { name: /review/i }));
    // All three rows now render editable.
    expect(screen.getAllByRole("spinbutton")).toHaveLength(3);
    expect(screen.getByText("onion")).toBeTruthy();
    expect(screen.getByText("ground beef")).toBeTruthy();
    expect(screen.getByText("brioche bun")).toBeTruthy();
  });

  it("buckets season-to-taste ingredients into a note instead of asking about them", async () => {
    const pmWithStaples = {
      ...pm,
      meal: {
        ...pm.meal,
        ingredients: [
          ...pm.meal.ingredients,
          { id: 4, quantity: 1, unit: "to taste", ingredient: { id: 104, name: "black pepper", defaultUnit: "tsp" } },
          { id: 5, quantity: 1, unit: "as needed", ingredient: { id: 105, name: "cooking oil", defaultUnit: "tbsp" } },
        ],
      },
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onPreview = vi.fn().mockResolvedValue(cleanPreview);
    render(
      <CookConfirmModal
        pm={pmWithStaples}
        pantryByIngredient={new Map()}
        pantryCards={[]}
        onCancel={() => {}}
        onPreview={onPreview}
        onSubmit={onSubmit}
      />,
    );

    await screen.findByRole("button", { name: /cook it/i });
    // Staples never go to the pantry check…
    const previewedIds = onPreview.mock.calls[0][0].map((l: any) => l.ingredientId);
    expect(previewedIds).toEqual([101, 102, 103]);
    // …and render as a passive note, not a question.
    expect(screen.getByText(/season to taste/i)).toBeTruthy();
    expect(screen.getByText(/black pepper, cooking oil/)).toBeTruthy();
    expect(screen.queryByText(/needs attention/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /cook it/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].map((o: any) => o.ingredientId)).toEqual([101, 102, 103]);
  });

  it("falls back to the editable amounts step when the preview fails", async () => {
    renderModal({ onPreview: vi.fn().mockRejectedValue(new Error("network")) });
    // Legacy path: recipe amounts editable, explicit Next to retry the preview.
    await screen.findByRole("button", { name: /^next$/i });
    expect(screen.getAllByRole("spinbutton").length).toBeGreaterThan(0);
  });
});
