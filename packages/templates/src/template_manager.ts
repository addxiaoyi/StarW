import type {
  TemplateManifest,
  TemplateInstance,
  TemplateSearchOptions,
  TemplateType,
  TemplateCategory,
} from "./types";
import { TemplateManifest as TemplateManifestSchema, TemplateInstance as TemplateInstanceSchema } from "./types";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

export class TemplateManager {
  private templates: Map<string, TemplateManifest> = new Map();
  private instances: Map<string, TemplateInstance> = new Map();
  private templatesDir: string;
  private instancesDir: string;

  constructor(templatesDir?: string, instancesDir?: string) {
    this.templatesDir = templatesDir || path.join(process.env.STARCORE_DATA_DIR || path.join(process.env.HOME || "", ".openstar"), "templates");
    this.instancesDir = instancesDir || path.join(process.env.STARCORE_DATA_DIR || path.join(process.env.HOME || "", ".openstar"), "template-instances");

    this.ensureDirectories();
    this.loadBuiltinTemplates();
    this.loadSavedTemplates();
    this.loadInstances();
  }

  private ensureDirectories(): void {
    fs.mkdirSync(this.templatesDir, { recursive: true });
    fs.mkdirSync(this.instancesDir, { recursive: true });
  }

  private loadBuiltinTemplates(): void {
    const builtins: Partial<TemplateManifest>[] = [
      {
        id: "canvas-empty",
        name: "空白画布",
        description: "从零开始创建新画布",
        type: "canvas",
        category: "canvas-empty",
        thumbnail: "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=empty%20canvas%20workspace&image_size=square",
      },
      {
        id: "canvas-grid",
        name: "网格画布",
        description: "带有参考线的网格画布",
        type: "canvas",
        category: "canvas-grid",
        thumbnail: "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=grid%20canvas%20design%20workspace&image_size=square",
      },
      {
        id: "flowchart-basic",
        name: "基础流程图",
        description: "标准流程图模板，包含开始、结束、判断等节点",
        type: "design",
        category: "flowchart",
        tags: ["flowchart", "diagram", "workflow"],
        thumbnail: "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=flowchart%20diagram%20template&image_size=square",
      },
      {
        id: "mind-map",
        name: "思维导图",
        description: "分层思维导图模板",
        type: "design",
        category: "mind-map",
        tags: ["mind-map", "brainstorm", "ideas"],
        thumbnail: "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=mind%20map%20brainstorm%20template&image_size=square",
      },
      {
        id: "ui-wireframe",
        name: "UI 线框图",
        description: "移动端和桌面端 UI 线框模板",
        type: "design",
        category: "wireframe",
        tags: ["ui", "wireframe", "mobile", "desktop"],
        thumbnail: "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=UI%20wireframe%20mobile%20app%20template&image_size=square",
      },
      {
        id: "code-review",
        name: "代码审查",
        description: "代码审查任务模板",
        type: "agent-task",
        category: "code-review",
        tags: ["code", "review", "quality"],
        variables: [
          { name: "repoUrl", type: "string", label: "仓库 URL", required: true },
          { name: "branch", type: "string", label: "分支", defaultValue: "main", required: false },
          { name: "files", type: "textarea", label: "文件列表", defaultValue: "", required: false },
        ],
      },
      {
        id: "research-task",
        name: "研究任务",
        description: "多源研究与分析任务模板",
        type: "agent-task",
        category: "research",
        tags: ["research", "analysis", "writing"],
        variables: [
          { name: "topic", type: "string", label: "研究主题", required: true },
          { name: "sources", type: "textarea", label: "参考来源", defaultValue: "", required: false },
          { name: "depth", type: "select", label: "深度", options: [{ value: "quick", label: "快速" }, { value: "deep", label: "深入" }, { value: "comprehensive", label: "全面" }], defaultValue: "deep", required: false },
        ],
      },
      {
        id: "automation-workflow",
        name: "自动化工作流",
        description: "自动化任务流程模板",
        type: "workflow",
        category: "automation",
        tags: ["automation", "workflow", "task"],
        variables: [
          { name: "steps", type: "textarea", label: "步骤", required: true },
          { name: "interval", type: "string", label: "执行间隔", defaultValue: "daily", required: false },
        ],
      },
      {
        id: "pet-cat-orange",
        name: "橘猫皮肤",
        description: "可爱的橘猫桌宠皮肤",
        type: "pet-skin",
        category: "pet-cat",
        tags: ["pet", "cat", "orange", "skin"],
        thumbnail: "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cute%20orange%20cat%20pet%20desktop&image_size=square",
      },
      {
        id: "pet-dog-shiba",
        name: "柴犬皮肤",
        description: "元气柴犬桌宠皮肤",
        type: "pet-skin",
        category: "pet-dog",
        tags: ["pet", "dog", "shiba", "skin"],
        thumbnail: "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cute%20shiba%20inu%20dog%20pet%20desktop&image_size=square",
      },
      {
        id: "relay-basic",
        name: "基础中转配置",
        description: "单提供商基础配置",
        type: "relay-config",
        category: "relay-ha",
        tags: ["relay", "config", "basic"],
      },
      {
        id: "relay-cluster",
        name: "集群中转配置",
        description: "多节点高可用集群配置",
        type: "relay-config",
        category: "relay-cluster",
        tags: ["relay", "cluster", "ha"],
      },
    ];

    for (const template of builtins) {
      const manifest = TemplateManifestSchema.parse(template);
      this.templates.set(manifest.id, manifest);
    }
  }

