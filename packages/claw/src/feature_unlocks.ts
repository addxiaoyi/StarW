import { UniversalPatcher } from "./patcher";
import type { PatchDefinition } from "./types";

const FEATURE_PATCHES = [
  {
    id: "internal_user_mode",
    name: "Internal User Mode",
    description: "Unlock internal user type for access to hidden commands",
    category: "feature",
    pattern: /function ([\w$]+)\(\)\{return"external"\}/g,
    replacement: 'function $1(){return"ant"}',
    sentinel: 'return"external"',
    priority: 10,
  },
  {
    id: "growthbook_env_override",
    name: "GrowthBook Env Overrides",
    description: "Allow overriding feature flags via environment variables",
    category: "feature",
    pattern: /function ([\w$]+)\(\)\{if\(!([\w$]+)\)\2=!0;return ([\w$]+)\}/g,
    replacement:
      'function $1(){if(!$2){$2=!0;try{let e=process.env.CLAUDE_INTERNAL_FC_OVERRIDES;if(e)$3=JSON.parse(e)}catch(e){}}return $3}',
    unique: true,
    priority: 15,
  },
  {
    id: "growthbook_config_override",
    name: "GrowthBook Config Overrides",
    description: "Override GrowthBook config values",
    category: "feature",
    pattern: /function ([\w$]+)\(\)\{return\}(function)/g,
    replacement: 'function $1(){return null}$2',
    priority: 20,
  },
  {
    id: "agent_teams",
    name: "Agent Teams Always Enabled",
    description: "Enable multi-agent collaboration without extra parameters",
    category: "feature",
    pattern: /function ([\w$]+)\(\)\{if\(![\w$]+\(process\.env\.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS\)&&![\w$]+\(\)\)return!1;if\(![\w$]+\("tengu_amber_flint",!0\)\)return!1;return!0\}/g,
    replacement: 'function $1(){return!0}',
    priority: 25,
  },
  {
    id: "computer_use_subscription",
    name: "Computer Use Subscription Bypass",
    description: "Enable computer use without Max/Pro subscription",
    category: "feature",
    pattern: /function ([\w$]+)\(\)\{let [\w$]+=[\w$]+\(\);return [\w$]+==="max"\|\|[\w$]+==="pro"\}/g,
    replacement: 'function $1(){return!0}',
    priority: 30,
  },
  {
    id: "computer_use_default",
    name: "Computer Use Default Enabled",
    description: "Set computer use to enabled by default",
    category: "feature",
    pattern: /([\w$]+=)\{enabled:!1,pixelValidation/g,
    replacement: '$1{enabled:!0,pixelValidation',
    priority: 35,
  },
  {
    id: "computer_use_gate",
    name: "Computer Use Gate Bypass",
    description: "Bypass computer use feature gate",
    category: "feature",
    pattern: /function ([\w$]+)\(\)\{return [\w$]+\(\)&&[\w$]+\(\)\.enabled\}/g,
    replacement: 'function $1(){return!0}',
    priority: 40,
  },
  {
    id: "ultraplan_enable",
    name: "Ultraplan Enable",
    description: "Enable ultraplan mode for multi-agent planning",
    category: "feature",
    pattern: /(name:"ultraplan",[\s\S]{1,500}?argumentHint:"<prompt>",isEnabled:\(\)=>)(?:!1|[\w$]+\(\))/g,
    replacement: '$1!0',
    sentinel: 'name:"ultraplan"',
    priority: 45,
  },
  {
    id: "ultrareview_enable",
    name: "Ultrareview Enable",
    description: "Enable ultrareview for automated bug finding",
    category: "feature",
    pattern: /function ([\w$]+)\(\)\{return ([\w$]+)\("tengu_review_bughunter_config",null\)(\?\.enabled===!0)?\}/g,
    replacement: 'function $1(){return!0}',
    sentinel: '"tengu_review_bughunter_config"',
    priority: 50,
  },
  {
    id: "auto_mode_unlock",
    name: "Auto Mode Unlock",
    description: "Unlock auto-mode for third-party API users",
    category: "feature",
    pattern: /function ([\w$]+)\([\w$]+\)\{if\([\w$]+==="firstParty"\|\|[\w$]+==="anthropicAws"\)return!0;return[\w$]+\([\w$]+\.env\.CLAUDE_CODE_ENABLE_AUTO_MODE\)\}/g,
    replacement: 'function $1(){return!0}',
    priority: 55,
  },
  {
    id: "voice_mode_enable",
    name: "Voice Mode Enable",
    description: "Enable voice mode bypassing GrowthBook kill switch",
    category: "feature",
    pattern: /function ([\w$]+)\(\)\{return![\w$]+\("tengu_amber_quartz_disabled",!1\)\}/g,
    replacement: 'function $1(){return!0}',
    priority: 60,
  },
];

export const RESTRICTION_PATCHES = [
  {
    id: "cyber_risk_removal",
    name: "Cyber Risk Instruction Removal",
    description: "Remove security testing refusal prompts",
    category: "restriction",
    pattern: /CYBER_RISK_INSTRUCTION[^}]*\}/g,
    replacement: '/* removed */',
    priority: 70,
  },
  {
    id: "url_restriction_removal",
    name: "URL Restriction Removal",
    description: "Remove URL generation restriction",
    category: "restriction",
    pattern: /禁止生成或猜测URL[^。]*。/g,
    replacement: '',
    priority: 75,
  },
  {
    id: "destructive_confirmation",
    name: "Destructive Action Confirmation Removal",
    description: "Remove mandatory confirmation for destructive operations",
    category: "restriction",
    pattern: /操作审慎[^}]*\}/g,
    replacement: '/* removed */',
    priority: 80,
  },
];

