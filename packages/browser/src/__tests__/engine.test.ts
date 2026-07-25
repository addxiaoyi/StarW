import { describe, expect, it, vi } from "vitest";
import { BrowserEngine } from "../engine";

describe("BrowserEngine", () => {
  it("tracks navigation history", () => {
    const engine = new BrowserEngine({ url: "https://example.com" });

    engine.navigate("openstar.dev");
    expect(engine.getState()).toMatchObject({
      url: "https://openstar.dev",
      canGoBack: true,
      canGoForward: false,
    });

    engine.goBack();
    expect(engine.getState()).toMatchObject({
      url: "https://example.com",
      canGoBack: false,
      canGoForward: true,
    });
  });

  it("updates the active input and emits state changes", () => {
    const engine = new BrowserEngine();
    const listener = vi.fn();
    const unsubscribe = engine.addListener(listener);

    engine.click({ index: 1 });
    engine.type("student@example.com");

    const email = engine.findElementByIndex(1);
    expect(email?.attributes.value).toBe("student@example.com");
    expect(email?.text).toBe("student@example.com");
    expect(engine.getState().actionLog.at(-1)?.action).toBe("type");
    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });

  it("updates select values", () => {
    const engine = new BrowserEngine();

    engine.select("#plan", "Pro");

    expect(engine.findElementByIndex(2)).toMatchObject({
      text: "Pro",
      attributes: { value: "Pro" },
    });
  });
});
