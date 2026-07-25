import type {
  BrowserState,
  BrowserEvent,
  BrowserAction,
  BrowserClickTarget,
  BrowserExecuteResult,
  BrowserScreenshotOptions,
  BrowserExtractResult,
  BrowserInteractiveElement,
  BrowserActionLog,
  BrowserUpdateResult,
} from "./types";
import { BrowserState as BrowserStateSchema } from "./types";

export class BrowserEngine {
  private state: BrowserState;
  private listeners: Array<(event: BrowserEvent) => void> = [];
  private focusedIndex: number | null = null;

  constructor(initialState?: Partial<BrowserState>) {
    this.state = BrowserStateSchema.parse(initialState || {});
  }

  getState(): BrowserState {
    return { ...this.state };
  }

  getPageInfo(): BrowserState {
    this.refreshDomState();
    return this.getState();
  }

  getSimplifiedDom(): string {
    this.refreshDomState();
    return this.state.simplifiedDom;
  }

  findElementByText(text: string): BrowserInteractiveElement | undefined {
    const lower = text.toLowerCase();
    return this.state.interactiveElements.find((el) =>
      el.text.toLowerCase().includes(lower) || el.selector.toLowerCase().includes(lower)
    );
  }

  findElementByIndex(index: number): BrowserInteractiveElement | undefined {
    return this.state.interactiveElements.find((el) => el.index === index);
  }

