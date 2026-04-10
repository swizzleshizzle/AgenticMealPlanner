import { useState, useEffect } from "react";
import { getPantry, addPantryItem, updatePantryItem, deletePantryItem, type PantryItem } from "../api/pantry";
import { getIngredients, type Ingredient } from "../api/ingredients";
import PantryItemRow from "../components/PantryItemRow";

export default function Pantry() {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ ingredientId: 0, quantity: 1, unit: "", location: "pantry" });

  const load = () => {
    getPantry().then(setItems);
    getIngredients().then(setIngredients);
  };

  useEffect(load, []);

  const handleAdd = async () => {
    if (!newItem.ingredientId) return;
    const ing = ingredients.find((i) => i.id === newItem.ingredientId);
    await addPantryItem({ ...newItem, unit: newItem.unit || ing?.defaultUnit || "count" });
    setShowAdd(false);
    setNewItem({ ingredientId: 0, quantity: 1, unit: "", location: "pantry" });
    load();
  };

  const grouped = {
    fridge: items.filter((i) => i.location === "fridge"),
    freezer: items.filter((i) => i.location === "freezer"),
    pantry: items.filter((i) => i.location === "pantry"),
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Pantry</h2>
        <button onClick={() => setShowAdd(!showAdd)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          Add Item
        </button>
      </div>
      {showAdd && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ingredient</label>
            <select value={newItem.ingredientId} onChange={(e) => setNewItem({ ...newItem, ingredientId: Number(e.target.value) })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value={0}>Select...</option>
              {ingredients.map((ing) => (<option key={ing.id} value={ing.id}>{ing.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Quantity</label>
            <input type="number" value={newItem.quantity} onChange={(e) => setNewItem({ ...newItem, quantity: Number(e.target.value) })}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm" min={0} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Location</label>
            <select value={newItem.location} onChange={(e) => setNewItem({ ...newItem, location: e.target.value })}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="fridge">Fridge</option>
              <option value="freezer">Freezer</option>
              <option value="pantry">Pantry</option>
            </select>
          </div>
          <button onClick={handleAdd} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">Add</button>
        </div>
      )}
      {Object.entries(grouped).map(([location, locationItems]) => (
        <div key={location} className="mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 capitalize">{location}</h3>
          {locationItems.length === 0 ? (
            <p className="text-xs text-gray-400">Nothing here</p>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 px-4">
              {locationItems.map((item) => (
                <PantryItemRow key={item.id} item={item}
                  onUpdate={async (id, data) => { await updatePantryItem(id, data); load(); }}
                  onDelete={async (id) => { await deletePantryItem(id); load(); }} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
