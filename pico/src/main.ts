import { mount } from "svelte";
import "./index.css";
import App from "@/app/App.svelte";

// A redeploy replaces the hashed chunks an open app may still ask for; reload
// to pick up the new build instead of failing the import.
window.addEventListener("vite:preloadError", () => window.location.reload());

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

const app = mount(App, {
  target: root,
});

export default app;
