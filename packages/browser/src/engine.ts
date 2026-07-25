
// ─── In-memory browser canvas engine ─────────────────────────────────

export interface BrowserInteractiveElement {
  index: number;
  selector: string;
  tag: "input" | "textarea" | "select" | "button" | "a";
  type?: string;
  text: string;
  attributes: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface BrowserActionLogEntry {
  action: string;
  message: string;
  timestamp: number;
}

export interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  interactiveElements: BrowserInteractiveElement[];
  actionLog: BrowserActionLogEntry[];
}

export interface BrowserEvent {
  type: "state_changed";
  data: Record<string, unknown>;
}

export interface BrowserEngineConfig {
  url?: string;
}

type BrowserListener = (event: BrowserEvent) => void;

function makeCanvasElements(): BrowserInteractiveElement[] {
  return [
    {
      index: 1,
      selector: "#email",
      tag: "input",
      type: "email",
      text: "",
      attributes: { placeholder: "Email", value: "" },
      bounds: { x: 80, y: 90, width: 280, height: 36 },
    },
    {
      index: 2,
      selector: "#plan",
      tag: "select",
      text: "Starter",
      attributes: { value: "Starter" },
      bounds: { x: 80, y: 150, width: 180, height: 36 },
    },
    {
      index: 3,
      selector: "#submit",
      tag: "button",
      type: "submit",
      text: "Submit",
      attributes: { type: "submit" },
      bounds: { x: 80, y: 210, width: 110, height: 36 },
    },
    {
      index: 4,
      selector: "a.docs",
      tag: "a",
      text: "Documentation",
      attributes: { href: "https://example.com/docs" },
      bounds: { x: 80, y: 275, width: 150, height: 30 },
    },
  ];
}

function titleFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

export class BrowserEngine {
  private state: BrowserState;
  private history: string[];
  private historyIndex = 0;
  private listeners = new Set<BrowserListener>();
  private activeElementIndex: number | null = null;

  constructor(config: BrowserEngineConfig = {}) {
    const url = config.url ?? "https://example.com";
    this.history = [url];
    this.state = {
      url,
      title: titleFromUrl(url),
      loading: false,
      canGoBack: false,
      canGoForward: false,
      interactiveElements: makeCanvasElements(),
      actionLog: [],
    };
  }

  getState(): BrowserState {
    return {
      ...this.state,
      interactiveElements: this.state.interactiveElements.map((element) => ({
        ...element,
        attributes: { ...element.attributes },
        bounds: { ...element.bounds },
      })),
      actionLog: this.state.actionLog.map((entry) => ({ ...entry })),
    };
  }

  addListener(listener: BrowserListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  navigate(url: string): void {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(normalized);
    this.historyIndex = this.history.length - 1;
    this.loadHistoryEntry("navigate", `Navigated to ${normalized}`);
  }

  refresh(): void {
    this.recordAction("refresh", `Refreshed ${this.state.url}`);
  }

  goBack(): void {
    if (this.historyIndex === 0) return;
    this.historyIndex -= 1;
    this.loadHistoryEntry("back", `Went back to ${this.history[this.historyIndex]}`);
  }

  goForward(): void {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.loadHistoryEntry("forward", `Went forward to ${this.history[this.historyIndex]}`);
  }

  click(target: { index: number }): void {
    const element = this.findElementByIndex(target.index);
    if (!element) throw new Error(`Browser element ${target.index} not found`);
    this.activeElementIndex = element.index;
    this.recordAction("click", `Clicked ${element.selector}`, element.index);
  }

  type(text: string): void {
    const element = this.activeElementIndex === null
      ? this.state.interactiveElements.find((candidate) =>
          candidate.tag === "input" || candidate.tag === "textarea"
        )
      : this.findElementByIndex(this.activeElementIndex);

    if (!element || (element.tag !== "input" && element.tag !== "textarea")) {
      throw new Error("No active input element");
    }

    this.updateElement(element.index, {
      text,
      attributes: { ...element.attributes, value: text },
    });
    this.recordAction("type", `Typed into ${element.selector}`, element.index);
  }

  select(selector: string, value: string): void {
    const element = this.state.interactiveElements.find((candidate) => candidate.selector === selector);
    if (!element || element.tag !== "select") {
      throw new Error(`Select element ${selector} not found`);
    }

    this.updateElement(element.index, {
      text: value,
      attributes: { ...element.attributes, value },
    });
    this.recordAction("select", `Selected ${value} in ${selector}`, element.index);
  }

  submit(selector: string): void {
    const element = this.state.interactiveElements.find((candidate) => candidate.selector === selector);
    if (!element) throw new Error(`Submit element ${selector} not found`);
    this.recordAction("submit", `Submitted ${selector}`, element.index);
  }

  findElementByIndex(index: number): BrowserInteractiveElement | undefined {
    return this.state.interactiveElements.find((element) => element.index === index);
  }

  updateElementText(index: number, text: string): void {
    const element = this.findElementByIndex(index);
    if (!element) throw new Error(`Browser element ${index} not found`);
    this.updateElement(index, { text });
    this.recordAction("edit", `Updated text for ${element.selector}`, index);
  }

  updateElementAttribute(index: number, name: string, value: string): void {
    const element = this.findElementByIndex(index);
    if (!element) throw new Error(`Browser element ${index} not found`);
    this.updateElement(index, {
      attributes: { ...element.attributes, [name]: value },
    });
    this.recordAction("edit", `Updated ${name} for ${element.selector}`, index);
  }

  private loadHistoryEntry(action: string, message: string): void {
    const url = this.history[this.historyIndex];
    this.state = {
      ...this.state,
      url,
      title: titleFromUrl(url),
      loading: false,
      canGoBack: this.historyIndex > 0,
      canGoForward: this.historyIndex < this.history.length - 1,
      interactiveElements: makeCanvasElements(),
    };
    this.activeElementIndex = null;
    this.recordAction(action, message);
  }

  private updateElement(
    index: number,
    patch: Partial<Pick<BrowserInteractiveElement, "text" | "attributes">>,
  ): void {
    this.state = {
      ...this.state,
      interactiveElements: this.state.interactiveElements.map((element) =>
        element.index === index ? { ...element, ...patch } : element
      ),
    };
  }

  private recordAction(action: string, message: string, index?: number): void {
    this.state = {
      ...this.state,
      canGoBack: this.historyIndex > 0,
      canGoForward: this.historyIndex < this.history.length - 1,
      actionLog: [
        ...this.state.actionLog,
        { action, message, timestamp: Date.now() },
      ],
    };
    this.emit({ action, message, index });
  }

  private emit(data: Record<string, unknown>): void {
    const event: BrowserEvent = { type: "state_changed", data };
    for (const listener of this.listeners) listener(event);
  }
}
