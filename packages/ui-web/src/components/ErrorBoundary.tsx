import { Component, ErrorBoundary as SolidErrorBoundary, type ParentProps } from "solid-js";
import { Icon } from "./Icon";

interface FallbackProps {
  error: Error;
  reset: () => void;
}

const ErrorFallback: Component<FallbackProps> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center h-full w-full p-8 text-center">
      <div class="w-14 h-14 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mb-5">
        <Icon name="warning" size="large" />
      </div>
      <h2 class="text-xl font-semibold mb-2">界面渲染出错</h2>
      <p class="text-sm text-muted-foreground max-w-md mb-6">
        我们在渲染这个区域时遇到了意外错误。你可以点击重试，或刷新页面。
      </p>
      <div class="bg-card border border-border rounded-lg p-4 mb-6 max-w-lg w-full overflow-auto">
        <code class="text-xs text-destructive font-mono whitespace-pre-wrap">
          {props.error.message}
        </code>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          class="oc-button oc-button-ghost"
        >
          刷新页面
        </button>
        <button
          type="button"
          onClick={props.reset}
          class="oc-button oc-button-primary"
        >
          重试
        </button>
      </div>
    </div>
  );
};

export const ErrorBoundary: Component<ParentProps> = (props) => {
  return (
    <SolidErrorBoundary fallback={(error, reset) => <ErrorFallback error={error} reset={reset} />}>
      {props.children}
    </SolidErrorBoundary>
  );
};
