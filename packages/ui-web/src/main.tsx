import { render } from "solid-js/web";
import "./index.css";
import "./styles/opencode-workbench.css";
import "./styles/unified-workbench.css";
import App from "./App";

const root = document.getElementById("root");

if (root) {
  render(() => <App />, root);
}
