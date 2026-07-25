import type { CanvasNode, CanvasConnection, CanvasState, CanvasEvent, CanvasTool } from "./types";
import { CanvasState as CanvasStateSchema, CanvasNode as CanvasNodeSchema } from "./types";
import crypto from "node:crypto";

export class CanvasEngine {
  private state: CanvasState;
  private listeners: Array<(event: CanvasEvent) => void> = [];
  private currentTool: CanvasTool = "select";

  constructor(initialState?: Partial<CanvasState>) {
    this.state = CanvasStateSchema.parse(initialState || {});
  }

  getState(): CanvasState {
    return { ...this.state };
  }

  getCurrentTool(): CanvasTool {
    return this.currentTool;
  }

  setTool(tool: CanvasTool): void {
    this.currentTool = tool;
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "tool_changed",
      timestamp: Date.now(),
      data: { tool },
    });
  }

  addNode(node: Partial<CanvasNode>): CanvasNode {
    const newNode = CanvasNodeSchema.parse({
      id: node.id || `node-${crypto.randomUUID().slice(0, 8)}`,
      ...node,
    });

    this.state.nodes.push(newNode);

    if (newNode.parentId) {
      const parent = this.state.nodes.find((n) => n.id === newNode.parentId);
      if (parent && !parent.children.includes(newNode.id)) {
        parent.children.push(newNode.id);
      }
    }

    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "node_added",
      timestamp: Date.now(),
      data: { node: newNode },
    });

    return newNode;
  }

  updateNode(nodeId: string, updates: Partial<CanvasNode>): boolean {
    const index = this.state.nodes.findIndex((n) => n.id === nodeId);
    if (index === -1) return false;

    this.state.nodes[index] = CanvasNodeSchema.parse({
      ...this.state.nodes[index],
      ...updates,
    });

    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "node_updated",
      timestamp: Date.now(),
      data: { nodeId, updates },
    });

    return true;
  }

  deleteNode(nodeId: string): boolean {
    const index = this.state.nodes.findIndex((n) => n.id === nodeId);
    if (index === -1) return false;

    const deleted = this.state.nodes[index];

    this.state.nodes = this.state.nodes.filter((n) => n.id !== nodeId && n.parentId !== nodeId);
    this.state.connections = this.state.connections.filter(
      (c) => c.fromNodeId !== nodeId && c.toNodeId !== nodeId,
    );
    this.state.selectedNodeIds = this.state.selectedNodeIds.filter((id) => id !== nodeId);

    for (const node of this.state.nodes) {
      node.children = node.children.filter((c) => c !== nodeId);
    }

    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "node_deleted",
      timestamp: Date.now(),
      data: { nodeId, node: deleted },
    });

    return true;
  }

  addConnection(connection: Partial<CanvasConnection>): CanvasConnection {
    const newConnection: CanvasConnection = {
      id: connection.id || `conn-${crypto.randomUUID().slice(0, 8)}`,
      fromNodeId: connection.fromNodeId!,
      toNodeId: connection.toNodeId!,
      stroke: connection.stroke,
      path: connection.path || "",
      startArrow: connection.startArrow || false,
      endArrow: connection.endArrow !== undefined ? connection.endArrow : true,
    };

    this.state.connections.push(newConnection);

    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "connection_added",
      timestamp: Date.now(),
      data: { connection: newConnection },
    });

    return newConnection;
  }

  deleteConnection(connectionId: string): boolean {
    const index = this.state.connections.findIndex((c) => c.id === connectionId);
    if (index === -1) return false;

    const deleted = this.state.connections[index];
    this.state.connections.splice(index, 1);

    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "connection_deleted",
      timestamp: Date.now(),
      data: { connectionId, connection: deleted },
    });

    return true;
  }

  selectNodes(nodeIds: string[]): void {
    this.state.selectedNodeIds = nodeIds;
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "selection_changed",
      timestamp: Date.now(),
      data: { nodeIds },
    });
  }

  selectNode(nodeId: string, multiSelect: boolean = false): void {
    if (multiSelect) {
      const index = this.state.selectedNodeIds.indexOf(nodeId);
      if (index === -1) {
        this.state.selectedNodeIds.push(nodeId);
      } else {
        this.state.selectedNodeIds.splice(index, 1);
      }
    } else {
      this.state.selectedNodeIds = [nodeId];
    }

    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "selection_changed",
      timestamp: Date.now(),
      data: { nodeIds: this.state.selectedNodeIds },
    });
  }

  clearSelection(): void {
    this.state.selectedNodeIds = [];
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "selection_changed",
      timestamp: Date.now(),
      data: { nodeIds: [] },
    });
  }

  updateViewport(x: number, y: number, zoom: number): void {
    this.state.viewport = { x, y, zoom };
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "viewport_changed",
      timestamp: Date.now(),
      data: { viewport: this.state.viewport },
    });
  }

  translateViewport(dx: number, dy: number): void {
    this.state.viewport.x += dx;
    this.state.viewport.y += dy;
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "viewport_changed",
      timestamp: Date.now(),
      data: { viewport: this.state.viewport },
    });
  }

  zoomViewport(factor: number, centerX?: number, centerY?: number): void {
    const newZoom = Math.max(0.1, Math.min(10, this.state.viewport.zoom * factor));

    if (centerX !== undefined && centerY !== undefined) {
      const worldX = centerX - this.state.viewport.x;
      const worldY = centerY - this.state.viewport.y;

      this.state.viewport.x = centerX - worldX * newZoom;
      this.state.viewport.y = centerY - worldY * newZoom;
    }

    this.state.viewport.zoom = newZoom;
    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "viewport_changed",
      timestamp: Date.now(),
      data: { viewport: this.state.viewport },
    });
  }

  setBackgroundColor(color: { r: number; g: number; b: number; a: number }): void {
    this.state.backgroundColor = color;
  }

  setGridSize(size: number): void {
    this.state.gridSize = size;
  }

  toggleSnapToGrid(): boolean {
    this.state.snapToGrid = !this.state.snapToGrid;
    return this.state.snapToGrid;
  }

  snapPoint(point: { x: number; y: number }): { x: number; y: number } {
    if (!this.state.snapToGrid) return point;

    return {
      x: Math.round(point.x / this.state.gridSize) * this.state.gridSize,
      y: Math.round(point.y / this.state.gridSize) * this.state.gridSize,
    };
  }

  getNodeById(nodeId: string): CanvasNode | undefined {
    return this.state.nodes.find((n) => n.id === nodeId);
  }

  getSelectedNodes(): CanvasNode[] {
    return this.state.selectedNodeIds
      .map((id) => this.state.nodes.find((n) => n.id === id))
      .filter((n): n is CanvasNode => n !== undefined);
  }

  getNodesByType(type: string): CanvasNode[] {
    return this.state.nodes.filter((n) => n.type === type);
  }

  groupNodes(nodeIds: string[]): CanvasNode {
    const groupNode = this.addNode({
      type: "group",
      children: [...nodeIds],
    });

    for (const id of nodeIds) {
      this.updateNode(id, { parentId: groupNode.id });
    }

    this.selectNodes([groupNode.id]);

    return groupNode;
  }

  ungroupNode(groupId: string): void {
    const group = this.getNodeById(groupId);
    if (!group || group.type !== "group") return;

    for (const childId of group.children) {
      this.updateNode(childId, { parentId: undefined });
    }

    this.deleteNode(groupId);
  }

  duplicateNode(nodeId: string): CanvasNode {
    const node = this.getNodeById(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    const newNode = this.addNode({
      ...node,
      id: undefined,
      x: node.x + 20,
      y: node.y + 20,
      parentId: node.parentId,
    });

    this.selectNodes([newNode.id]);

    return newNode;
  }

  loadTemplate(nodes: CanvasNode[], connections: CanvasConnection[] = []): void {
    this.state.nodes = [...nodes];
    this.state.connections = [...connections];
    this.state.selectedNodeIds = [];

    this.emitEvent({
      id: `evt-${Date.now()}`,
      type: "node_added",
      timestamp: Date.now(),
      data: { count: nodes.length },
    });
  }

  addListener(listener: (event: CanvasEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emitEvent(event: CanvasEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // ignore
      }
    }
  }

  toJSON(): string {
    return JSON.stringify(this.state, null, 2);
  }

  static fromJSON(json: string): CanvasEngine {
    const state = CanvasStateSchema.parse(JSON.parse(json));
    return new CanvasEngine(state);
  }
}
