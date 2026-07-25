import type { ToolDefinition, ToolExecutor } from "./types";

interface InteractiveElement {
  index: number;
  tag: string;
  type?: string;
  text: string;
  selector: string;
  bounds: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
}

interface ActionLog {
  action: string;
  timestamp: number;
  message: string;
  data: Record<string, unknown>;
}

interface BrowserEngineState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  scrollX: number;
  scrollY: number;
  zoom: number;
  interactiveElements: InteractiveElement[];
  actionLog: ActionLog[];
  simplifiedDom: string;
  textSummary: string;
}

interface ActionResult {
  success: boolean;
  state: BrowserEngineState;
  element?: InteractiveElement;
  error?: string;
}

class BrowserEngine {
  private state: BrowserEngineState;
  private focusedIndex: number | null = null;

  constructor(initialState: Partial<BrowserEngineState> = {}) {
    this.state = {
      url: initialState.url || "",
      title: initialState.title || "",
      loading: initialState.loading ?? false,
      canGoBack: initialState.canGoBack ?? false,
      canGoForward: initialState.canGoForward ?? false,
      scrollX: initialState.scrollX ?? 0,
      scrollY: initialState.scrollY ?? 0,
      zoom: initialState.zoom ?? 1,
      interactiveElements: initialState.interactiveElements || [],
      actionLog: initialState.actionLog || [],
      simplifiedDom: initialState.simplifiedDom || "",
      textSummary: initialState.textSummary || "",
    };
  }

  getState(): BrowserEngineState {
    return { ...this.state };
  }

  getPageInfo(): BrowserEngineState {
    this.refreshDomState();
    return this.getState();
  }

  getSimplifiedDom(): string {
    this.refreshDomState();
    return this.state.simplifiedDom;
  }

  findElementByText(text: string): InteractiveElement | undefined {
    const lower = text.toLowerCase();
    return this.state.interactiveElements.find(
      (el) => el.text.toLowerCase().includes(lower) || el.selector.toLowerCase().includes(lower),
    );
  }

  findElementByIndex(index: number): InteractiveElement | undefined {
    return this.state.interactiveElements.find((el) => el.index === index);
  }

  navigate(url: string): ActionResult {
    this.state.url = url;
    this.state.loading = true;
    this.state.title = "";
    this.focusedIndex = null;
    this.logAction("navigate", `Navigated to ${url}`, { url });

    setTimeout(() => {
      this.state.loading = false;
      this.state.title = this.extractTitleFromUrl(url);
      this.state.canGoBack = true;
      this.state.canGoForward = false;
      this.refreshDomState();
    }, 800);

    return { success: true, state: this.getState() };
  }

  click(target: { index?: number; text?: string; selector?: string }): ActionResult {
    let element: InteractiveElement | undefined;
    let description = "";

    if (typeof target.index === "number") {
      element = this.findElementByIndex(target.index);
      description = element ? `${element.tag}[${target.index}] ${element.text}` : `index ${target.index}`;
    } else if (target.text) {
      element = this.findElementByText(target.text);
      description = element ? `${element.tag}[${element.index}] ${element.text}` : `text "${target.text}"`;
    } else if (target.selector) {
      description = target.selector;
    } else {
      description = "unknown target";
    }

    if (element) {
      this.focusedIndex = element.index;
      element.attributes.clicked = "true";
    }

    this.logAction("click", `Clicked ${description}`, { target, index: element?.index });
    return { success: true, state: this.getState(), element: element ? { ...element } : undefined };
  }

  type(text: string): ActionResult {
    const focused = this.focusedIndex !== null ? this.findElementByIndex(this.focusedIndex) : undefined;
    const target = focused || this.state.interactiveElements.find((el) => el.tag === "input" || el.tag === "textarea");

    if (target && (target.tag === "input" || target.tag === "textarea" || target.tag === "select")) {
      target.text = text;
      target.attributes.value = text;
      if (this.focusedIndex !== target.index) {
        this.focusedIndex = target.index;
      }
    }

    this.logAction("type", `Typed "${text}"`, { text, index: target?.index });
    return { success: true, state: this.getState(), element: target ? { ...target } : undefined };
  }

  select(selector: string, value: string): ActionResult {
    const target = this.state.interactiveElements.find((el) => el.tag === "select" && el.selector === selector) ||
      this.state.interactiveElements.find((el) => el.tag === "select");

    if (target) {
      target.text = value;
      target.attributes.value = value;
      this.focusedIndex = target.index;
    }

    this.logAction("select", `Selected "${value}" from ${selector}`, { selector, value, index: target?.index });
    return { success: true, state: this.getState(), element: target ? { ...target } : undefined };
  }

