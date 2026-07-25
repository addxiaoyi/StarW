import {
  createContext,
  useContext,
  createSignal,
  createMemo,
  type Accessor,
  type ParentProps,
  onCleanup,
} from "solid-js";
import type { IconName } from "../components/Icon";

export type CommandSource = "palette" | "keybind" | "slash";

export interface CommandOption {
  id: string;
  title: string;
  description?: string;
  category?: string;
  icon?: IconName;
  slash?: string;
  keybind?: string;
  disabled?: boolean;
  hidden?: boolean;
  onSelect?: (source?: CommandSource) => void;
}

export interface CommandRegistration {
  key?: string;
  options: Accessor<CommandOption[]>;
}

export interface CommandContextValue {
  register: (key: string | (() => CommandOption[]), options?: () => CommandOption[]) => void;
  trigger: (id: string, source?: CommandSource) => void;
  options: Accessor<CommandOption[]>;
}

const CommandContext = createContext<CommandContextValue>();

export function useCommand(): CommandContextValue {
  const ctx = useContext(CommandContext);
  if (!ctx) {
    throw new Error("useCommand must be used within a CommandProvider");
  }
  return ctx;
}

export function CommandProvider(props: ParentProps) {
  const [registrations, setRegistrations] = createSignal<CommandRegistration[]>([]);

  const options = createMemo(() => {
    const seen = new Set<string>();
    const all: CommandOption[] = [];
    for (const reg of registrations()) {
      for (const opt of reg.options()) {
        if (seen.has(opt.id)) continue;
        seen.add(opt.id);
        all.push(opt);
      }
    }
    return all;
  });

  const trigger = (id: string, source?: CommandSource) => {
    const option = options().find((o) => o.id === id);
    option?.onSelect?.(source);
  };

  const register = (
    key: string | (() => CommandOption[]),
    optionsCb?: () => CommandOption[]
  ) => {
    const id = typeof key === "string" ? key : undefined;
    const next = typeof key === "function" ? key : optionsCb;
    if (!next) return;

    const optionsMemo = createMemo(next);
    const entry: CommandRegistration = { key: id, options: optionsMemo };
    setRegistrations((prev) => {
      if (id === undefined) return [entry, ...prev];
      return [entry, ...prev.filter((x) => x.key !== id)];
    });

    onCleanup(() => {
      setRegistrations((prev) => prev.filter((x) => x !== entry));
    });
  };

  return (
    <CommandContext.Provider value={{ register, trigger, options }}>
      {props.children}
    </CommandContext.Provider>
  );
}
