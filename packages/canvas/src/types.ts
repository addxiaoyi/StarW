import { z } from "zod";

export const CanvasColor = z.object({
  r: z.number().min(0).max(255).default(0),
  g: z.number().min(0).max(255).default(0),
  b: z.number().min(0).max(255).default(0),
  a: z.number().min(0).max(1).default(1),
});
export type CanvasColor = z.infer<typeof CanvasColor>;

export const CanvasPoint = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
});
export type CanvasPoint = z.infer<typeof CanvasPoint>;

export const CanvasRect = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(0),
  height: z.number().default(0),
});
export type CanvasRect = z.infer<typeof CanvasRect>;

export const CanvasStroke = z.object({
  color: CanvasColor.default(() => ({ r: 0, g: 0, b: 0, a: 1 })),
  width: z.number().default(1),
  lineCap: z.enum(["butt", "round", "square"]).default("round"),
  lineJoin: z.enum(["miter", "round", "bevel"]).default("round"),
  dashArray: z.array(z.number()).default(() => []),
});
export type CanvasStroke = z.infer<typeof CanvasStroke>;

export const CanvasFill = z.object({
  color: CanvasColor.default(() => ({ r: 255, g: 255, b: 255, a: 1 })),
  gradient: z.enum(["none", "linear", "radial"]).default("none"),
  gradientStart: CanvasPoint.default(() => ({ x: 0, y: 0 })),
  gradientEnd: CanvasPoint.default(() => ({ x: 100, y: 100 })),
  gradientColors: z.array(CanvasColor).default(() => []),
});
export type CanvasFill = z.infer<typeof CanvasFill>;

export const CanvasTextStyle = z.object({
  fontFamily: z.string().default("sans-serif"),
  fontSize: z.number().default(14),
  fontWeight: z.string().default("normal"),
  color: CanvasColor.default(() => ({ r: 0, g: 0, b: 0, a: 1 })),
  textAlign: z.enum(["left", "center", "right"]).default("left"),
  textBaseline: z.enum(["top", "middle", "bottom"]).default("middle"),
  letterSpacing: z.number().default(0),
});
export type CanvasTextStyle = z.infer<typeof CanvasTextStyle>;

export const CanvasNodeType = z.enum([
  "rectangle",
  "circle",
  "line",
  "path",
  "text",
  "image",
  "group",
  "connector",
  "shape",
]);
export type CanvasNodeType = z.infer<typeof CanvasNodeType>;

export const CanvasNode = z.object({
  id: z.string(),
  type: CanvasNodeType,
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(100),
  height: z.number().default(100),
  rotation: z.number().default(0),
  scaleX: z.number().default(1),
  scaleY: z.number().default(1),
  opacity: z.number().default(1),
  stroke: CanvasStroke.optional(),
  fill: CanvasFill.optional(),
  text: z.string().default(""),
  textStyle: CanvasTextStyle.optional(),
  pathData: z.string().default(""),
  imageUrl: z.string().default(""),
  borderRadius: z.number().default(0),
  children: z.array(z.string()).default(() => []),
  parentId: z.string().optional(),
  zIndex: z.number().default(0),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type CanvasNode = z.infer<typeof CanvasNode>;

export const CanvasConnection = z.object({
  id: z.string(),
  fromNodeId: z.string(),
  fromPort: z.string().optional(),
  toNodeId: z.string(),
  toPort: z.string().optional(),
  stroke: CanvasStroke.optional(),
  path: z.string().default(""),
  startArrow: z.boolean().default(false),
  endArrow: z.boolean().default(true),
});
export type CanvasConnection = z.infer<typeof CanvasConnection>;

export const CanvasState = z.object({
  nodes: z.array(CanvasNode).default(() => []),
  connections: z.array(CanvasConnection).default(() => []),
  selectedNodeIds: z.array(z.string()).default(() => []),
  viewport: z.object({
    x: z.number().default(0),
    y: z.number().default(0),
    zoom: z.number().default(1),
  }).default(() => ({ x: 0, y: 0, zoom: 1 })),
  backgroundColor: CanvasColor.default(() => ({ r: 245, g: 245, b: 247, a: 1 })),
  gridSize: z.number().default(10),
  snapToGrid: z.boolean().default(true),
});
export type CanvasState = z.infer<typeof CanvasState>;

export const CanvasTool = z.enum(["select", "rectangle", "circle", "line", "text", "path", "connector", "image", "move", "zoom"]);
export type CanvasTool = z.infer<typeof CanvasTool>;

export const CanvasEvent = z.object({
  id: z.string(),
  type: z.enum(["node_added", "node_updated", "node_deleted", "connection_added", "connection_deleted", "selection_changed", "viewport_changed", "tool_changed"]),
  timestamp: z.number().default(() => Date.now()),
  data: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type CanvasEvent = z.infer<typeof CanvasEvent>;
