import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Recipes from "./pages/Recipes";
import RecipeDetail from "./pages/RecipeDetail";
import RecipeImport from "./pages/RecipeImport";
import Planner from "./pages/Planner";
import Pantry from "./pages/Pantry";
import ShoppingList from "./pages/ShoppingList";
import Chat from "./pages/Chat";
import { ToastProvider } from "./components/ui/ToastProvider";

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/recipes/:id" element={<RecipeDetail />} />
            <Route path="/recipes/import" element={<RecipeImport />} />
            <Route path="/planner" element={<Planner />} />
            <Route path="/pantry" element={<Pantry />} />
            <Route path="/shopping" element={<ShoppingList />} />
            <Route path="/chat" element={<Chat />} />
          </Route>
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
