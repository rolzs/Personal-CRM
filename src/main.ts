// Entry point for all three windows (main, floating quick-add, tray dropdown).
// They share the same bundle; the window label decides what is mounted.

import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import QuickAddWindow from "./windows/QuickAddWindow.svelte";
import TrayWindow from "./windows/TrayWindow.svelte";
import { bootstrap } from "./lib/bootstrap";
import { windowKind } from "./lib/native";

const kind = windowKind();
const Root = kind === "quickadd" ? QuickAddWindow : kind === "tray" ? TrayWindow : App;

mount(Root, { target: document.getElementById("app")! });
bootstrap(kind).catch((err) => {
  console.error(err);
  document.body.insertAdjacentText("beforeend", `Startup failed: ${err}`);
});
