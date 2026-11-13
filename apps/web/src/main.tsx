import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App.tsx";

// Touch devices always get the on-screen joystick.
if (navigator.maxTouchPoints > 0 || "ontouchstart" in window) document.documentElement.classList.add("has-touch");
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
