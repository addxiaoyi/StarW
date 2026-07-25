// Lifecycle hooks for code-reviewer plugin
export const onInstall = async (ctx) => {
  console.log(`[code-reviewer] Installed to ${ctx.pluginDir}`);
};

export const onEnable = async (ctx) => {
  console.log("[code-reviewer] Enabled");
};

export const onDisable = async (ctx) => {
  console.log("[code-reviewer] Disabled");
};

export default { onInstall, onEnable, onDisable };
