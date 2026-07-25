import { Component, createSignal, onMount, onCleanup, Show } from "solid-js";
import { Icon } from "./Icon";

type Mood = "idle" | "happy" | "thinking" | "working" | "sleepy" | "excited";

const moodIcons: Record<Mood, Parameters<typeof Icon>[0]["name"]> = {
  idle: "speech-bubble",
  happy: "circle-check",
  thinking: "help",
  working: "terminal",
  sleepy: "chevron-down",
  excited: "sparkle-2",
};

const moodTexts: Record<Mood, string> = {
  idle: "在休息~",
  happy: "好开心！",
  thinking: "思考中...",
  working: "努力工作中",
  sleepy: "好困呀",
  excited: "太棒了！",
};

interface MascotProps {
  mood: Mood;
}

const MascotFace: Component<MascotProps> = (props) => {
  const eyePath = () => {
    switch (props.mood) {
      case "happy":
        return (
          <>
            <path d="M14 21q3 3 6 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
            <path d="M28 21q3 3 6 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
          </>
        );
      case "sleepy":
        return (
          <>
            <line x1="13" y1="22" x2="21" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <line x1="27" y1="22" x2="35" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </>
        );
      case "thinking":
        return (
          <>
            <circle cx="17" cy="22" r="2.5" fill="currentColor" />
            <path d="M27 21q3 2 0 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
          </>
        );
      case "working":
        return (
          <>
            <rect x="11" y="18" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.5" fill="none" />
            <line x1="14" y1="22" x2="20" y2="22" stroke="currentColor" stroke-width="1.5" />
            <rect x="25" y="18" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.5" fill="none" />
            <line x1="28" y1="22" x2="34" y2="22" stroke="currentColor" stroke-width="1.5" />
          </>
        );
      case "excited":
        return (
          <>
            <path d="M17 19l-2 2 2 2 2-2zm14 0l-2 2 2 2 2-2z" fill="currentColor" />
          </>
        );
      default:
        return (
          <>
            <circle cx="17" cy="22" r="2.5" fill="currentColor" />
            <circle cx="31" cy="22" r="2.5" fill="currentColor" />
          </>
        );
    }
  };

  const mouthPath = () => {
    switch (props.mood) {
      case "happy":
      case "excited":
        return <path d="M18 30q6 6 12 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />;
      case "sleepy":
      case "thinking":
      case "working":
        return <path d="M21 31h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />;
      default:
        return <path d="M20 30q4 3 8 0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />;
    }
  };

  return (
    <svg viewBox="0 0 48 48" class="w-full h-full">
      <defs>
        <linearGradient id="petGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="color-mix(in srgb, var(--oc-accent), white 30%)" />
          <stop offset="100%" stop-color="var(--oc-accent)" />
        </linearGradient>
      </defs>
      <g class="transition-all duration-300">
        <path d="M12 14L8 28L18 22Z" fill="url(#petGradient)" />
        <path d="M36 14L40 28L30 22Z" fill="url(#petGradient)" />
        <circle cx="24" cy="28" r="16" fill="url(#petGradient)" />
        <g class="text-card-foreground">{eyePath()}</g>
        <g class="text-card-foreground">{mouthPath()}</g>
      </g>
    </svg>
  );
};

