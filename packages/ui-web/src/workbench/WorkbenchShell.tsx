import {
  type Component,
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { Icon } from "../components/Icon";
import {
  AgentsRuntimeView,
  BrowserRuntimeView,
  ChatRuntimeView,
  FilesRuntimeView,
  McpRuntimeView,
  SettingsRuntimeView,
  SkillsRuntimeView,
} from "../components/workbench/RuntimeViews";
import {
  InspectorPanel,
  RailNav,
  StatusBar,
  TerminalPane,
  TitleBar,
  type CommandBlock,
  type InspectorMode,
  type PaletteAction,
  type RuntimeSnapshot,
  type StarCoreAgent,
  type StarCoreMcpStatus,
  type StarCoreSkill,
  type StarCoreStatus,
  type WorkbenchMode,
} from "../components/workbench";
import {
  desktopRequest,
  hasDesktopBridge,
  subscribeDesktopEvent,
} from "../services/desktop";
import {
  cancelTerminalCommand,
  executeTerminalCommand,
} from "../services/terminal";
import {
  addTerminalSession,
  closeTerminalSession,
  createWorkbench,
  selectTerminalSession,
  type SessionHealth,
  type TerminalSession,
} from "./model";
import { filterPaletteActions, groupPaletteActions } from "./palette";

const NAV_ITEMS = [
  { id: "terminal" as const, label: "Terminal", icon: "terminal" },
  { id: "chat" as const, label: "Chat", icon: "speech-bubble" },
  { id: "files" as const, label: "Files", icon: "file-tree" },
  { id: "agents" as const, label: "Agents", icon: "subagent" },
  { id: "skills" as const, label: "Skills", icon: "zap" },
  { id: "mcp" as const, label: "MCP", icon: "providers" },
  { id: "browser" as const, label: "外部网址", icon: "window-cursor" },
];

const MODE_LABELS: Record<WorkbenchMode, string> = {
  terminal: "Terminal",
  chat: "Model Chat",
  files: "Files",
  agents: "Agents & Swarm",
  skills: "Skills",
  mcp: "MCP",
  browser: "外部网址",
  settings: "Settings",
};

let blockSequence = 0;

function nextBlockId(): string {
  blockSequence += 1;
  return `command-${Date.now()}-${blockSequence}`;
}

function workspaceLabel(workspace: string): string {
  const normalized = workspace.replaceAll("\\", "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) || "OpenStar";
}

function eventRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function applyResolvedTheme(theme: "dark" | "light") {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.toggle("dark", theme === "dark");
}

const WorkbenchShell: Component = () => {
  const initial = createWorkbench();
  const [workbench, setWorkbench] = createSignal(initial);
  const [blocks, setBlocks] = createSignal<Record<string, CommandBlock[]>>({
    [initial.activeSessionId]: [],
  });
  const [runningBySession, setRunningBySession] = createSignal<
    Record<string, string>
  >({});
  const [mode, setMode] = createSignal<WorkbenchMode>("terminal");
  const [filesDirty, setFilesDirty] = createSignal(false);
  const [settingsDirty, setSettingsDirty] = createSignal(false);
  const [inspectorMode, setInspectorMode] =
    createSignal<InspectorMode>("agents");
  const [inspectorOpen, setInspectorOpen] = createSignal(false);
  const [inspectorWidth, setInspectorWidth] = createSignal(280);
  let stopPanelResize = () => {};
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [paletteQuery, setPaletteQuery] = createSignal("");
  const [paletteIndex, setPaletteIndex] = createSignal(0);
  const [runtimeTarget, setRuntimeTarget] = createSignal<{
    mode: WorkbenchMode;
    value: string;
    nonce: number;
  } | null>(null);
  let paletteSearch!: HTMLInputElement;
  let paletteDialog!: HTMLElement;
  let paletteReturnFocus: HTMLElement | null = null;
  const [runtime, setRuntime] = createSignal<RuntimeSnapshot>({
    phase: "loading",
    skills: [],
    agents: [],
  });

  const activeSession = createMemo<TerminalSession>(() => {
    const state = workbench();
    return (
      state.sessions.find((session) => session.id === state.activeSessionId) ??
      state.sessions[0]
    );
  });

  const activeBlocks = createMemo(() => blocks()[activeSession().id] ?? []);
  const commandRunning = createMemo(() =>
    Boolean(runningBySession()[activeSession().id]),
  );
  const workspacePath = createMemo(
    () => runtime().status?.workspace || activeSession().cwd || ".",
  );
  const workspaceName = createMemo(() => workspaceLabel(workspacePath()));
  const inspectorAvailable = createMemo(() => mode() === "terminal");
  const inspectorVisible = createMemo(
    () => inspectorOpen() && inspectorAvailable(),
  );

  const requestModeChange = (nextMode: WorkbenchMode): boolean => {
    if (mode() === "files" && nextMode !== "files" && filesDirty()) {
      const discard = window.confirm(
        "当前文件有未保存修改。确定要离开文件编辑器并放弃这些修改吗？",
      );
      if (!discard) return false;
      setFilesDirty(false);
    }
    if (mode() === "settings" && nextMode !== "settings" && settingsDirty()) {
      const discard = window.confirm(
        "设置存在未保存修改。确定离开并放弃这些修改吗？",
      );
      if (!discard) return false;
      setSettingsDirty(false);
    }
    setMode(nextMode);
    return true;
  };

  const navigateTo = (nextMode: WorkbenchMode, value = "") => {
    if (!requestModeChange(nextMode)) return;
    setRuntimeTarget(
      value ? { mode: nextMode, value, nonce: Date.now() } : null,
    );
  };

  const focusTargetFor = (targetMode: WorkbenchMode) => {
    const target = runtimeTarget();
    return target?.mode === targetMode ? target : undefined;
  };

  const beginInspectorResize = (event: PointerEvent) => {
    event.preventDefault();
    stopPanelResize();
    const startX = event.clientX;
    const startWidth = inspectorWidth();
    const clamp = (value: number) => Math.min(440, Math.max(180, value));
    const move = (next: PointerEvent) => {
      const width = clamp(startWidth - (next.clientX - startX));
      setInspectorWidth(width);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.classList.remove("is-resizing-panels");
      stopPanelResize = () => {};
    };
    stopPanelResize = stop;
    document.body.classList.add("is-resizing-panels");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };

  const updateHealth = (id: string, health: SessionHealth) => {
    setWorkbench((state) => ({
      ...state,
      sessions: state.sessions.map((session) =>
        session.id === id
          ? { ...session, health, updatedAt: Date.now() }
          : session,
      ),
    }));
  };

  const updateBlock = (
    commandId: string,
    updater: (block: CommandBlock) => CommandBlock,
  ) => {
    setBlocks((current) => {
      const next: Record<string, CommandBlock[]> = {};
      for (const [sessionId, sessionBlocks] of Object.entries(current)) {
        next[sessionId] = sessionBlocks.map((block) =>
          block.id === commandId ? updater(block) : block,
        );
      }
      return next;
    });
  };

  const applyRuntimeLocation = (status: StarCoreStatus) => {
    const cwd = status.workspace || ".";
    const branch = status.branch || "";
    setWorkbench((state) => ({
      ...state,
      sessions: state.sessions.map((session) => ({
        ...session,
        cwd,
        branch,
      })),
    }));
  };

  const loadRuntime = async () => {
    if (!hasDesktopBridge()) {
      setRuntime({
        phase: "preview",
        skills: [],
        agents: [],
        error: "OpenStar desktop bridge is unavailable",
      });
      return;
    }

    setRuntime((current) => ({
      ...current,
      phase: "loading",
      error: undefined,
    }));
    try {
      const [status, skillsResult, agentsResult, mcp] = await Promise.all([
        desktopRequest<StarCoreStatus>("runtime.status"),
        desktopRequest<{ skills: StarCoreSkill[] }>("skills/list"),
        desktopRequest<{ agents: StarCoreAgent[] }>("agents/list"),
        desktopRequest<StarCoreMcpStatus>("mcp.status"),
      ]);
      applyRuntimeLocation(status);
      setRuntime({
        phase: "ready",
        status,
        skills: skillsResult.skills,
        agents: agentsResult.agents,
        mcp,
      });
    } catch (error) {
      setRuntime({
        phase: "error",
        skills: [],
        agents: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const addSession = () => {
    if (!requestModeChange("terminal")) return;
    const next = addTerminalSession(
      workbench(),
      Date.now(),
      workspacePath(),
      runtime().status?.branch || "",
    );
    const session = next.sessions.at(-1);
    if (!session) return;
    setWorkbench(next);
    setBlocks((current) => ({ ...current, [session.id]: [] }));
  };

  const selectSession = (id: string) => {
    if (!requestModeChange("terminal")) return;
    setWorkbench((state) => selectTerminalSession(state, id));
  };

  const closeSession = async (id: string) => {
    const commandId = runningBySession()[id];
    if (
      commandId &&
      !window.confirm("该终端仍有自动化命令运行。停止任务并关闭终端吗？")
    )
      return;
    if (commandId) await cancelTerminalCommand(commandId).catch(() => false);

    const state = workbench();
    const next =
      state.sessions.length === 1
        ? createWorkbench(
            Date.now(),
            workspacePath(),
            runtime().status?.branch || "",
          )
        : closeTerminalSession(state, id);

    setWorkbench(next);
    setBlocks((current) => {
      const remaining = { ...current };
      delete remaining[id];
      for (const session of next.sessions) {
        if (!remaining[session.id]) remaining[session.id] = [];
      }
      return remaining;
    });
    setRunningBySession((current) => {
      const nextRunning = { ...current };
      delete nextRunning[id];
      return nextRunning;
    });
  };

  const clearBlocks = () => {
    const id = activeSession().id;
    setBlocks((current) => ({ ...current, [id]: [] }));
  };

  const runCommand = async (command: string) => {
    const session = activeSession();
    if (command.trim().toLowerCase() === "clear") {
      clearBlocks();
      return;
    }
    if (runningBySession()[session.id]) return;

    const commandId = nextBlockId();
    const block: CommandBlock = {
      id: commandId,
      command,
      output: "",
      cwd: session.cwd,
      status: "running",
    };

    setBlocks((current) => ({
      ...current,
      [session.id]: [...(current[session.id] ?? []), block],
    }));
    setRunningBySession((current) => ({
      ...current,
      [session.id]: commandId,
    }));
    updateHealth(session.id, "busy");

    const result = await executeTerminalCommand(
      command,
      session.cwd,
      commandId,
    );

    updateBlock(commandId, (current) => ({
      ...current,
      output:
        result.output ||
        result.error ||
        (result.success
          ? "Command completed without output."
          : "Command failed."),
      status: result.success ? "success" : "error",
      durationMs: result.durationMs,
    }));
    updateHealth(session.id, result.success ? "ready" : "error");
    setRunningBySession((current) => {
      if (current[session.id] !== commandId) return current;
      const next = { ...current };
      delete next[session.id];
      return next;
    });
  };

  const cancelCommandForSession = async (sessionId: string) => {
    const commandId = runningBySession()[sessionId];
    if (!commandId) return;
    await cancelTerminalCommand(commandId);
  };

  const useSkill = (name: string) => {
    if (!requestModeChange("skills")) return;
    queueMicrotask(() =>
      window.dispatchEvent(
        new CustomEvent("openstar:select-skill", { detail: { name } }),
      ),
    );
  };

  const actions = createMemo<PaletteAction[]>(() => {
    const currentActions: PaletteAction[] =
      mode() === "terminal"
        ? [
            ...(activeBlocks().length
              ? [
                  {
                    id: "clear-terminal",
                    label: "清空终端输出",
                    detail: activeSession().title,
                    icon: "reset",
                    category: "当前视图",
                    keywords: ["clear", "terminal", "output", "清空"],
                    run: clearBlocks,
                  } satisfies PaletteAction,
                ]
              : []),
            ...(commandRunning()
              ? [
                  {
                    id: "stop-terminal-command",
                    label: "停止当前命令",
                    detail: activeSession().title,
                    icon: "stop",
                    category: "当前视图",
                    keywords: ["stop", "cancel", "terminal", "停止"],
                    run: () => void cancelCommandForSession(activeSession().id),
                  } satisfies PaletteAction,
                ]
              : []),
            {
              id: "toggle-inspector",
              label: inspectorOpen() ? "隐藏 Inspector" : "显示 Inspector",
              detail: "切换终端运行时详情",
              icon: "layout-left",
              category: "当前视图",
              keywords: ["panel", "sidebar", "context", "检查器"],
              run: () => setInspectorOpen((value) => !value),
            },
          ]
        : [];

    const sessionActions: PaletteAction[] = [
      {
        id: "new-terminal",
        label: "新建终端",
        detail: "在当前工作区创建一个终端会话",
        icon: "plus-small",
        category: "会话",
        keywords: ["terminal", "shell", "终端", "会话"],
        keybind: "Ctrl/⌘ N",
        run: addSession,
      },
    ];

    const workspaceActions: PaletteAction[] = [
      {
        id: "refresh-runtime",
        label: "刷新运行时",
        detail: "重新读取工作区、Agent、Skill 与 MCP 状态",
        icon: "reset",
        category: "工作区",
        keywords: ["reload", "sync", "runtime", "状态", "刷新"],
        run: () => void loadRuntime(),
      },
    ];

    const navigationActions = NAV_ITEMS.map(
      (item, index) =>
        ({
          id: `show-${item.id}`,
          label: item.label,
          detail: `打开 ${MODE_LABELS[item.id]}`,
          icon: item.icon,
          category: "导航",
          keywords: [item.id, item.label, MODE_LABELS[item.id], "页面", "视图"],
          keybind: `Ctrl/⌘ ${index + 1}`,
          run: () => navigateTo(item.id),
        }) satisfies PaletteAction,
    );

    const resourceActions: PaletteAction[] = [
      ...runtime().agents.map((agent) => ({
        id: `agent:${encodeURIComponent(agent.name)}`,
        label: agent.name,
        detail:
          agent.description || `${agent.status} · ${agent.tasks} active tasks`,
        icon: "subagent",
        category: "Agents",
        keywords: ["agent", "代理", agent.role || "", agent.status],
        run: () => navigateTo("agents", agent.name),
      })),
      ...runtime().skills.map((skill) => ({
        id: `skill:${encodeURIComponent(skill.name)}`,
        label: skill.name,
        detail: skill.description || "打开 Skill 参数与执行界面",
        icon: "zap",
        category: "Skills",
        keywords: ["skill", "tool", "技能", skill.category || ""],
        run: () => navigateTo("skills", skill.name),
      })),
      ...(runtime().mcp?.servers ?? []).map((server) => ({
        id: `mcp:${encodeURIComponent(server.id || server.name)}`,
        label: server.name,
        detail: `${server.status}${server.toolCount === undefined ? "" : ` · ${server.toolCount} tools`}`,
        icon: "providers",
        category: "MCP",
        keywords: ["mcp", "server", "工具", server.status],
        run: () => navigateTo("mcp", server.id || server.name),
      })),
    ];

    const settingsActions: PaletteAction[] = [
      {
        id: "show-settings",
        label: "Settings",
        detail: "打开桌面偏好设置",
        icon: "settings-gear",
        category: "导航",
        keywords: ["preferences", "配置", "偏好"],
        keybind: "Ctrl/⌘ ,",
        run: () => navigateTo("settings"),
      },
      {
        id: "settings-general",
        label: "工作区与外观",
        detail: "定位工作区目录和主题配置",
        icon: "folder",
        category: "设置",
        keywords: ["workspace", "theme", "工作区", "主题", "外观"],
        run: () => navigateTo("settings", "settings-general"),
      },
      {
        id: "settings-providers",
        label: "模型 Provider",
        detail: "定位模型、Base URL 与 API Key",
        icon: "providers",
        category: "设置",
        keywords: ["model", "provider", "api key", "模型", "密钥"],
        run: () => navigateTo("settings", "settings-providers"),
      },
      {
        id: "settings-swarm",
        label: "Swarm",
        detail: "定位 Worker、并发与超时配置",
        icon: "subagent",
        category: "设置",
        keywords: ["worker", "concurrency", "timeout", "并发", "编排"],
        run: () => navigateTo("settings", "settings-swarm"),
      },
      {
        id: "settings-mcp",
        label: "MCP Servers",
        detail: "定位 MCP stdio Server JSON 配置",
        icon: "server",
        category: "设置",
        keywords: ["mcp", "stdio", "server", "连接"],
        run: () => navigateTo("settings", "settings-mcp"),
      },
    ];

    return [
      ...currentActions,
      ...sessionActions,
      ...workspaceActions,
      ...navigationActions,
      ...resourceActions,
      ...settingsActions,
    ];
  });

  const filteredActions = createMemo(() =>
    filterPaletteActions(actions(), paletteQuery()),
  );
  const groupedActions = createMemo(() =>
    groupPaletteActions(filteredActions()),
  );
  const paletteActionIndex = (action: PaletteAction) =>
    filteredActions().indexOf(action);

  const openPalette = () => {
    paletteReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPaletteQuery("");
    setPaletteIndex(0);
    setPaletteOpen(true);
    requestAnimationFrame(() => paletteSearch?.focus());
  };

  const closePalette = () => {
    setPaletteOpen(false);
    requestAnimationFrame(() => paletteReturnFocus?.focus());
  };

  const runPaletteAction = (index = paletteIndex()) => {
    const action = filteredActions()[index];
    if (!action) return;
    action.run();
    closePalette();
  };

  const editableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable="true"], .xterm, .xterm-helper-textarea',
      ),
    );
  };

  const handlePaletteKeydown = (event: KeyboardEvent) => {
    const count = filteredActions().length;
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setPaletteIndex((current) =>
        count ? (current + direction + count) % count : 0,
      );
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setPaletteIndex(event.key === "Home" ? 0 : Math.max(0, count - 1));
      return;
    }
    if (event.key === "Enter" && event.target === paletteSearch) {
      event.preventDefault();
      runPaletteAction();
      return;
    }
    if (event.key === "Tab") {
      const focusable = [
        ...paletteDialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const target = event.target instanceof HTMLElement ? event.target : null;
    const terminalTarget = Boolean(target?.closest(".xterm"));
    const paletteShortcut =
      modifier &&
      ((key === "k" && !terminalTarget) || (event.shiftKey && key === "p"));

    if (paletteShortcut) {
      event.preventDefault();
      if (paletteOpen()) closePalette();
      else openPalette();
      return;
    }

    if (paletteOpen() || !modifier || editableTarget(event.target)) return;

    if (!event.shiftKey && key === "n") {
      event.preventDefault();
      addSession();
      return;
    }

    if (!event.shiftKey && event.key === ",") {
      event.preventDefault();
      navigateTo("settings");
      return;
    }

    if (!event.shiftKey && /^[1-7]$/.test(event.key)) {
      const item = NAV_ITEMS[Number(event.key) - 1];
      if (!item) return;
      event.preventDefault();
      navigateTo(item.id);
    }
  };

  createEffect(() => {
    const length = filteredActions().length;
    if (paletteIndex() >= length) setPaletteIndex(Math.max(0, length - 1));
  });

  const moveTerminalTabFocus = (
    sessionId: string,
    key: "ArrowLeft" | "ArrowRight" | "Home" | "End",
  ) => {
    const sessions = workbench().sessions;
    const current = Math.max(
      0,
      sessions.findIndex((session) => session.id === sessionId),
    );
    const nextIndex =
      key === "Home"
        ? 0
        : key === "End"
          ? sessions.length - 1
          : (current + (key === "ArrowRight" ? 1 : -1) + sessions.length) %
            sessions.length;
    const next = sessions[nextIndex];
    if (!next) return;
    selectSession(next.id);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-terminal-tab-id="${next.id}"]`)
        ?.focus(),
    );
  };

  onMount(() => {
    void loadRuntime();
    void window.starcore
      ?.getTheme()
      .then(applyResolvedTheme)
      .catch(() => undefined);
    window.addEventListener("keydown", handleKeydown);
  });

  const unsubscribeEvents = subscribeDesktopEvent((event, payload) => {
    const record = eventRecord(payload);
    if (event === "command.output" && record) {
      const commandId =
        typeof record.commandId === "string" ? record.commandId : "";
      const text = typeof record.text === "string" ? record.text : "";
      if (commandId && text) {
        updateBlock(commandId, (block) => ({
          ...block,
          output: `${block.output}${text}`,
        }));
      }
      return;
    }

    if (event === "config.changed" || event === "mcp.status") {
      void loadRuntime();
    }
  });

  const unsubscribeErrors =
    window.starcore?.onError((message) => {
      setRuntime((current) => ({
        ...current,
        phase: "error",
        error: message,
      }));
    }) ?? (() => {});

  const unsubscribeSettings =
    window.starcore?.onSettingsOpen(() => {
      void requestModeChange("settings");
    }) ?? (() => {});

  const unsubscribeTheme =
    window.starcore?.onThemeChanged(applyResolvedTheme) ?? (() => {});

  onCleanup(() => {
    stopPanelResize();
    window.removeEventListener("keydown", handleKeydown);
    unsubscribeEvents();
    unsubscribeErrors();
    unsubscribeSettings();
    unsubscribeTheme();
  });

  return (
    <div
      class="sc-app"
      data-mode={mode()}
      style={`--sc-inspector-width: ${inspectorWidth()}px;`}
      classList={{
        "is-inspector-closed": !inspectorVisible(),
        "is-chat-mode": mode() === "chat",
        "is-runtime-mode": mode() !== "chat",
      }}
    >
      <TitleBar
        workspace={workspaceName()}
        sessionTitle={
          mode() === "terminal" ? activeSession().title : MODE_LABELS[mode()]
        }
        inspectorAvailable={inspectorAvailable()}
        onOpenPalette={openPalette}
        onToggleInspector={() => setInspectorOpen((value) => !value)}
      />

      <div class="sc-workbench">
        <RailNav
          items={NAV_ITEMS}
          activeMode={mode()}
          onSelect={(nextMode) => void requestModeChange(nextMode)}
          onOpenSettings={() => void requestModeChange("settings")}
        />

        <section class="sc-content">
          <Show when={mode() === "terminal"}>
            <div
              class="sc-tab-strip"
              role="tablist"
              aria-label="Terminal sessions"
            >
              <For each={workbench().sessions}>
                {(session) => (
                  <div
                    class="sc-tab"
                    classList={{
                      "is-active": session.id === activeSession().id,
                    }}
                    role="tab"
                    aria-selected={session.id === activeSession().id}
                    tabIndex={session.id === activeSession().id ? 0 : -1}
                    data-terminal-tab-id={session.id}
                    title={`${session.title} — ${session.cwd}`}
                    onClick={() => selectSession(session.id)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "ArrowLeft" ||
                        event.key === "ArrowRight" ||
                        event.key === "Home" ||
                        event.key === "End"
                      ) {
                        event.preventDefault();
                        moveTerminalTabFocus(session.id, event.key);
                      } else if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectSession(session.id);
                      }
                    }}
                  >
                    <Icon name="terminal" size="small" />
                    <span>{session.title}</span>
                    <span class={`sc-tab-state is-${session.health}`} />
                    <button
                      type="button"
                      class="sc-tab-close"
                      aria-label={`Close ${session.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void closeSession(session.id);
                      }}
                    >
                      <Icon name="close-small" size="small" />
                    </button>
                  </div>
                )}
              </For>
              <button
                type="button"
                class="sc-add-tab"
                aria-label="New terminal"
                onClick={addSession}
              >
                <Icon name="plus-small" size="small" />
              </button>
            </div>
          </Show>

          <main class="sc-stage">
            <div
              class="sc-terminal-stack"
              classList={{ "is-hidden": mode() !== "terminal" }}
            >
              <For each={workbench().sessions}>
                {(session) => (
                  <TerminalPane
                    sessionId={session.id}
                    sessionTitle={session.title}
                    cwd={session.cwd}
                    branch={session.branch}
                    blocks={blocks()[session.id] ?? []}
                    active={
                      mode() === "terminal" && session.id === activeSession().id
                    }
                    commandRunning={Boolean(runningBySession()[session.id])}
                    onRun={runCommand}
                    onCancel={() => cancelCommandForSession(session.id)}
                    onClear={() =>
                      setBlocks((current) => ({
                        ...current,
                        [session.id]: [],
                      }))
                    }
                  />
                )}
              </For>
            </div>

            <Show when={mode() !== "terminal"}>
              <Switch>
                <Match when={mode() === "chat"}>
                  <ChatRuntimeView
                    onSelectMode={(nextMode) => {
                      void requestModeChange(nextMode);
                    }}
                  />
                </Match>
                <Match when={mode() === "files"}>
                  <FilesRuntimeView
                    onRuntimeChanged={loadRuntime}
                    onDirtyChange={setFilesDirty}
                  />
                </Match>
                <Match when={mode() === "agents"}>
                  <AgentsRuntimeView
                    focusTarget={focusTargetFor("agents")}
                    onRuntimeChanged={loadRuntime}
                  />
                </Match>
                <Match when={mode() === "skills"}>
                  <SkillsRuntimeView focusTarget={focusTargetFor("skills")} />
                </Match>
                <Match when={mode() === "mcp"}>
                  <McpRuntimeView
                    focusTarget={focusTargetFor("mcp")}
                    onRuntimeChanged={loadRuntime}
                  />
                </Match>
                <Match when={mode() === "browser"}>
                  <BrowserRuntimeView />
                </Match>
                <Match when={mode() === "settings"}>
                  <SettingsRuntimeView
                    focusTarget={focusTargetFor("settings")}
                    onRuntimeChanged={loadRuntime}
                    onDirtyChange={setSettingsDirty}
                  />
                </Match>
              </Switch>
            </Show>
          </main>
        </section>

        <Show when={inspectorVisible()}>
          <div
            class="sc-panel-resizer is-inspector"
            role="separator"
            aria-label="调整检查器宽度"
            aria-orientation="vertical"
            onPointerDown={beginInspectorResize}
          />
          <InspectorPanel
            runtime={runtime()}
            mode={inspectorMode()}
            onModeChange={setInspectorMode}
            onRetry={loadRuntime}
            onUseSkill={useSkill}
          />
        </Show>
      </div>

      <StatusBar
        runtimePhase={runtime().phase}
        runtimeStatus={runtime().status}
        branch={runtime().status?.branch || ""}
        version={
          runtime().status?.version ? `v${runtime().status?.version}` : ""
        }
      />

      <Show when={paletteOpen()}>
        <div
          class="sc-palette-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) closePalette();
          }}
        >
          <section
            ref={paletteDialog}
            class="sc-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            onKeyDown={handlePaletteKeydown}
          >
            <div class="sc-palette-context">
              <span>Command palette</span>
              <strong>{MODE_LABELS[mode()]}</strong>
              <kbd>Ctrl/⌘ K</kbd>
            </div>
            <label class="sc-palette-search">
              <Icon name="magnifying-glass" size="normal" />
              <input
                ref={paletteSearch}
                type="text"
                value={paletteQuery()}
                role="combobox"
                aria-controls="command-palette-results"
                aria-activedescendant={
                  filteredActions()[paletteIndex()]
                    ? `command-palette-${filteredActions()[paletteIndex()].id}`
                    : undefined
                }
                onInput={(event) => {
                  setPaletteQuery(event.currentTarget.value);
                  setPaletteIndex(0);
                }}
                placeholder="搜索命令、页面、Agent、Skill 或 MCP"
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
              />
              <kbd>ESC</kbd>
            </label>
            <div
              id="command-palette-results"
              class="sc-palette-results"
              role="listbox"
            >
              <Show
                when={filteredActions().length > 0}
                fallback={
                  <div class="sc-palette-empty">
                    <strong>没有匹配项</strong>
                    <span>
                      尝试自由关键词，或使用 @ Agent、/ Skill、: Settings。
                    </span>
                  </div>
                }
              >
                <For each={groupedActions()}>
                  {(group) => (
                    <section class="sc-palette-group">
                      <div class="sc-palette-group-label">
                        <span>{group.category}</span>
                        <small>{group.actions.length}</small>
                      </div>
                      <For each={group.actions}>
                        {(action) => {
                          const index = () => paletteActionIndex(action);
                          return (
                            <button
                              id={`command-palette-${action.id}`}
                              type="button"
                              class="sc-palette-row"
                              classList={{
                                selected: index() === paletteIndex(),
                              }}
                              role="option"
                              aria-selected={index() === paletteIndex()}
                              onMouseEnter={() => setPaletteIndex(index())}
                              onClick={() => runPaletteAction(index())}
                            >
                              <span class="sc-palette-icon">
                                <Icon
                                  name={action.icon as never}
                                  size="normal"
                                />
                              </span>
                              <span class="sc-palette-copy">
                                <strong>{action.label}</strong>
                                <small>{action.detail}</small>
                              </span>
                              <Show
                                when={action.keybind}
                                fallback={
                                  <Icon name="chevron-right" size="small" />
                                }
                              >
                                <kbd class="sc-palette-keybind">
                                  {action.keybind}
                                </kbd>
                              </Show>
                            </button>
                          );
                        }}
                      </For>
                    </section>
                  )}
                </For>
              </Show>
            </div>
            <footer class="sc-palette-footer">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> 导航
              </span>
              <span>
                <kbd>↵</kbd> 执行
              </span>
              <span class="sc-palette-scopes">
                @ Agents · / Skills · : Settings
              </span>
            </footer>
          </section>
        </div>
      </Show>
    </div>
  );
};

export default WorkbenchShell;
