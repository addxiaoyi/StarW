import { type Component, splitProps } from "solid-js";

export interface BadgeProps {
  variant?: "default" | "secondary" | "outline" | "destructive" | "success" | "warning" | "info" | "accent";
  size?: "sm" | "md";
  class?: string;
  children?: any;
}

const variantClasses: Record<Required<BadgeProps>["variant"], string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  outline: "border border-border bg-transparent text-foreground hover:bg-muted",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  success: "bg-success-muted text-success border border-success/20",
  warning: "bg-warning-muted text-warning border border-warning/20",
  info: "bg-info-muted text-info border border-info/20",
  accent: "bg-accent-muted text-accent border border-accent/20",
};

const sizeClasses: Record<Required<BadgeProps>["size"], string> = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-0.5 text-[11px]",
};

export const Badge: Component<BadgeProps> = (props) => {
  const [local, others] = splitProps(props, ["variant", "size", "class", "children"]);
  const variant = () => local.variant ?? "default";
  const size = () => local.size ?? "sm";

  return (
    <span
      class={`inline-flex items-center gap-1 rounded-full font-medium uppercase tracking-wider transition-colors ${variantClasses[variant()]} ${sizeClasses[size()]} ${local.class ?? ""}`}
      {...others}
    >
      {local.children}
    </span>
  );
};

export default Badge;
