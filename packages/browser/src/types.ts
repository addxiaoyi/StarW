import { z } from "zod";

export const BrowserUrl = z.string().url().default("");
export type BrowserUrl = z.infer<typeof BrowserUrl>;

export const BrowserInteractiveElement = z.object({
  index: z.number(),
  tag: z.string(),
  type: z.string().optional(),
  text: z.string().default(""),
  selector: z.string(),
  bounds: z.object({
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().default(0),
    height: z.number().default(0),
  }).default(() => ({ x: 0, y: 0, width: 0, height: 0 })),
  attributes: z.record(z.string(), z.string()).default(() => ({})),
});
export type BrowserInteractiveElement = z.infer<typeof BrowserInteractiveElement>;

export const BrowserActionLog = z.object({
  action: z.string(),
  timestamp: z.number().default(() => Date.now()),
  message: z.string().default(""),
  data: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type BrowserActionLog = z.infer<typeof BrowserActionLog>;

export const BrowserState = z.object({
  url: BrowserUrl,
  title: z.string().default(""),
  loading: z.boolean().default(false),
  canGoBack: z.boolean().default(false),
  canGoForward: z.boolean().default(false),
  scrollX: z.number().default(0),
  scrollY: z.number().default(0),
  zoom: z.number().default(1),
  cookies: z.record(z.string(), z.string()).default(() => ({})),
  headers: z.record(z.string(), z.string()).default(() => ({})),
  interactiveElements: z.array(BrowserInteractiveElement).default(() => []),
  actionLog: z.array(BrowserActionLog).default(() => []),
  simplifiedDom: z.string().default(""),
  textSummary: z.string().default(""),
});
export type BrowserState = z.infer<typeof BrowserState>;

export const BrowserAction = z.enum([
  "navigate",
  "go_back",
  "go_forward",
  "refresh",
  "stop",
  "scroll",
  "zoom",
  "click",
  "type",
  "select",
  "submit",
  "screenshot",
  "extract_text",
  "extract_links",
  "execute_script",
  "set_cookie",
  "clear_cookies",
]);
export type BrowserAction = z.infer<typeof BrowserAction>;

export const BrowserClickTarget = z.object({
  selector: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  elementId: z.string().optional(),
  index: z.number().optional(),
  text: z.string().optional(),
});
export type BrowserClickTarget = z.infer<typeof BrowserClickTarget>;

export const BrowserExecuteResult = z.object({
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type BrowserExecuteResult = z.infer<typeof BrowserExecuteResult>;

export const BrowserScreenshotOptions = z.object({
  format: z.enum(["png", "jpeg", "webp"]).default("png"),
  quality: z.number().min(0).max(100).default(90),
  fullPage: z.boolean().default(false),
  clip: z.object({
    x: z.number().default(0),
    y: z.number().default(0),
    width: z.number().default(800),
    height: z.number().default(600),
  }).optional(),
});
export type BrowserScreenshotOptions = z.infer<typeof BrowserScreenshotOptions>;

export const BrowserExtractResult = z.object({
  success: z.boolean(),
  text: z.string().default(""),
  links: z.array(z.object({
    url: z.string(),
    text: z.string(),
  })).default(() => []),
  title: z.string().default(""),
});
export type BrowserExtractResult = z.infer<typeof BrowserExtractResult>;

export const BrowserEvent = z.object({
  id: z.string(),
  type: z.enum(["page_loaded", "title_changed", "url_changed", "loading_start", "loading_end", "error", "console", "network_request", "state_changed"]),
  timestamp: z.number().default(() => Date.now()),
  data: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type BrowserEvent = z.infer<typeof BrowserEvent>;

export const BrowserUpdateResult = z.object({
  success: z.boolean(),
  element: BrowserInteractiveElement.optional(),
  error: z.string().optional(),
});
export type BrowserUpdateResult = z.infer<typeof BrowserUpdateResult>;
