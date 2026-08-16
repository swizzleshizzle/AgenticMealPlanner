// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import IngredientEditForm from "../IngredientEditForm";

vi.mock("../../../api/ingredients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/ingredients")>()),
  updateIngredient: vi.fn().mockResolvedValue({}),
}));
import { updateIngredient } from "../../../api/ingredients";

const ingredient = {
  id: 7, name: "chicken cutlet", category: "protein", defaultUnit: "oz",
  defaultLocation: null, densityGPerMl: null, gramsPerCount: null,
  shelfLifeFridgeDays: null, shelfLifeFreezerDays: null, shelfLifePantryDays: null,
  lowStockThreshold: null, lowStockUnit: null, isOneOff: false,
  purchaseUnitName: null, purchaseUnitQty: null,
} as any;

describe("IngredientEditForm purchase units", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(updateIngredient).mockClear();
  });

  it("edits and saves how the store sells the ingredient", async () => {
    render(<IngredientEditForm ingredient={ingredient} onCancel={() => {}} onSaved={() => {}} />);

    fireEvent.change(screen.getByLabelText(/sold as/i), { target: { value: "1-lb pack" } });
    fireEvent.change(screen.getByLabelText(/holds/i), { target: { value: "16" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(updateIngredient).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateIngredient).mock.calls[0][1]).toMatchObject({
      purchaseUnitName: "1-lb pack",
      purchaseUnitQty: 16,
    });
  });

  it("saves cleared purchase-unit fields as null", async () => {
    render(
      <IngredientEditForm
        ingredient={{ ...ingredient, purchaseUnitName: "1-lb pack", purchaseUnitQty: 16 }}
        onCancel={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/sold as/i), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/holds/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(updateIngredient).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateIngredient).mock.calls[0][1]).toMatchObject({
      purchaseUnitName: null,
      purchaseUnitQty: null,
    });
  });
});
