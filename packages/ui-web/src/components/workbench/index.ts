/**
 * Workbench 组件模块导出
 */
export { default as TitleBar } from "./TitleBar";
export { default as RailNav } from "./RailNav";
export { default as SessionSidebar } from "./SessionSidebar";
export { default as TerminalPane } from "./TerminalPane";
export { default as InspectorPanel } from "./InspectorPanel";
export { default as StatusBar } from "./StatusBar";

export type {
  WorkbenchMode,
  InspectorMode,
  BlockStatus,
  CommandBlock,
  RuntimeSnapshot,
  RuntimePhase,
  StarCoreStatus,
  StarCoreSkill,
  StarCoreAgent,
  StarCoreMcpStatus,
  PaletteAction,
} from "../../workbench/types";