  private loadSavedTemplates(): void {
    try {
      const files = fs.readdirSync(this.templatesDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const content = fs.readFileSync(path.join(this.templatesDir, file), "utf8");
          const manifest = TemplateManifestSchema.parse(JSON.parse(content));
          this.templates.set(manifest.id, manifest);
        }
      }
    } catch {
      // ignore
    }
  }

  private loadInstances(): void {
    try {
      const files = fs.readdirSync(this.instancesDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const content = fs.readFileSync(path.join(this.instancesDir, file), "utf8");
          const instance = TemplateInstanceSchema.parse(JSON.parse(content));
          this.instances.set(instance.id, instance);
        }
      }
    } catch {
      // ignore
    }
  }

  getAllTemplates(): TemplateManifest[] {
    return Array.from(this.templates.values());
  }

  getTemplate(templateId: string): TemplateManifest | undefined {
    return this.templates.get(templateId);
  }

  searchTemplates(options: TemplateSearchOptions): TemplateManifest[] {
    let results = Array.from(this.templates.values());

    if (options.type) {
      results = results.filter((t) => t.type === options.type);
    }
    if (options.category) {
      results = results.filter((t) => t.category === options.category);
    }
    if (options.query) {
      const query = options.query.toLowerCase();
      results = results.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query),
      );
    }
    if (options.tags && options.tags.length > 0) {
      results = results.filter((t) =>
        options.tags!.some((tag) => t.tags.includes(tag)),
      );
    }

    results.sort((a, b) => b.stars - a.stars);

    return results.slice(options.offset || 0, (options.offset || 0) + (options.limit || 20));
  }

  createTemplate(manifest: Partial<TemplateManifest>): TemplateManifest {
    const newManifest = TemplateManifestSchema.parse({
      id: manifest.id || `template-${crypto.randomUUID().slice(0, 8)}`,
      ...manifest,
    });

    this.templates.set(newManifest.id, newManifest);
    this.saveTemplate(newManifest);

    return newManifest;
  }

  private saveTemplate(manifest: TemplateManifest): void {
    fs.writeFileSync(
      path.join(this.templatesDir, `${manifest.id}.json`),
      JSON.stringify(manifest, null, 2),
    );
  }

  deleteTemplate(templateId: string): boolean {
    const template = this.templates.get(templateId);
    if (!template) return false;

    this.templates.delete(templateId);
    try {
      fs.unlinkSync(path.join(this.templatesDir, `${templateId}.json`));
    } catch {
      // ignore
    }

    return true;
  }

  createInstance(templateId: string, name: string, variables?: Record<string, unknown>): TemplateInstance {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const instance = TemplateInstanceSchema.parse({
      id: `inst-${crypto.randomUUID().slice(0, 8)}`,
      templateId,
      name,
      variables: variables || {},
    });

    this.instances.set(instance.id, instance);
    this.saveInstance(instance);

    return instance;
  }

  private saveInstance(instance: TemplateInstance): void {
    fs.writeFileSync(
      path.join(this.instancesDir, `${instance.id}.json`),
      JSON.stringify(instance, null, 2),
    );
  }

  getInstance(instanceId: string): TemplateInstance | undefined {
    return this.instances.get(instanceId);
  }

  getAllInstances(): TemplateInstance[] {
    return Array.from(this.instances.values());
  }

  updateInstance(instanceId: string, updates: Partial<TemplateInstance>): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    const updated = TemplateInstanceSchema.parse({ ...instance, ...updates });
    this.instances.set(instanceId, updated);
    this.saveInstance(updated);

    return true;
  }

  deleteInstance(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (!instance) return false;

    this.instances.delete(instanceId);
    try {
      fs.unlinkSync(path.join(this.instancesDir, `${instanceId}.json`));
    } catch {
      // ignore
    }

    return true;
  }

  getTemplateInstances(templateId: string): TemplateInstance[] {
    return Array.from(this.instances.values()).filter((i) => i.templateId === templateId);
  }

  renderTemplate(templateId: string, variables: Record<string, unknown>): Record<string, unknown> {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const rendered: Record<string, unknown> = {};

    if (template.type === "canvas") {
      rendered["nodes"] = this.generateCanvasNodes(template, variables);
      rendered["connections"] = [];
    } else if (template.type === "agent-task") {
      rendered["prompt"] = this.generateTaskPrompt(template, variables);
      rendered["variables"] = variables;
    } else if (template.type === "pet-skin") {
      rendered["petDefinition"] = this.generatePetDefinition(template, variables);
    } else if (template.type === "relay-config") {
      rendered["relayConfig"] = this.generateRelayConfig(template, variables);
    }

    return rendered;
  }

  private generateCanvasNodes(_template: TemplateManifest, _variables: Record<string, unknown>): Record<string, unknown>[] {
    return [
      { id: "node-1", type: "rectangle", x: 100, y: 100, width: 150, height: 80 },
      { id: "node-2", type: "rectangle", x: 100, y: 220, width: 150, height: 80 },
    ];
  }

  private generateTaskPrompt(template: TemplateManifest, variables: Record<string, unknown>): string {
    let prompt = `Task: ${template.name}\n\n`;
    prompt += `Description: ${template.description}\n\n`;
    prompt += "Variables:\n";
    for (const [key, value] of Object.entries(variables)) {
      prompt += `- ${key}: ${value}\n`;
    }
    return prompt;
  }

  private generatePetDefinition(_template: TemplateManifest, _variables: Record<string, unknown>): Record<string, unknown> {
    return {
      baseEmoji: "🐱",
      color: "#f97316",
    };
  }

  private generateRelayConfig(_template: TemplateManifest, _variables: Record<string, unknown>): Record<string, unknown> {
    return {
      strategy: "priority",
      apiKeys: [],
    };
  }

  getStats(): {
    totalTemplates: number;
    totalInstances: number;
    templatesByType: Record<string, number>;
  } {
    const templatesByType: Record<string, number> = {};

    for (const template of this.templates.values()) {
      templatesByType[template.type] = (templatesByType[template.type] || 0) + 1;
    }

    return {
      totalTemplates: this.templates.size,
      totalInstances: this.instances.size,
      templatesByType,
    };
  }
}