const PetCompanion: Component = () => {
  const [mood, setMood] = createSignal<Mood>("idle");
  const [bounce, setBounce] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal(false);
  const [xp, setXp] = createSignal(256);
  const [level, setLevel] = createSignal(3);
  const [name] = createSignal("星宝");
  const [pos, setPos] = createSignal({ right: 16, bottom: 16 });
  const [dragging, setDragging] = createSignal(false);
  const [dragOrigin, setDragOrigin] = createSignal({ x: 0, y: 0, right: 0, bottom: 0 });

  let animationId: number;

  onMount(() => {
    animationId = window.setInterval(() => {
      const random = Math.random();
      if (random < 0.3) {
        setMood("happy");
        setBounce(true);
        setTimeout(() => setBounce(false), 500);
      } else if (random < 0.5) {
        setMood("sleepy");
      } else if (random < 0.7) {
        setMood("thinking");
      } else {
        setMood("idle");
      }
    }, 5000);

    const handleMove = (e: MouseEvent) => {
      if (!dragging()) return;
      const dx = dragOrigin().x - e.clientX;
      const dy = e.clientY - dragOrigin().y;
      setPos({
        right: Math.max(16, dragOrigin().right + dx),
        bottom: Math.max(16, dragOrigin().bottom - dy),
      });
    };

    const handleUp = () => setDragging(false);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    onCleanup(() => {
      clearInterval(animationId);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    });
  });

  const startDrag = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setDragging(true);
    setDragOrigin({ x: e.clientX, y: e.clientY, right: pos().right, bottom: pos().bottom });
  };

  const handleClick = () => {
    if (dragging()) return;
    setMood("happy");
    setBounce(true);
    setXp((x) => x + 5);
    setTimeout(() => setBounce(false), 500);

    if (xp() >= 400) {
      setLevel((l) => l + 1);
      setXp(0);
      setMood("excited");
    }
  };

  const interact = (newMood: Mood, delta: number) => {
    setMood(newMood);
    setXp((x) => x + delta);
    setBounce(true);
    setTimeout(() => setBounce(false), 400);
  };

  return (
    <Show
      when={!collapsed()}
      fallback={
        <button
          onClick={() => setCollapsed(false)}
          class="fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full bg-card border border-border shadow-xl hover:scale-110 transition-transform overflow-hidden p-1.5"
          style={{ right: `${pos().right}px`, bottom: `${pos().bottom}px` }}
          title="显示桌宠"
        >
          <MascotFace mood={mood()} />
        </button>
      }
    >
      <div
        class="fixed z-50 select-none"
        style={{ right: `${pos().right}px`, bottom: `${pos().bottom}px` }}
        onMouseDown={startDrag}
      >
        <div
          class={`bg-card/90 backdrop-blur-sm rounded-2xl border border-border shadow-xl p-3 w-56 cursor-pointer transition-transform hover:scale-[1.02] ${
            bounce() ? "animate-bounce" : ""
          }`}
          onClick={handleClick}
        >
          <div class="flex items-start gap-3">
            <div class="w-12 h-12 shrink-0">
              <MascotFace mood={mood()} />
            </div>
            <div class="min-w-0 flex-1">
              <div class="font-medium text-sm">{name()}</div>
              <div class="text-xs text-muted-foreground">Lv.{level()}</div>
              <div class="text-xs text-muted-foreground mt-0.5 truncate">{moodTexts[mood()]}</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed(true);
              }}
              class="oc-icon-button text-muted-foreground hover:text-foreground shrink-0"
              title="收起"
            >
              <Icon name="close-small" size="small" />
            </button>
          </div>

          <div class="mt-2">
            <div class="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>XP</span>
              <span>
                {xp()}/400
              </span>
            </div>
            <div class="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-accent to-info transition-all"
                style={{ width: `${(xp() / 400) * 100}%` }}
              />
            </div>
          </div>

          <div class="mt-2 flex gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                interact("happy", 10);
              }}
              class="flex-1 h-7 inline-flex items-center justify-center gap-1 text-xs bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors"
              title="抚摸"
            >
              <Icon name={moodIcons.happy} size="small" />
              抚摸
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                interact("excited", 15);
              }}
              class="flex-1 h-7 inline-flex items-center justify-center gap-1 text-xs bg-warning/10 text-warning rounded hover:bg-warning/20 transition-colors"
              title="喂食"
            >
              <Icon name={moodIcons.excited} size="small" />
              喂食
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                interact("working", 20);
              }}
              class="flex-1 h-7 inline-flex items-center justify-center gap-1 text-xs bg-info/10 text-info rounded hover:bg-info/20 transition-colors"
              title="工作"
            >
              <Icon name={moodIcons.working} size="small" />
              工作
            </button>
          </div>
        </div>
        <div class="text-center text-[10px] text-muted-foreground/50 mt-1">点击互动 · 拖拽移动</div>
      </div>
    </Show>
  );
};

export default PetCompanion;
