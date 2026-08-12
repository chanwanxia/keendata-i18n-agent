const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createTools, toToolDefinitions } = require("../src/agent/tools");
const { runAgentLoop } = require("../src/agent/loop");

/**
 * 创建临时 Vue2 项目
 * @param {object} files - { 相对路径: 内容 }
 * @returns {string} 临时目录路径
 */
function createTempProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-agent-int-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "test-app",
      scripts: {
        "i18n:extract": "echo extract",
        "i18n:compile": "echo compile",
      },
    }),
  );
  Object.entries(files).forEach(([relPath, content]) => {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  });
  return dir;
}

const CONFIG = {
  include: ["src"],
  extensions: [".js", ".vue"],
  excludeDirs: ["node_modules", "dist", ".git", ".idea"],
  excludeFiles: [],
  languages: ["zh", "en", "jp", "ar"],
  translationFile: "src/languages/translates/default.json",
  preset: "keendata-vue2-voerkai",
 apply: {
   templateAttributes: ["placeholder", "title", "label"],
   specialComponents: [],
 },
 hardcodedChinese: {
   ignoreFilePrefixes: [],
   ignoreLinePatterns: [],
    ignorePatterns: [],
 },
  extractCommand: "echo extract",
  compileCommand: "echo compile",
  generatedFiles: ["src/languages/index.js"],
};

/**
 * 创建 mock client，按预设序列返回 LLM 响应
 * @param {object[]} responses - 预设响应序列
 * @returns {object} mock client
 */
function createMockClient(responses) {
  let idx = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const r = responses[idx];
          idx += 1;
          return r;
        },
      },
    },
  };
}

function toolCall(id, name, args = {}) {
  return {
    id,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function assistantResponse(toolCalls) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: toolCalls,
        },
      },
    ],
  };
}

function finishResponse(message = "所有步骤已完成") {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: message,
          tool_calls: null,
        },
      },
    ],
  };
}

test("完整流程：scan → apply → validate → finish", async () => {
  const dir = createTempProject({
    "src/app.js": 'const msg = "你好世界";\n',
    "src/languages/translates/default.json": "{}",
    "src/languages/index.js": "export default {};\n",
  });

  const tools = createTools(dir, CONFIG);

  const client = createMockClient([
    assistantResponse([toolCall("c1", "scan_chinese")]),
    assistantResponse([toolCall("c2", "apply_i18n", { dryRun: false })]),
    assistantResponse([toolCall("c3", "validate_translations")]),
    finishResponse("流程完成"),
  ]);

  const result = await runAgentLoop(
    client,
    "test-model",
    "system prompt",
    tools,
    20,
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.timeline.length, 3);
  assert.strictEqual(result.timeline[0].action, "scan_chinese");
  assert.strictEqual(result.timeline[1].action, "apply_i18n");
  assert.strictEqual(result.timeline[2].action, "validate_translations");
});

test("read_file → write_file → read_file 验证写入", async () => {
  const dir = createTempProject({
    "src/app.js": 'const msg = "你好";\n',
  });

  const tools = createTools(dir, CONFIG);

  const client = createMockClient([
    assistantResponse([toolCall("c1", "read_file", { relativePath: "src/app.js" })]),
    assistantResponse([
      toolCall("c2", "write_file", {
        relativePath: "src/app.js",
        content: 'const msg = t("你好");\n',
      }),
    ]),
    assistantResponse([toolCall("c3", "read_file", { relativePath: "src/app.js" })]),
    finishResponse(),
  ]);

  const result = await runAgentLoop(
    client,
    "test-model",
    "system prompt",
    tools,
    20,
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.timeline.length, 3);

  // 验证文件确实被写入了
  const content = fs.readFileSync(path.join(dir, "src/app.js"), "utf8");
  assert.ok(content.includes('t("你好")'));
});

test("工具返回 error 后 agent 可以继续", async () => {
  const dir = createTempProject({});

  const tools = createTools(dir, CONFIG);

  const client = createMockClient([
    // 先调用一个不存在的文件
    assistantResponse([toolCall("c1", "read_file", { relativePath: "src/missing.js" })]),
    // agent 读取到了 error，决定写入文件
    assistantResponse([
      toolCall("c2", "write_file", {
        relativePath: "src/missing.js",
        content: "// fixed\n",
      }),
    ]),
    finishResponse("已修复"),
  ]);

  const result = await runAgentLoop(
    client,
    "test-model",
    "system prompt",
    tools,
    20,
  );

  assert.strictEqual(result.ok, true);
  assert.ok(result.timeline[0].result.includes("文件不存在"));
  assert.ok(fs.existsSync(path.join(dir, "src/missing.js")));
});
