import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { applyThemeToDocument } from "./store/themeStore";
import "./index.css";

// Immediate theme execution on boot to avoid flash of unstyled theme
applyThemeToDocument();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
