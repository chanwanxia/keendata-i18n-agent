const { test } = require("node:test");
const assert = require("node:assert");
const {
  formatLlmFailureMessage,
  formatToolResult,
  reconcileCheckpointChecks,
  runAgentLoop,
} = require("../src/agent/loop");

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

test("工具执行出错时立即中断，不再请求下一轮", async () => {
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
  ]);

  const result = await runAgentLoop(
    client,
    "test-model",
    "system prompt",
    tools,
    { maxSteps: 10 },
  );

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stepCount, 1);
  assert.ok(result.timeline[0].result.includes("工具爆炸了"));
  assert.ok(result.message.includes("agent 已中断"));
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

test("未知工具返回 error 后立即中断", async () => {
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
  ]);

  const result = await runAgentLoop(
    client,
    "test-model",
    "system prompt",
    tools,
    { maxSteps: 10 },
  );

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stepCount, 1);
  assert.ok(result.timeline[0].result.includes("未知工具"));
});

test("工具返回 ok=false 时中断同一轮后续调用", async () => {
  let laterToolCalled = false;
  const tools = [
    {
      name: "failed_command",
      description: "always fails",
      parameters: { type: "object", properties: {} },
      execute: () => ({ ok: false, stderr: "command failed" }),
    },
    {
      name: "later_write",
      description: "must not execute",
      parameters: { type: "object", properties: {} },
      execute: () => {
        laterToolCalled = true;
        return { written: true };
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
                function: { name: "failed_command", arguments: "{}" },
              },
              {
                id: "call_2",
                function: { name: "later_write", arguments: "{}" },
              },
            ],
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

  assert.strictEqual(result.ok, false);
  assert.strictEqual(laterToolCalled, false);
  assert.ok(result.message.includes("command failed"));
});

test("translate_entries 仅有翻译校验问题时必须继续校验", async () => {
  const tools = [
    {
      name: "translate_entries",
      description: "translation quality issue",
      parameters: { type: "object", properties: {} },
      execute: () => ({
        ok: false,
        provider: { ok: true, used: "llm" },
        summary: { issueCount: 1 },
        issues: [{ type: "source_leakage" }],
      }),
    },
    {
      name: "validate_translations",
      description: "translation validation",
      parameters: { type: "object", properties: {} },
      execute: () => ({ ok: true }),
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
                function: { name: "translate_entries", arguments: "{}" },
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
            content: null,
            tool_calls: [
              {
                id: "call_2",
                function: {
                  name: "validate_translations",
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
            content: "继续处理",
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
  assert.strictEqual(result.timeline.length, 2);
});

test("translate_entries provider 成功但结果不完整时不能被视为执行失败", async () => {
  const tools = [
    {
      name: "translate_entries",
      description: "translation quality issue",
      parameters: { type: "object", properties: {} },
      execute: () => ({
        ok: false,
        provider: { ok: true, used: "llm", remainingCount: 2 },
        summary: { issueCount: 0 },
        issues: [],
      }),
    },
    {
      name: "validate_translations",
      description: "translation validation",
      parameters: { type: "object", properties: {} },
      execute: () => ({ ok: true }),
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
                function: { name: "translate_entries", arguments: "{}" },
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
            content: null,
            tool_calls: [
              {
                id: "call_2",
                function: {
                  name: "validate_translations",
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
            content: "继续处理",
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
  assert.strictEqual(result.timeline.length, 2);
});

test("translate_entries provider 执行失败时立即中断", async () => {
  const tools = [
    {
      name: "translate_entries",
      description: "translation provider failure",
      parameters: { type: "object", properties: {} },
      execute: () => ({
        ok: false,
        provider: {
          ok: false,
          used: "llm",
          message: "API unavailable",
        },
        summary: {},
        issues: [],
      }),
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
                function: { name: "translate_entries", arguments: "{}" },
              },
            ],
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

  assert.strictEqual(result.ok, false);
  assert.ok(result.message.includes("API unavailable"));
});

test("检查未通过时不能直接宣称完成", async () => {
  let doctorCallCount = 0;
  const tools = [
    {
      name: "doctor",
      description: "failed check",
      parameters: { type: "object", properties: {} },
      execute: () => {
        doctorCallCount += 1;
        return doctorCallCount === 1
          ? { ok: false, summary: { failCount: 1 } }
          : { ok: true, summary: { failCount: 0 } };
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
                function: { name: "doctor", arguments: "{}" },
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
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_2",
                function: { name: "doctor", arguments: "{}" },
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
  assert.strictEqual(result.message, "完成");
  assert.strictEqual(doctorCallCount, 2);
  assert.strictEqual(result.timeline.length, 2);
});

test("恢复 checkpoint 时重新核对并清除已修复的检查", async () => {
  const result = await reconcileCheckpointChecks(["doctor", "validate_translations"], [
    {
      name: "doctor",
      execute: () => ({ ok: true, summary: { failCount: 0 } }),
    },
    {
      name: "validate_translations",
      execute: () => ({
        ok: false,
        summary: { missingLanguageCount: 2, issueCount: 1 },
      }),
    },
  ]);

  assert.deepStrictEqual(result.unresolvedChecks, ["validate_translations"]);
  assert.deepStrictEqual(result.reports.doctor, {
    ok: true,
    summary: { failCount: 0 },
  });
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
  assert.strictEqual(typeof result.timeline[0].llmElapsedMs, "number");
  assert.strictEqual(typeof result.timeline[0].toolElapsedMs, "number");
  assert.strictEqual(typeof result.timeline[0].totalElapsedMs, "number");
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

test("formatToolResult 正确展示 generated 摘要字段", () => {
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
