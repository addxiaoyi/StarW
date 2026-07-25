import type { Component } from "solid-js";
import { ErrorBoundary } from "./components/ErrorBoundary";
import WorkbenchShell from "./workbench/WorkbenchShell";

const App: Component = () => <ErrorBoundary><WorkbenchShell /></ErrorBoundary>;

export default App;