  submit(selector: string): ActionResult {
    const target = this.state.interactiveElements.find((el) => el.tag === "form" || el.selector === selector) ||
      this.state.interactiveElements.find((el) => el.tag === "button" && el.type === "submit") ||
      this.state.interactiveElements.find((el) => el.tag === "button");

    this.logAction("submit", `Submitted form ${selector}`, { selector, index: target?.index });
    return { success: true, state: this.getState(), element: target ? { ...target } : undefined };
  }

  scroll(direction: "up" | "down" | "left" | "right", amount = 300): ActionResult {
    const deltas = {
      up: { dx: 0, dy: -amount },
      down: { dx: 0, dy: amount },
      left: { dx: -amount, dy: 0 },
      right: { dx: amount, dy: 0 },
    };
    const { dx, dy } = deltas[direction] || deltas.down;
    this.state.scrollX += dx;
    this.state.scrollY += dy;
    this.logAction("scroll", `Scrolled ${direction}`, { direction, dx, dy });
    return { success: true, state: this.getState() };
  }

  updateElementText(index: number, text: string): ActionResult {
    const element = this.findElementByIndex(index);
    if (!element) {
      const error = `Element with index ${index} not found`;
      this.logAction("update_element_text", error, { index });
      return { success: false, state: this.getState(), error };
    }

    element.text = text;
    this.logAction("update_element_text", `Updated text of [${index}] to "${text}"`, { index, text });
    return { success: true, state: this.getState(), element: { ...element } };
  }

  updateElementAttribute(index: number, attr: string, value: string): ActionResult {
    const element = this.findElementByIndex(index);
    if (!element) {
      const error = `Element with index ${index} not found`;
      this.logAction("update_element_attribute", error, { index });
      return { success: false, state: this.getState(), error };
    }

    element.attributes[attr] = value;
    this.logAction("update_element_attribute", `Updated [${index}] ${attr}="${value}"`, { index, attr, value });
    return { success: true, state: this.getState(), element: { ...element } };
  }

  async screenshot(fullPage = false): Promise<string> {
    const mockImage = `data:image/png;base64,${Buffer.from(
      `Mock screenshot of ${this.state.url}${fullPage ? " (full page)" : ""}`,
    ).toString("base64")}`;
    this.logAction("screenshot", `Screenshot captured${fullPage ? " (full page)" : ""}`, { fullPage });
    return mockImage;
  }

  extract(): { url: string; title: string; text: string; links: { url: string; text: string }[] } {
    this.refreshDomState();
    const links = this.state.interactiveElements
      .filter((el) => el.tag === "a")
      .map((el) => ({ url: `${this.state.url}${el.selector}`, text: el.text }));
    const text = `Page content from ${this.state.url}\n\nTitle: ${this.state.title}\n\n${this.state.textSummary}`;
    this.logAction("extract", "Extracted page info", { textLength: text.length, linkCount: links.length });
    return { url: this.state.url, title: this.state.title, text, links };
  }

  private refreshDomState(): void {
    this.state.interactiveElements = this.buildInteractiveElements();
    this.state.simplifiedDom = this.buildSimplifiedDom();
    this.state.textSummary = this.buildTextSummary();
  }

  private buildInteractiveElements(): InteractiveElement[] {
    const tags = ["a", "button", "input", "select", "textarea"];
    const elements: InteractiveElement[] = [];
    const hostname = this.extractHostname(this.state.url);

    tags.forEach((tag, tagIndex) => {
      const count = tag === "a" ? 4 : tag === "button" ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const index = elements.length + 1;
        const text = this.mockElementText(tag, i, hostname);
        elements.push({
          index,
          tag,
          type: tag === "input" ? (i % 2 === 0 ? "text" : "submit") : undefined,
          text,
          selector: `${tag}:nth-of-type(${i + 1})`,
          bounds: { x: 20 + i * 120, y: 80 + tagIndex * 50, width: 100, height: 32 },
          attributes: {},
        });
      }
    });

