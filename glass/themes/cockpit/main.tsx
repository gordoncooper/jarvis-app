import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const el = document.getElementById("app");
if (!el) throw new Error("#app missing");
createRoot(el).render(<App />);