export const VISUAL_PATCHES = [
  {
    id: "theme_green_dark",
    name: "Theme Green (Dark)",
    description: "Change brand color to green for dark mode",
    category: "visual",
    pattern: /clawd_body:"rgb\(215,119,87\)"/g,
    replacement: 'clawd_body:"rgb(34,197,94)"',
    priority: 90,
  },
  {
    id: "theme_green_ansi",
    name: "Theme Green (ANSI)",
    description: "Change ANSI brand color to green",
    category: "visual",
    pattern: /clawd_body:"ansi:redBright"/g,
    replacement: 'clawd_body:"ansi:greenBright"',
    priority: 91,
  },
  {
    id: "theme_claude_green_dark",
    name: "Claude Color Green (Dark)",
    description: "Change Claude theme color to green (dark)",
    category: "visual",
    pattern: /claude:"rgb\(215,119,87\)"/g,
    replacement: 'claude:"rgb(34,197,94)"',
    priority: 92,
  },
  {
    id: "theme_claude_green_light",
    name: "Claude Color Green (Light)",
    description: "Change Claude theme color to green (light)",
    category: "visual",
    pattern: /claude:"rgb\(255,153,51\)"/g,
    replacement: 'claude:"rgb(22,163,74)"',
    priority: 93,
  },
];

export const PERFORMANCE_PATCHES = [
  {
    id: "prompt_cache_1h",
    name: "1h Prompt Cache",
    description: "Force enable 1h TTL allowlist for prompt cache",
    category: "performance",
    pattern: /prompt cache[^}]*\}/g,
    replacement: '/* cache extended */',
    priority: 100,
  },
  {
    id: "third_party_cache_fix",
    name: "Third-party Cache Fix",
    description: "Fix prompt cache for non-Anthropic base URLs",
    category: "performance",
    pattern: /x-anthropic-billing-header[^}]*\}/g,
    replacement: '/* cache fixed */',
    priority: 105,
  },
  {
    id: "glob_grep_restore",
    name: "Glob/Grep Restore",
    description: "Restore built-in Glob/Grep tools in Bun runtime",
    category: "performance",
    pattern: /EMBEDDED_SEARCH_TOOLS[^}]*\}/g,
    replacement: '/* tools restored */',
    priority: 110,
  },
];

export const PRIVACY_PATCHES = [
  {
    id: "steganography_date",
    name: "Date String Steganography Neutralization",
    description: "Neutralize geographic encoding via date format",
    category: "privacy",
    pattern: /function ([\w$]+)\([\w$]+\)\{[\s\S]{0,300}Asia\/Shanghai[\s\S]{0,200}\}/g,
    replacement: 'function $1(){return\'\'}',
    priority: 120,
  },
  {
    id: "region_probe",
    name: "Region Detection Probe Neutralization",
    description: "Neutralize client-side region detection probes",
    category: "privacy",
    pattern: /function ([\w$]+)\(\)\{[\s\S]{0,500}rdp[\s\S]{0,200}\}/g,
    replacement: 'function $1(){return null}',
    priority: 125,
  },
  {
    id: "apostrophe_selector",
    name: "Apostrophe Selector Neutralization",
    description: "Force ASCII apostrophe regardless of region",
    category: "privacy",
    pattern: /function ([\w$]+)\([\w$]+\)\{[\s\S]{0,300}odp[\s\S]{0,200}\}/g,
    replacement: 'function $1(){return\'\\\'\'}',
    priority: 130,
  },
];

export const RELIABILITY_PATCHES = [
  {
    id: "disable_nonessential_traffic",
    name: "Disable Non-essential Traffic",
    description: "Disable non-essential network requests",
    category: "reliability",
    pattern: /CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC/g,
    replacement: '"1"',
    priority: 140,
  },
  {
    id: "disable_installation_checks",
    name: "Disable Installation Checks",
    description: "Skip installation verification checks",
    category: "reliability",
    pattern: /DISABLE_INSTALLATION_CHECKS/g,
    replacement: '"1"',
    priority: 145,
  },
];

export function getAllBuiltinPatches(): PatchDefinition[] {
  return [
    ...FEATURE_PATCHES,
    ...RESTRICTION_PATCHES,
    ...VISUAL_PATCHES,
    ...PERFORMANCE_PATCHES,
    ...PRIVACY_PATCHES,
    ...RELIABILITY_PATCHES,
  ] as PatchDefinition[];
}

export function registerBuiltinPatches(patcher: UniversalPatcher): void {
  for (const patch of getAllBuiltinPatches()) {
    patcher.registerPatch(patch);
  }
}
