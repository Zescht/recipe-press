import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RecipeImporter } from "@/components/recipe-importer";
import "@/app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Recipe Press root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <RecipeImporter />
  </StrictMode>,
);