  navigate(url: string): void {
    this.state.url = url;
    this.state.loading = true;
    this.state.title = "";
    this.focusedIndex = null;

    this.logAction("navigate", `Navigated to ${url}`, { url });
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "loading_start",
      timestamp: Date.now(),
      data: { url },
    });

    setTimeout(() => {
      this.state.loading = false;
      this.state.title = this.extractTitleFromUrl(url);
      this.state.canGoBack = true;
      this.state.canGoForward = false;
      this.refreshDomState();

      this.emitEvent({
        id: `evt-${Date.now()}`,
        type: "page_loaded",
        timestamp: Date.now(),
        data: { url, title: this.state.title },
      });
      this.emitStateChange("navigate", { url });
    }, 800);
  }

  goBack(): void {
    if (!this.state.canGoBack) return;
    this.state.canGoForward = true;
    this.logAction("go_back", "Went back");
    this.emitEvent({ id: `evt-${Date.now()}`, type: "url_changed", timestamp: Date.now(), data: {} });
    this.emitStateChange("go_back");
  }

  goForward(): void {
    if (!this.state.canGoForward) return;
    this.state.canGoBack = true;
    this.logAction("go_forward", "Went forward");
    this.emitEvent({ id: `evt-${Date.now()}`, type: "url_changed", timestamp: Date.now(), data: {} });
    this.emitStateChange("go_forward");
  }

  refresh(): void {
    this.state.loading = true;
    this.logAction("refresh", "Refreshed page");
    this.emitEvent({ id: `evt-${Date.now()}`, type: "loading_start", timestamp: Date.now(), data: {} });

    setTimeout(() => {
      this.state.loading = false;
      this.refreshDomState();
      this.emitEvent({ id: `evt-${Date.now()}`, type: "page_loaded", timestamp: Date.now(), data: {} });
      this.emitStateChange("refresh");
    }, 500);
  }

  stop(): void {
    this.state.loading = false;
    this.logAction("stop", "Stopped loading");
    this.emitEvent({ id: `evt-${Date.now()}`, type: "loading_end", timestamp: Date.now(), data: {} });
    this.emitStateChange("stop");
  }

  scroll(x: number, y: number): void {
    this.state.scrollX = x;
    this.state.scrollY = y;
    this.logAction("scroll", `Scrolled to ${x},${y}`, { x, y });
    this.emitStateChange("scroll", { x, y });
  }

  scrollBy(dx: number, dy: number): void {
    this.state.scrollX += dx;
    this.state.scrollY += dy;
    this.logAction("scroll_by", `Scrolled by ${dx},${dy}`, { dx, dy });
    this.emitStateChange("scroll_by", { dx, dy });
  }

  scrollDirection(direction: "up" | "down" | "left" | "right", amount = 300): void {
    const deltas = {
      up: { dx: 0, dy: -amount },
      down: { dx: 0, dy: amount },
      left: { dx: -amount, dy: 0 },
      right: { dx: amount, dy: 0 },
    };
    const { dx, dy } = deltas[direction] || deltas.down;
    this.scrollBy(dx, dy);
    this.logAction("scroll", `Scrolled ${direction}`, { direction, dx, dy });
  }

  zoom(factor: number): void {
    this.state.zoom = Math.max(0.5, Math.min(3, this.state.zoom * factor));
    this.logAction("zoom", `Zoomed to ${this.state.zoom.toFixed(2)}x`, { zoom: this.state.zoom });
    this.emitStateChange("zoom", { zoom: this.state.zoom });
  }

  click(target: BrowserClickTarget): BrowserUpdateResult {
    let element: BrowserInteractiveElement | undefined;
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
      description = `${target.x || 0},${target.y || 0}`;
    }

    if (element) {
      this.focusedIndex = element.index;
      element.attributes.clicked = "true";
    }

    this.logAction("click", `Clicked ${description}`, { target, index: element?.index });
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "console",
      timestamp: Date.now(),
      data: { message: `Click on: ${description}` },
    });
    this.emitStateChange("click", { target, element: element ? { ...element } : undefined });

    return { success: true, element: element ? { ...element } : undefined };
  }

  type(text: string): BrowserUpdateResult {
    const element = this.focusedIndex !== null ? this.findElementByIndex(this.focusedIndex) : undefined;
    const target = element || this.state.interactiveElements.find((el) => el.tag === "input" || el.tag === "textarea");

    if (target && (target.tag === "input" || target.tag === "textarea" || target.tag === "select")) {
      target.text = text;
      target.attributes.value = text;
      if (this.focusedIndex !== target.index) {
        this.focusedIndex = target.index;
      }
    }

    this.logAction("type", `Typed "${text}"`, { text, index: target?.index });
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "console",
      timestamp: Date.now(),
      data: { message: `Type: ${text}` },
    });
    this.emitStateChange("type", { text, element: target ? { ...target } : undefined });

    return { success: true, element: target ? { ...target } : undefined };
  }

  select(selector: string, value: string): BrowserUpdateResult {
    const target = this.state.interactiveElements.find((el) => el.tag === "select" && el.selector === selector) ||
      this.state.interactiveElements.find((el) => el.tag === "select");

    if (target) {
      target.text = value;
      target.attributes.value = value;
      this.focusedIndex = target.index;
    }

    this.logAction("select", `Selected "${value}" from ${selector}`, { selector, value, index: target?.index });
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "console",
      timestamp: Date.now(),
      data: { message: `Select ${value} from ${selector}` },
    });
    this.emitStateChange("select", { selector, value, element: target ? { ...target } : undefined });

    return { success: true, element: target ? { ...target } : undefined };
  }

  submit(selector: string): BrowserUpdateResult {
    const target = this.state.interactiveElements.find((el) => el.tag === "form" || el.selector === selector) ||
      this.state.interactiveElements.find((el) => el.tag === "button" && el.type === "submit") ||
      this.state.interactiveElements.find((el) => el.tag === "button");

    this.logAction("submit", `Submitted form ${selector}`, { selector, index: target?.index });
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "console",
      timestamp: Date.now(),
      data: { message: `Submit form ${selector}` },
    });
    this.emitStateChange("submit", { selector, element: target ? { ...target } : undefined });

    return { success: true, element: target ? { ...target } : undefined };
  }

  updateElementText(index: number, text: string): BrowserUpdateResult {
    const element = this.findElementByIndex(index);
    if (!element) {
      const error = `Element with index ${index} not found`;
      this.logAction("update_element_text", error, { index });
      return { success: false, error };
    }

    element.text = text;
    this.logAction("update_element_text", `Updated text of [${index}] to "${text}"`, { index, text });
    this.emitStateChange("update_element_text", { index, text, element: { ...element } });
    return { success: true, element: { ...element } };
  }

  updateElementAttribute(index: number, attr: string, value: string): BrowserUpdateResult {
    const element = this.findElementByIndex(index);
    if (!element) {
      const error = `Element with index ${index} not found`;
      this.logAction("update_element_attribute", error, { index });
      return { success: false, error };
    }

    element.attributes[attr] = value;
    this.logAction("update_element_attribute", `Updated [${index}] ${attr}="${value}"`, { index, attr, value });
    this.emitStateChange("update_element_attribute", { index, attr, value, element: { ...element } });
    return { success: true, element: { ...element } };
  }

  async screenshot(options?: BrowserScreenshotOptions): Promise<string> {
    const opts = {
      format: "png",
      quality: 90,
      fullPage: false,
      ...options,
    };

    const mockImage = `data:image/${opts.format};base64,${Buffer.from(
      `Mock screenshot of ${this.state.url}`,
    ).toString("base64")}`;

    this.logAction("screenshot", `Screenshot captured (${opts.format}, ${opts.quality}%)`, { options: opts });
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "console",
      timestamp: Date.now(),
      data: { message: `Screenshot captured: ${opts.format}, ${opts.quality}%` },
    });

    return mockImage;
  }

  async extractText(): Promise<BrowserExtractResult> {
    const text = `Page content from ${this.state.url}\n\nTitle: ${this.state.title}\n\n${this.state.textSummary}`;
    const result: BrowserExtractResult = {
      success: true,
      text,
      title: this.state.title,
      links: [
        { url: this.state.url, text: "Current Page" },
        { url: `${this.state.url}/about`, text: "About" },
        { url: `${this.state.url}/docs`, text: "Documentation" },
      ],
    };
    this.logAction("extract_text", "Extracted page text", { textLength: text.length });
    return result;
  }

  async extractLinks(): Promise<BrowserExtractResult> {
    const result: BrowserExtractResult = {
      success: true,
      text: "",
      title: this.state.title,
      links: [
        { url: `${this.state.url}/home`, text: "Home" },
        { url: `${this.state.url}/features`, text: "Features" },
        { url: `${this.state.url}/pricing`, text: "Pricing" },
        { url: `${this.state.url}/docs`, text: "Documentation" },
        { url: `${this.state.url}/contact`, text: "Contact" },
      ],
    };
    this.logAction("extract_links", `Extracted ${result.links.length} links`);
    return result;
  }

  async executeScript(script: string): Promise<BrowserExecuteResult> {
    try {
      const result = eval(script);
      this.logAction("execute_script", `Executed script: ${script.slice(0, 50)}...`, { script });
      this.emitEvent({
        id: `evt-${Date.now()}`,
        type: "console",
        timestamp: Date.now(),
        data: { message: `Script executed: ${script.slice(0, 50)}...` },
      });
      return { success: true, result };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  setCookie(name: string, value: string): void {
    this.state.cookies[name] = value;
    this.logAction("set_cookie", `Set cookie ${name}`, { name, value });
    this.emitStateChange("set_cookie", { name, value });
  }

  clearCookies(): void {
    this.state.cookies = {};
    this.logAction("clear_cookies", "Cleared cookies");
    this.emitStateChange("clear_cookies");
  }

  setHeader(name: string, value: string): void {
    this.state.headers[name] = value;
    this.logAction("set_header", `Set header ${name}`, { name, value });
    this.emitStateChange("set_header", { name, value });
  }

  getHeaders(): Record<string, string> {
    return { ...this.state.headers };
  }

  private refreshDomState(): void {
    this.state.interactiveElements = this.buildInteractiveElements();
    this.state.simplifiedDom = this.buildSimplifiedDom();
    this.state.textSummary = this.buildTextSummary();
  }

  private buildInteractiveElements(): BrowserInteractiveElement[] {
    const tags = ["a", "button", "input", "select", "textarea"];
    const elements: BrowserInteractiveElement[] = [];
    const hostname = this.extractHostname(this.state.url);

    tags.forEach((tag, tagIndex) => {
      const count = tag === "a" ? 4 : tag === "button" ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const index = elements.length + 1;
        const text = this.mockElementText(tag, tagIndex, i, hostname);
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

  private mockElementText(tag: string, tagIndex: number, index: number, hostname: string): string {
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
    const entry: BrowserActionLog = {
      action,
      timestamp: Date.now(),
      message,
      data,
    };
    this.state.actionLog.push(entry);
    if (this.state.actionLog.length > 200) {
      this.state.actionLog = this.state.actionLog.slice(-200);
    }
  }

  addListener(listener: (event: BrowserEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emitEvent(event: BrowserEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // ignore
      }
    }
  }

  private emitStateChange(action: string, data: Record<string, unknown> = {}): void {
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "state_changed",
      timestamp: Date.now(),
      data: { action, ...data },
    });
  }

  performAction(action: BrowserAction, data?: Record<string, unknown>): void {
    switch (action) {
      case "navigate":
        this.navigate(data?.url as string || "");
        break;
      case "go_back":
        this.goBack();
        break;
      case "go_forward":
        this.goForward();
        break;
      case "refresh":
        this.refresh();
        break;
      case "stop":
        this.stop();
        break;
      case "scroll":
        this.scroll(data?.x as number || 0, data?.y as number || 0);
        break;
      case "zoom":
        this.zoom(data?.factor as number || 1);
        break;
      case "click":
        this.click(data as BrowserClickTarget);
        break;
      case "type":
        this.type(data?.text as string || "");
        break;
      case "select":
        this.select(data?.selector as string || "", data?.value as string || "");
        break;
      case "submit":
        this.submit(data?.selector as string || "");
        break;
    }
  }
}
