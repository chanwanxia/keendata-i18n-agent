const { test } = require("node:test");
const assert = require("node:assert");
const { formatLlmFailureMessage, formatToolResult, runAgentLoop } = require("../src/agent/loop");

/**
 * 创建 mock LLM client，按预设序列返回响应
 * @param {object[]} responses - 预设的响应序列
 * @returns {object} mock client
 */
function createMockClient(responses) {
  let callIndex = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const response = responses[callIndex];
          callIndex += 1;
          return response;
        },
      },
    },
  };
}

test("无 tool_calls 时立即终止并返回 ok", async () => {
  const client = createMockClient([
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "任务已完成",
            tool_calls: null,
          },
        },
      ],
    },
  ]);

  const result = await runAgentLoop(
    client,
    "test-model",
    "system prompt",
    [],
    { maxSteps: 10 },
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.message, "任务已完成");
  assert.strictEqual(result.stepCount, 1);
  assert.strictEqual(result.timeline.length, 0);
});

test("执行 tool call 后终止", async () => {
  const tools = [
    {
      name: "echo",
      description: "echo test",
      parameters: { type: "object", properties: {} },
      execute: () => ({ echoed: true }),
    },
  ];

  const client = createMockClient([
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "echo",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "完成",
            tool_calls: null,
          },
        },
      ],
    },
  ]);

  const result = await runAgentLoop(
    client,
    "test-model",
    "system prompt",
    tools,
    { maxSteps: 10 },
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.stepCount, 2);
  assert.strictEqual(result.timeline.length, 1);
  assert.strictEqual(result.timeline[0].action, "echo");
});

test("工具执行出错时返回 error 而非抛异常", async () => {
  const tools = [
    {
      name: "boom",
      description: "always fails",
      parameters: { type: "object", properties: {} },
      execute: () => {
        throw new Error("工具爆炸了");
      },
    },
  ];

  const client = createMockClient([
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "boom",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "已处理错误",
            tool_calls: null,
          },
        },
      ],
    },
  ]);

  const result = await runAgentLoop(
    client,
    "test-model",
    "system prompt",
    tools,
    { maxSteps: 10 },
  );

  assert.strictEqual(result.ok, true);
  assert.ok(result.timeline[0].result.includes("工具爆炸了"));
});

test("超过最大步数时返回失败", async () => {
  const tools = [
    {
      name: "loop",
      description: "always calls itself",
      parameters: { type: "object", properties: {} },
      execute: () => ({ looping: true }),
    },
  ];

  const loopResponse = {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              function: {
                name: "loop",
                arguments: "{}",
              },
            },
          ],
        },
      },
    ],
  };

  const client = createMockClient(Array(20).fill(loopResponse));

  const result = await runAgentLoop(
    client,
    "test-model",
    "system prompt",
    tools,
    { maxSteps: 3 },
  );

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stepCount, 3);
  assert.ok(result.message.includes("已达到 --max-steps=3"));
});

test("未知工具返回 error", async () => {
  const tools = [];

  const client = createMockClient([
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                function: {
                  name: "unknown_tool",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "完成",
            tool_calls: null,
          },
        },
      ],
    },
  ]);

  const result = await runAgentLoop(
    client,
    "test-model",
    "system prompt",
    tools,
    { maxSteps: 10 },
  );

  assert.strictEqual(result.ok, true);
  assert.ok(result.timeline[0].result.includes("未知工具"));
});

test("多个 tool_calls 在同一轮执行", async () => {
  const tools = [
    {
      name: "add",
      description: "add",
      parameters: { type: "object", properties: {} },
      execute: () => ({ sum: 42 }),
    },
    {
      name: "mul",
      description: "mul",
      parameters: { type: "object", properties: {} },
      execute: () => ({ product: 99 }),
    },
  ];

  const client = createMockClient([
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                function: { name: "add", arguments: "{}" },
              },
              {
                id: "call_2",
                function: { name: "mul", arguments: "{}" },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "完成",
            tool_calls: null,
          },
        },
      ],
    },
  ]);

  const result = await runAgentLoop(
    client,
    "test-model",
    "system prompt",
    tools,
    { maxSteps: 10 },
  );

  assert.strictEqual(result.timeline.length, 2);
  assert.strictEqual(result.timeline[0].action, "add");
  assert.strictEqual(result.timeline[1].action, "mul");
});

test("formatToolResult 使用 inject details 统计更新接入点", () => {
  const summary = formatToolResult("inject", {
    ok: true,
    details: {
      packageJson: { updated: true },
      mainJs: { updated: false },
      vueConfig: { updated: true },
      appVue: { updated: false },
      interceptors: { updated: false },
      layoutHeader: { updated: true },
    },
  });

  assert.strictEqual(summary, "注入/更新 3 个接入点");
});

test("formatToolResult 正确展示 cleanup 和 generated 摘要字段", () => {
  assert.strictEqual(
    formatToolResult("cleanup_i18n", {
      ok: true,
      summary: { cleanedFileCount: 2, totalFixes: 5 },
      cleanedFiles: [],
    }),
    "清理 2 个文件, 修复 5 处历史问题",
  );
  assert.strictEqual(
    formatToolResult("check_generated_files", {
      ok: false,
      missingFiles: ["src/languages/index.js"],
    }),
    "缺失 1 个产物文件",
  );
});

test("formatLlmFailureMessage 给出排查和恢复提示", () => {
  const message = formatLlmFailureMessage(new Error("429 Too Many Requests"), true);

  assert.ok(message.includes("LLM_API_KEY"));
  assert.ok(message.includes("服务限流"));
  assert.ok(message.includes("--no-resume"));
});
