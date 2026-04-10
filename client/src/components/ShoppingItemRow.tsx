import type { ShoppingItem } from "../api/shopping";

interface Props {
  item: ShoppingItem;
  onToggle: (id: number, checked: boolean) => void;
}

export default function ShoppingItemRow({ item, onToggle }: Props) {
  return (
    <div className={`flex items-center justify-between py-3 border-b border-gray-100 ${item.checked ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-3">
        <input type="checkbox" checked={item.checked} onChange={() => onToggle(item.id, !item.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600" />
        <span className={`text-sm ${item.checked ? "line-through text-gray-400" : "text-gray-900"}`}>
          {item.ingredient.name}
        </span>
        <span className="text-xs text-gray-400">{item.ingredient.category}</span>
      </div>
      <div className="text-sm text-gray-600">
        <span className="font-medium">{item.quantityToBuy}</span>
        <span className="text-gray-400"> {item.ingredient.defaultUnit}</span>
        {item.quantityOnHand > 0 && (
          <span className="text-xs text-gray-400 ml-2">(have {item.quantityOnHand})</span>
        )}
      </div>
    </div>
  );
}
