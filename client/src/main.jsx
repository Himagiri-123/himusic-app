import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./styles.css";

registerSW({ immediate: true });

const saved = localStorage.getItem("hm_theme");
if (saved) document.documentElement.dataset.theme = saved;

createRoot(document.getElementById("root")).render(<App />);