    return elements;
  }

  private mockElementText(tag: string, index: number, hostname: string): string {
    const labels: Record<string, string[]> = {
      a: ["Home", "About", "Documentation", "Contact"],
      button: ["Submit", "Cancel", "Learn more"],
      input: ["Search...", "Email address"],
      select: ["Choose category", "Choose language"],
      textarea: ["Message", "Comments"],
    };
    const list = labels[tag] || ["Item"];
    const base = list[index % list.length];
    if (tag === "a" && index === 0) return `${base} - ${hostname}`;
    return base;
  }

  private buildSimplifiedDom(): string {
    const lines: string[] = [];
    lines.push(`<page url="${this.state.url}" title="${this.state.title}">`);
    for (const el of this.state.interactiveElements) {
      const typeAttr = el.type ? ` type="${el.type}"` : "";
      const attrEntries = Object.entries(el.attributes)
        .filter(([key]) => key !== "clicked" && key !== "value")
        .map(([key, val]) => ` ${key}="${val}"`)
        .join("");
      lines.push(`  [${el.index}] <${el.tag}${typeAttr}${attrEntries}>${el.text}</${el.tag}>`);
    }
    lines.push("</page>");
    return lines.join("\n");
  }

  private buildTextSummary(): string {
    const lines = [
      `This is a mock page for ${this.state.url}.`,
      `It contains ${this.state.interactiveElements.length} interactive elements.`,
      "Use browser_click with an index or text to interact with elements.",
    ];
    return lines.join("\n");
  }

  private extractTitleFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace("www.", "");
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      const pageName = pathParts[0] || "Home";
      return `${pageName.charAt(0).toUpperCase() + pageName.slice(1)} | ${hostname}`;
    } catch {
      return "Browser";
    }
  }

  private extractHostname(url: string): string {
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return "";
    }
  }

  private logAction(action: string, message: string, data: Record<string, unknown> = {}): void {
    this.state.actionLog.push({ action, timestamp: Date.now(), message, data });
    if (this.state.actionLog.length > 200) {
      this.state.actionLog = this.state.actionLog.slice(-200);
    }
  }
}

let sharedEngine: BrowserEngine | null = null;

function getSharedEngine(): BrowserEngine {
  if (!sharedEngine) {
    sharedEngine = new BrowserEngine();
  }
  return sharedEngine;
}

export const definition: ToolDefinition = {
  name: "browser_navigate",
  description: "Navigate the mock browser to a URL and return structured page info.",
  parameters: {
    url: {
      type: "string",
      description: "URL to navigate to",
      required: true,
    },
  },
};

export interface BrowserNavigateInput {
  url: string;
}

export const execute: ToolExecutor<BrowserNavigateInput, ActionResult> = async (input) => {
  const engine = getSharedEngine();
  const result = engine.navigate(input.url);
  await new Promise((resolve) => setTimeout(resolve, 900));
  return { success: true, output: { ...result, state: engine.getState() } };
};

export const clickDefinition: ToolDefinition = {
  name: "browser_click",
  description: "Click an element by index or visible text in the mock browser. Returns the affected element.",
  parameters: {
    index: {
      type: "number",
      description: "Element index from the simplified DOM",
      required: false,
    },
    text: {
      type: "string",
      description: "Visible text of the element to click",
      required: false,
    },
  },
};

export interface BrowserClickInput {
  index?: number;
  text?: string;
}

export const clickExecute: ToolExecutor<BrowserClickInput, ActionResult> = async (input) => {
  const engine = getSharedEngine();
  const result = engine.click({ index: input.index, text: input.text });
  return { success: true, output: { ...result, state: engine.getState() } };
};

export const typeDefinition: ToolDefinition = {
  name: "browser_type",
  description: "Type text into the currently focused mock browser input. Returns the affected element.",
  parameters: {
    text: {
      type: "string",
      description: "Text to type",
      required: true,
    },
  },
};

export interface BrowserTypeInput {
  text: string;
}

export const typeExecute: ToolExecutor<BrowserTypeInput, ActionResult> = async (input) => {
  const engine = getSharedEngine();
  const result = engine.type(input.text);
  return { success: true, output: { ...result, state: engine.getState() } };
};

export const selectDefinition: ToolDefinition = {
  name: "browser_select",
  description: "Select a value from a dropdown in the mock browser. Returns the affected element.",
  parameters: {
    selector: {
      type: "string",
      description: "Selector of the select element",
      required: true,
    },
    value: {
      type: "string",
      description: "Value to select",
      required: true,
    },
  },
};

export interface BrowserSelectInput {
  selector: string;
  value: string;
}

export const selectExecute: ToolExecutor<BrowserSelectInput, ActionResult> = async (input) => {
  const engine = getSharedEngine();
  const result = engine.select(input.selector, input.value);
  return { success: true, output: { ...result, state: engine.getState() } };
};

