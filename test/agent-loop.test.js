const { test } = require("node:test");
const assert = require("node:assert");
const { runAgentLoop } = require("../src/agent/loop");

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
    10,
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
    10,
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
    10,
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
    3,
  );

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.stepCount, 3);
  assert.ok(result.message.includes("超过最大步数"));
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
    10,
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
    10,
  );

  assert.strictEqual(result.timeline.length, 2);
  assert.strictEqual(result.timeline[0].action, "add");
  assert.strictEqual(result.timeline[1].action, "mul");
});
