import { mount } from "svelte";
import "./index.css";
import App from "@/app/App.svelte";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

const app = mount(App, {
  target: root,
});

export default app;
