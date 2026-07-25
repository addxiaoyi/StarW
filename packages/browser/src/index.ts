/**
 * OpenStar Browser Package
 *
 * Browser automation via Playwright for web scraping, testing, and interaction.
 */
export interface BrowserConfig {
  headless?: boolean;
  viewport?: { width: number; height: number };
  timeout?: number;
  userDataDir?: string;
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  html: string;
  text: string;
  links: Array<{ href: string; text: string }>;
  screenshot?: Buffer;
}

export interface BrowserElement {
  selector: string;
  tag: string;
  text: string;
  attributes: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
}

export class BrowserAutomation {
  private config: BrowserConfig;
  private browser: unknown = null;
  private page: unknown = null;

  constructor(config: BrowserConfig = {}) {
    this.config = { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 }, ...config };
  }

  async initialize(): Promise<boolean> {
    try {
      const { chromium } = await import("playwright");
      this.browser = await chromium.launch({
        headless: this.config.headless,
        timeout: this.config.timeout,
      });
      const context = await (this.browser as { newContext: (opts: Record<string, unknown>) => Promise<unknown> }).newContext({
        viewport: this.config.viewport,
      });
      this.page = await (context as { newPage: () => Promise<unknown> }).newPage();
      return true;
    } catch {
      return false;
    }
  }

  async navigate(url: string): Promise<BrowserSnapshot> {
    if (!this.page) throw new Error("Browser not initialized");
    const p = this.page as {
      goto: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
      title: () => Promise<string>;
      content: () => Promise<string>;
      evaluate: (fn: () => unknown) => Promise<unknown>;
      screenshot: (opts?: Record<string, unknown>) => Promise<Buffer>;
    };
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: this.config.timeout });
    const [title, html] = await Promise.all([p.title(), p.content()]);
    const text = await p.evaluate(() => document.body.innerText) as string;
    const links = await p.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: (a as HTMLAnchorElement).textContent?.trim() || "",
      }))
    ) as Array<{ href: string; text: string }>;
    return { url, title, html, text, links };
  }

  async click(selector: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    await (this.page as { click: (s: string) => Promise<void> }).click(selector);
  }

  async type(selector: string, text: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    await (this.page as { fill: (s: string, t: string) => Promise<void> }).fill(selector, text);
  }

  async screenshot(): Promise<Buffer | null> {
    if (!this.page) return null;
    return (this.page as { screenshot: () => Promise<Buffer> }).screenshot();
  }

  async extractText(selector: string): Promise<string> {
    if (!this.page) throw new Error("Browser not initialized");
    return (this.page as { textContent: (s: string) => Promise<string> }).textContent(selector) || "";
  }

  async close(): Promise<void> {
    if (this.browser) {
      await (this.browser as { close: () => Promise<void> }).close();
      this.browser = null;
      this.page = null;
    }
  }
}

export * from "./engine";
