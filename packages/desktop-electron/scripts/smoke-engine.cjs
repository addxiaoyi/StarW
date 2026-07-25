"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const electronPath = require("electron");
const { removePath } = require("./fs-utils.cjs");

const desktopDir = path.resolve(__dirname, "..");
const enginePath = path.join(
  desktopDir,
  "build",
  "engine",
  "openstar-engine.mjs",
);
const smokeRoot = path.join(desktopDir, ".tmp", `engine-smoke-${process.pid}`);
const workspace = path.join(smokeRoot, "workspace");
const dataDir = path.join(smokeRoot, "data");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeOpenAiSse(response, chunks) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const chunk of chunks) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    await delay(2);
  }
  response.end("data: [DONE]\n\n");
}

function readJsonRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function startFakeProvider() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    try {
      assert(request.method === "POST", "Provider received a non-POST request");
      assert(
        request.url === "/v1/chat/completions",
        `Unexpected provider endpoint: ${request.url}`,
      );
      assert(
        request.headers.authorization === "Bearer smoke-secret",
        "Provider authorization header mismatch",
      );
      const body = await readJsonRequest(request);
      requests.push(body);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const tools = Array.isArray(body.tools) ? body.tools : [];
      const hasToolResult = messages.some((message) => message.role === "tool");

      assert(body.stream === true, "Provider request did not enable streaming");
      const lastUserText = messages
        .filter((message) => message.role === "user")
        .map((message) => String(message.content || ""))
        .join("\n");
      const assistantToolCall = [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" && Array.isArray(message.tool_calls),
        );
      const previousToolName =
        assistantToolCall?.tool_calls?.[0]?.function?.name || "";
      const responseId = `smoke-stream-${requests.length}`;
      let chunks;

      if (tools.length === 0) {
        chunks = [
          {
            id: responseId,
            model: "smoke-agent",
            choices: [{ index: 0, delta: { content: "CHAT_" } }],
          },
          {
            id: responseId,
            model: "smoke-agent",
            choices: [
              {
                index: 0,
                delta: { content: "STREAM_OK" },
                finish_reason: "stop",
              },
            ],
          },
          {
            id: responseId,
            model: "smoke-agent",
            choices: [],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 3,
              total_tokens: 8,
            },
          },
        ];
      } else if (!hasToolResult) {
        const delegate =
          lastUserText.includes("DELEGATE_SMOKE") &&
          tools.some((tool) => tool?.function?.name === "delegate_agent");
        const toolName = delegate ? "delegate_agent" : "read";
        assert(
          tools.some((tool) => tool?.function?.name === toolName),
          `Agent did not send the ${toolName} tool schema`,
        );
        const argumentsText = JSON.stringify(
          delegate
            ? {
                agent: "plan",
                prompt: "Read input.txt and return the marker.",
              }
            : { path: "input.txt" },
        );
        const split = Math.ceil(argumentsText.length / 2);
        chunks = [
          {
            id: responseId,
            model: "smoke-agent",
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: `call-${toolName}-${requests.length}`,
                      type: "function",
                      function: {
                        name: toolName,
                        arguments: argumentsText.slice(0, split),
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            id: responseId,
            model: "smoke-agent",
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: { arguments: argumentsText.slice(split) },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
          {
            id: responseId,
            model: "smoke-agent",
            choices: [],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 5,
              total_tokens: 25,
            },
          },
        ];
      } else {
        const toolMessage = messages.find((message) => message.role === "tool");
        if (previousToolName === "read") {
          assert(
            String(toolMessage?.content || "").includes("ENGINE_FILE_OK"),
            "Agent did not feed the real read result back to the model",
          );
        }
        const finalText =
          previousToolName === "delegate_agent"
            ? "DELEGATE_PARENT_OK"
            : "AGENT_TOOL_LOOP_OK";
        const split = Math.ceil(finalText.length / 2);
        chunks = [
          {
            id: responseId,
            model: "smoke-agent",
            choices: [
              {
                index: 0,
                delta: { content: finalText.slice(0, split) },
              },
            ],
          },
          {
            id: responseId,
            model: "smoke-agent",
            choices: [
              {
                index: 0,
                delta: { content: finalText.slice(split) },
                finish_reason: "stop",
              },
            ],
          },
          {
            id: responseId,
            model: "smoke-agent",
            choices: [],
            usage: {
              prompt_tokens: 30,
              completion_tokens: 4,
              total_tokens: 34,
            },
          },
        ];
      }

      await writeOpenAiSse(response, chunks);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(
    address && typeof address === "object",
    "Provider did not bind a port",
  );
  return {
    server,
    requests,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  };
}

