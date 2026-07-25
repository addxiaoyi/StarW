export * from "./types";
export * from "./registry";
export * as bash from "./bash";
export * as read from "./read";
export * as write from "./write";
export * as edit from "./edit";
export * as grep from "./grep";
export * as glob from "./glob";
export * as browser from "./browser";

import type { ToolDefinition, ToolExecutor } from "./types";
import * as bash from "./bash";
import * as read from "./read";
import * as write from "./write";
import * as edit from "./edit";
import * as grep from "./grep";
import * as glob from "./glob";
import * as browser from "./browser";
import { ToolRegistry } from "./registry";

export interface ToolModule {
  definition: ToolDefinition;
  execute: ToolExecutor<any, any>;
}

const builtins: ToolModule[] = [
  bash as ToolModule,
  read as ToolModule,
  write as ToolModule,
  edit as ToolModule,
  grep as ToolModule,
  glob as ToolModule,
  { definition: browser.definition, execute: browser.execute },
  { definition: browser.clickDefinition, execute: browser.clickExecute },
  { definition: browser.typeDefinition, execute: browser.typeExecute },
  { definition: browser.selectDefinition, execute: browser.selectExecute },
  { definition: browser.submitDefinition, execute: browser.submitExecute },
  { definition: browser.scrollDefinition, execute: browser.scrollExecute },
  { definition: browser.updateDefinition, execute: browser.updateExecute },
  { definition: browser.extractDefinition, execute: browser.extractExecute },
  { definition: browser.screenshotDefinition, execute: browser.screenshotExecute },
];

export function registerBuiltins(registry: ToolRegistry): void {
  for (const tool of builtins) {
    registry.register(tool.definition, tool.execute);
  }
}