export const submitDefinition: ToolDefinition = {
  name: "browser_submit",
  description: "Submit a form in the mock browser. Returns the affected element.",
  parameters: {
    selector: {
      type: "string",
      description: "Selector of the form or submit button",
      required: true,
    },
  },
};

export interface BrowserSubmitInput {
  selector: string;
}

export const submitExecute: ToolExecutor<BrowserSubmitInput, ActionResult> = async (input) => {
  const engine = getSharedEngine();
  const result = engine.submit(input.selector);
  return { success: true, output: { ...result, state: engine.getState() } };
};

export const scrollDefinition: ToolDefinition = {
  name: "browser_scroll",
  description: "Scroll the mock browser page in a direction.",
  parameters: {
    direction: {
      type: "string",
      description: "Direction to scroll: up, down, left, right",
      required: true,
    },
    amount: {
      type: "number",
      description: "Pixels to scroll (default 300)",
      required: false,
    },
  },
};

export interface BrowserScrollInput {
  direction: "up" | "down" | "left" | "right";
  amount?: number;
}

export const scrollExecute: ToolExecutor<BrowserScrollInput, ActionResult> = async (input) => {
  const engine = getSharedEngine();
  const direction = ["up", "down", "left", "right"].includes(input.direction)
    ? (input.direction as "up" | "down" | "left" | "right")
    : "down";
  const result = engine.scroll(direction, input.amount);
  return { success: true, output: { ...result, state: engine.getState() } };
};

export const updateDefinition: ToolDefinition = {
  name: "browser_update_element",
  description: "Edit an element's text or attribute in the mock browser by index.",
  parameters: {
    index: {
      type: "number",
      description: "Element index from the simplified DOM",
      required: true,
    },
    text: {
      type: "string",
      description: "New visible text/content for the element",
      required: false,
    },
    attribute: {
      type: "string",
      description: "Attribute name to update",
      required: false,
    },
    value: {
      type: "string",
      description: "New attribute value",
      required: false,
    },
  },
};

export interface BrowserUpdateInput {
  index: number;
  text?: string;
  attribute?: string;
  value?: string;
}

export const updateExecute: ToolExecutor<BrowserUpdateInput, ActionResult> = async (input) => {
  const engine = getSharedEngine();
  let result: ActionResult;

  if (input.text !== undefined) {
    result = engine.updateElementText(input.index, input.text);
  } else if (input.attribute !== undefined && input.value !== undefined) {
    result = engine.updateElementAttribute(input.index, input.attribute, input.value);
  } else {
    return { success: false, output: { success: false, state: engine.getState(), error: "No update provided" } };
  }

  return { success: result.success, output: { ...result, state: engine.getState() } };
};

export const extractDefinition: ToolDefinition = {
  name: "browser_extract",
  description: "Extract URL, title, text, and links from the mock browser page.",
  parameters: {
    includeText: {
      type: "boolean",
      description: "Include full text summary (default true)",
      required: false,
    },
  },
};

export interface BrowserExtractInput {
  includeText?: boolean;
}

export interface BrowserExtractOutput {
  url: string;
  title: string;
  text: string;
  links: { url: string; text: string }[];
}

export const extractExecute: ToolExecutor<BrowserExtractInput, BrowserExtractOutput> = async (input) => {
  const engine = getSharedEngine();
  const result = engine.extract();
  if (input.includeText === false) {
    return { success: true, output: { ...result, text: "" } };
  }
  return { success: true, output: result };
};

export const screenshotDefinition: ToolDefinition = {
  name: "browser_screenshot",
  description: "Capture a mock screenshot of the current browser page.",
  parameters: {
    fullPage: {
      type: "boolean",
      description: "Capture the full page (default false)",
      required: false,
    },
  },
};

export interface BrowserScreenshotInput {
  fullPage?: boolean;
}

export interface BrowserScreenshotOutput {
  dataUrl: string;
  url: string;
}

export const screenshotExecute: ToolExecutor<BrowserScreenshotInput, BrowserScreenshotOutput> = async (input) => {
  const engine = getSharedEngine();
  const dataUrl = await engine.screenshot(input.fullPage);
  return { success: true, output: { dataUrl, url: engine.getState().url } };
};

export function resetBrowserEngine(): void {
  sharedEngine = null;
}

export function getBrowserEngineState(): BrowserEngineState {
  return getSharedEngine().getState();
}