async function main() {
  if (!fs.existsSync(enginePath))
    throw new Error(`Engine bundle is missing: ${enginePath}`);

  removePath(smokeRoot);
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "input.txt"),
    "ENGINE_FILE_OK\n",
    "utf8",
  );

  const skillDirectory = path.join(workspace, ".openstar", "skills", "smoke");
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(skillDirectory, "SKILL.md"),
    "---\nname: Smoke Skill\ndescription: Deterministic dynamic skill for Engine smoke.\n---\n# Smoke Skill\nReturn the supplied input with the smoke instructions.\n",
    "utf8",
  );

  const provider = await startFakeProvider();
  fs.writeFileSync(
    path.join(dataDir, "desktop-config.json"),
    `${JSON.stringify(
      {
        workspace,
        selectedProvider: "openai",
        providers: {
          openai: {
            enabled: false,
            apiKey: "legacy-smoke-secret",
            baseUrl: provider.baseUrl,
            model: "smoke-agent",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const child = spawn(electronPath, [enginePath], {
    cwd: workspace,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      OPENSTAR_WORKSPACE: workspace,
      STARCORE_DATA_DIR: dataDir,
      STARCORE_SECRET_KEY:
        "1111111111111111111111111111111111111111111111111111111111111111",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let sequence = 0;
  let stdoutBuffer = "";
  let stderr = "";
  const pending = new Map();
  const events = [];

  const rejectAll = (error) => {
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  };

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);

      if (typeof message.event === "string") {
        events.push(message);
        continue;
      }
      if (message.id === null || message.id === undefined) continue;

      const item = pending.get(String(message.id));
      if (!item) continue;

      pending.delete(String(message.id));
      if (message.error) item.reject(new Error(message.error));
      else item.resolve(message.result);
    }
  });

  child.on("error", rejectAll);
  child.on("exit", (code, signal) => {
    if (pending.size) {
      rejectAll(
        new Error(`Engine exited code=${code} signal=${signal}\n${stderr}`),
      );
    }
  });

  const request = (method, params = {}, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      const id = String(++sequence);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Engine RPC timed out: ${method}\n${stderr}`));
      }, timeoutMs);

      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });

  const waitForTask = async (taskId, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { task } = await request("swarm.task", { taskId });
      assert(task, `Swarm task disappeared: ${taskId}`);
      if (["completed", "failed", "cancelled"].includes(task.status)) {
        return task;
      }
      await delay(50);
    }
    throw new Error(`Agent task did not finish: ${taskId}\n${stderr}`);
  };

  try {
    assert((await request("ping")).ok === true, "Ping failed");

    const status = await request("runtime.status");
    assert(
      path.resolve(status.workspace) === path.resolve(workspace),
      "Workspace mismatch",
    );
    assert(status.core === "ready", "Core is not ready");

    const command = await request("command.execute", {
      command: "echo ENGINE_CMD_OK",
      cwd: ".",
      commandId: "smoke-command",
    });
    assert(command.success === true, command.error || "Command failed");
    assert(
      String(command.output).includes("ENGINE_CMD_OK"),
      "Command output missing",
    );

    const listed = await request("files/list", { path: "." });
    assert(
      listed.entries.some((entry) => entry.name === "input.txt"),
      "File list is not real",
    );

    const read = await request("files/read", { path: "input.txt" });
    assert(read.content === "ENGINE_FILE_OK\n", "File read mismatch");

    await request("files/write", {
      path: "output.txt",
      content: "ENGINE_WRITE_OK\n",
    });
    assert(
      fs.readFileSync(path.join(workspace, "output.txt"), "utf8") ===
        "ENGINE_WRITE_OK\n",
      "File write mismatch",
    );

    const tool = await request("tool.execute", {
      name: "read",
      input: { path: "input.txt" },
    });
    assert(tool.success === true, tool.error || "Read tool failed");
    assert(
      JSON.stringify(tool.output).includes("ENGINE_FILE_OK"),
      "Tool output missing",
    );

    const config = await request("config/get");
    assert(
      !Object.values(config.providers || {}).some(
        (providerConfig) =>
          providerConfig &&
          typeof providerConfig === "object" &&
          Object.hasOwn(providerConfig, "apiKey"),
      ),
      "Config leaked an API key",
    );
    assert(
      config.providers.openai.configured === true,
      "Legacy plaintext API key was not migrated",
    );
    const migratedConfigText = fs.readFileSync(
      path.join(dataDir, "desktop-config.json"),
      "utf8",
    );
    const migratedSecretsText = fs.readFileSync(
      path.join(dataDir, "provider-secrets.enc.json"),
      "utf8",
    );
    assert(
      !migratedConfigText.includes("legacy-smoke-secret") &&
        !migratedConfigText.includes("apiKey"),
      "Legacy API key remained in desktop-config.json",
    );
    assert(
      !migratedSecretsText.includes("legacy-smoke-secret") &&
        JSON.parse(migratedSecretsText).algorithm === "aes-256-gcm",
      "Legacy API key was not migrated into an encrypted envelope",
    );

    const listedSkills = (await request("skills/list")).skills;
    assert(listedSkills.length >= 6, "Skills missing");
    assert(
      listedSkills.some(
        (skill) =>
          skill.type === "workspace-skill" &&
          String(skill.name).startsWith("skill__smoke_"),
      ),
      "Workspace SKILL.md was not registered dynamically",
    );
    const agents = (await request("agents/list")).agents;
    assert(agents.length >= 3, "Agents missing");
    const generalTools = (await request("agent.tools", { agent: "general" }))
      .names;
    assert(generalTools.includes("edit"), "General agent is missing edit");
    assert(generalTools.includes("bash"), "General agent is missing bash");
    const planTools = (await request("agent.tools", { agent: "plan" })).names;
    assert(
      planTools.includes("read") &&
        planTools.includes("grep") &&
        !planTools.some((name) => ["write", "edit", "bash"].includes(name)),
      "Plan agent tools are not read-only",
    );
    assert(
      Array.isArray((await request("swarm.status")).workers),
      "Swarm missing",
    );
    assert(
      Array.isArray((await request("mcp.status")).servers),
      "MCP status missing",
    );

    let chatRejected = false;
    try {
      await request("chat.complete", {
        messages: [{ role: "user", content: "hello" }],
      });
    } catch (error) {
      chatRejected = /Provider is disabled/.test(error.message);
    }
    assert(chatRejected, "Disabled Provider did not fail explicitly");

    await request("config/set", {
      selectedProvider: "openai",
      providers: {
        openai: {
          enabled: true,
          apiKey: "smoke-secret",
          baseUrl: provider.baseUrl,
          model: "smoke-agent",
        },
      },
    });

    const configText = fs.readFileSync(
      path.join(dataDir, "desktop-config.json"),
      "utf8",
    );
    assert(
      !configText.includes("smoke-secret"),
      "Desktop config stored a plaintext API key",
    );
    const secretsText = fs.readFileSync(
      path.join(dataDir, "provider-secrets.enc.json"),
      "utf8",
    );
    assert(
      !secretsText.includes("smoke-secret"),
      "Encrypted secret file leaked plaintext",
    );
    assert(
      JSON.parse(secretsText).algorithm === "aes-256-gcm",
      "Provider secret envelope is not AES-256-GCM",
    );

    const chat = await request("chat.complete", {
      messages: [{ role: "user", content: "stream smoke" }],
      sessionId: "chat-smoke",
      stream: true,
    });
    assert(chat.content === "CHAT_STREAM_OK", "Chat SSE reconstruction failed");

    const custom = await request("agent.definitions.create", {
      name: "smoke-reviewer",
      description: "Read-only smoke reviewer",
      instructions: "Inspect facts and report them.",
      tools: ["read", "grep"],
      permission: {
        canEdit: false,
        canExecute: false,
        canAccessNetwork: false,
        canUseMcp: false,
        allowedDirectories: [],
        deniedPatterns: [],
      },
    });
    assert(
      custom.agent?.name === "smoke-reviewer",
      "Custom Agent creation failed",
    );
    assert(
      (await request("agent.definitions.list")).agents.some(
        (agent) => agent.name === "smoke-reviewer",
      ),
      "Custom Agent did not persist in the registry",
    );

    const edit = await request("tool.execute", {
      name: "edit",
      input: {
        path: "input.txt",
        oldText: "ENGINE_FILE_OK",
        newText: "ENGINE_FILE_CHANGED",
      },
    });
    assert(edit.success === true, edit.error || "Edit tool failed");
    assert(
      fs
        .readFileSync(path.join(workspace, "input.txt"), "utf8")
        .includes("ENGINE_FILE_CHANGED"),
      "Edit tool did not mutate the real file",
    );
    const change = (await request("changes/list")).changes.find((item) =>
      String(item.path).endsWith("input.txt"),
    );
    assert(change?.id, "Mutation journal did not record the edit");
    assert(
      String(change.diff).includes("ENGINE_FILE_CHANGED"),
      "Mutation diff missing",
    );
    await request("changes/rollback", { id: change.id });
    assert(
      fs.readFileSync(path.join(workspace, "input.txt"), "utf8") ===
        "ENGINE_FILE_OK\n",
      "Mutation rollback did not restore the file",
    );

    const deniedCommand = request("tool.execute", {
      name: "bash",
      input: { command: "git reset --hard" },
    });
    let approval;
    for (let index = 0; index < 40; index += 1) {
      approval = (await request("approvals/list")).approvals[0];
      if (approval) break;
      await delay(25);
    }
    assert(approval?.id, "Dangerous command did not request approval");
    await request("approvals/resolve", { id: approval.id, approved: false });
    const deniedResult = await deniedCommand;
    assert(
      deniedResult.success === false &&
        /denied/i.test(JSON.stringify(deniedResult)),
      "Denied dangerous command did not fail safely",
    );

    const submitted = await request("agent.run", {
      agent: "general",
      prompt: "Read input.txt and report the marker.",
      maxIterations: 4,
    });
    assert(submitted.taskId, "Agent task id missing");
    assert(submitted.sessionId, "Agent session id missing");

    const agentTask = await waitForTask(submitted.taskId);
    assert(
      agentTask.status === "completed",
      agentTask.error || "Agent task failed",
    );
    assert(
      agentTask.result?.content === "AGENT_TOOL_LOOP_OK",
      "Agent final response mismatch",
    );
    assert(
      agentTask.result?.toolExecutions === 1,
      "Agent tool execution count mismatch",
    );

    const session = (
      await request("agent.sessions.get", { sessionId: submitted.sessionId })
    ).session;
    assert(session.status === "completed", "Agent session did not complete");
    assert(session.result?.iterations === 2, "Agent iteration count mismatch");
    assert(
      session.events.some((event) => event.type === "tool_execution_start"),
      "Agent tool start event missing",
    );
    assert(
      session.events.some(
        (event) =>
          event.type === "tool_execution_end" &&
          event.toolResult?.success === true,
      ),
      "Agent successful tool result event missing",
    );
    assert(
      session.events.some((event) => event.type === "agent_end"),
      "Agent completion event missing",
    );
    assert(
      (await request("agent.sessions.list")).sessions.some(
        (item) => item.id === submitted.sessionId,
      ),
      "Agent session list is missing the completed session",
    );
    assert(
      provider.requests.length >= 3,
      "Provider did not receive streamed requests",
    );
    assert(
      fs.existsSync(path.join(dataDir, "agent-sessions.json")),
      "Agent sessions were not persisted",
    );

    const renamed = await request("agent.sessions.rename", {
      sessionId: submitted.sessionId,
      name: "Smoke primary session",
    });
    assert(
      renamed.session?.name === "Smoke primary session",
      "Session rename failed",
    );
    const branch = await request("agent.sessions.branch", {
      sessionId: submitted.sessionId,
      messageIndex: 1,
    });
    assert(
      branch.session?.parentSessionId === submitted.sessionId,
      "Session branch lineage is missing",
    );
    const retry = await request("agent.sessions.retry", {
      sessionId: submitted.sessionId,
      messageIndex: 1,
      prompt: "Read input.txt again and report the marker.",
    });
    const retryTask = await waitForTask(retry.taskId);
    assert(
      retryTask.status === "completed",
      retryTask.error || "Session retry failed",
    );

    const delegated = await request("agent.run", {
      agent: "general",
      prompt: "DELEGATE_SMOKE: delegate reading input.txt to a sub Agent.",
      maxIterations: 6,
    });
    const delegatedTask = await waitForTask(delegated.taskId, 30_000);
    assert(
      delegatedTask.status === "completed" &&
        delegatedTask.result?.content === "DELEGATE_PARENT_OK",
      delegatedTask.error || "Model-driven sub Agent delegation failed",
    );
    const delegatedSession = (
      await request("agent.sessions.get", { sessionId: delegated.sessionId })
    ).session;
    assert(
      delegatedSession.events.some(
        (event) =>
          event.type === "tool_execution_start" &&
          event.toolCall?.function?.name === "delegate_agent",
      ),
      "Parent Agent did not call delegate_agent",
    );
    assert(
      (await request("agent.sessions.list")).sessions.some(
        (item) => item.parentSessionId === delegated.sessionId,
      ),
      "Delegated child Agent session lineage is missing",
    );

    const orchestration = await request(
      "agent.orchestrate",
      {
        tasks: [
          {
            id: "inspect",
            agent: "plan",
            prompt: "Read input.txt and report its marker.",
            dependsOn: [],
          },
          {
            id: "review",
            agent: "smoke-reviewer",
            prompt: "Read input.txt and verify its marker.",
            dependsOn: ["inspect"],
          },
        ],
        maxIterations: 4,
      },
      40_000,
    );
    assert(
      orchestration.results.length === 2 &&
        orchestration.results.every((item) => item.status === "completed"),
      "Swarm DAG Agent orchestration failed",
    );

    assert(
      (await request("agent.definitions.delete", { name: "smoke-reviewer" }))
        .deleted === true,
      "Custom Agent deletion failed",
    );
    assert(
      (await request("agent.sessions.delete", { sessionId: branch.session.id }))
        .deleted === true,
      "Branched session deletion failed",
    );

    assert(
      events.some((item) => item.event === "command.started"),
      "Command start event missing",
    );
    assert(
      events.some((item) => item.event === "command.output"),
      "Command output event missing",
    );
    assert(
      events.some((item) => item.event === "command.exited"),
      "Command exit event missing",
    );
    assert(
      events.some((item) => item.event === "agent.event"),
      "Agent runtime event stream missing",
    );
    assert(
      events.some((item) => item.event === "agent.completed"),
      "Agent completed event missing",
    );
    assert(
      events.some(
        (item) =>
          item.event === "chat.delta" &&
          item.payload?.sessionId === "chat-smoke",
      ),
      "Chat SSE delta event missing",
    );
    assert(
      events.some((item) => item.event === "agent.model.delta"),
      "Agent model SSE delta event missing",
    );
    assert(
      events.some((item) => item.event === "change.rolled_back"),
      "Mutation rollback event missing",
    );
    assert(
      events.some((item) => item.event === "agent.delegation.completed"),
      "Agent delegation completion event missing",
    );
    assert(
      events.some((item) => item.event === "agent.orchestration.completed"),
      "Agent orchestration completion event missing",
    );

    console.log(
      "Embedded engine security, SSE, session, rollback and multi-Agent smoke passed",
    );
  } finally {
    child.stdin.end();
    setTimeout(() => child.kill(), 1000).unref();
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve) => provider.server.close(resolve));
    removePath(smokeRoot);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : String(error),
  );
  process.exitCode = 1;
});
