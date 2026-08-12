const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createTools, toToolDefinitions } = require("../src/agent/tools");

/**
 * 创建临时项目并写入文件
 * @param {object} files - { 相对路径: 内容 }
 * @returns {string} 临时目录路径
 */
function createTempProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-agent-tools-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test" }),
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

test("read_file 读取已存在的文件", () => {
  const dir = createTempProject({
    "src/test.js": 'const msg = "你好";\n',
  });
  const tools = createTools(dir, CONFIG);
  const readTool = tools.find((t) => t.name === "read_file");
  const result = readTool.execute({ relativePath: "src/test.js" });
  assert.strictEqual(result.relativePath, "src/test.js");
  assert.ok(result.content.includes("你好"));
});

test("read_file 对不存在的文件返回 error", () => {
  const dir = createTempProject({});
  const tools = createTools(dir, CONFIG);
  const readTool = tools.find((t) => t.name === "read_file");
  const result = readTool.execute({ relativePath: "src/missing.js" });
  assert.ok(result.error);
});

test("write_file 写入文件内容", () => {
  const dir = createTempProject({});
  const tools = createTools(dir, CONFIG);
  const writeTool = tools.find((t) => t.name === "write_file");
  const result = writeTool.execute({
    relativePath: "src/new.js",
    content: 'const x = 1;\n',
  });
  assert.strictEqual(result.written, true);
  const content = fs.readFileSync(path.join(dir, "src/new.js"), "utf8");
  assert.ok(content.includes("const x = 1"));
});

test("write_file 自动创建嵌套目录", () => {
  const dir = createTempProject({});
  const tools = createTools(dir, CONFIG);
  const writeTool = tools.find((t) => t.name === "write_file");
  writeTool.execute({
    relativePath: "src/deep/nested/file.js",
    content: "ok",
  });
  assert.ok(
    fs.existsSync(path.join(dir, "src/deep/nested/file.js")),
  );
});

test("list_files 列出目录下文件", () => {
  const dir = createTempProject({
    "src/a.js": "1",
    "src/b.vue": "2",
    "src/c.txt": "3",
  });
  const tools = createTools(dir, CONFIG);
  const listTool = tools.find((t) => t.name === "list_files");
  const result = listTool.execute({ directory: "src" });
  assert.ok(result.fileCount >= 3);
  assert.ok(result.files.includes("src/a.js"));
  assert.ok(result.files.includes("src/b.vue"));
});

test("list_files 按扩展名过滤", () => {
  const dir = createTempProject({
    "src/a.js": "1",
    "src/b.vue": "2",
  });
  const tools = createTools(dir, CONFIG);
  const listTool = tools.find((t) => t.name === "list_files");
  const result = listTool.execute({ directory: "src", extension: ".vue" });
  assert.ok(result.files.includes("src/b.vue"));
  assert.ok(!result.files.includes("src/a.js"));
});

test("scan_chinese 返回截断的候选列表", () => {
  const files = {};
  for (let i = 0; i < 60; i += 1) {
    files[`src/file${i}.js`] = `const msg${i} = "测试中文${i}";\n`;
  }
  const dir = createTempProject(files);
  const tools = createTools(dir, CONFIG);
  const scanTool = tools.find((t) => t.name === "scan_chinese");
  const result = scanTool.execute({});
  assert.ok(result.candidates.length <= 50);
  assert.ok(result.totalCandidates >= 60);
});

test("apply_i18n dryRun 不写入文件", () => {
  const dir = createTempProject({
    "src/app.js": 'const msg = "你好世界";\n',
  });
  const tools = createTools(dir, CONFIG);
  const applyTool = tools.find((t) => t.name === "apply_i18n");
  const result = applyTool.execute({ dryRun: true });
  assert.strictEqual(result.summary.dryRun, true);
  const content = fs.readFileSync(path.join(dir, "src/app.js"), "utf8");
  assert.ok(content.includes('"你好世界"'));
});

test("validate_translations 返回校验报告", () => {
  const dir = createTempProject({
    "src/languages/translates/default.json": JSON.stringify({
      "你好": { en: "Hello", jp: "こんにちは", ar: "مرحبا" },
      "世界": { en: "", jp: "", ar: "" },
    }),
  });
  const tools = createTools(dir, CONFIG);
  const validateTool = tools.find((t) => t.name === "validate_translations");
  const result = validateTool.execute({});
  assert.ok(result.summary.entryCount >= 2);
  assert.ok(result.summary.missingLanguageCount >= 3);
});

test("check_generated_files 返回缺失文件", () => {
  const dir = createTempProject({});
  const tools = createTools(dir, CONFIG);
  const checkTool = tools.find((t) => t.name === "check_generated_files");
  const result = checkTool.execute({});
  assert.ok(!result.ok);
  assert.ok(result.missingFiles.length > 0);
});

test("toToolDefinitions 提取 OpenAI 格式定义", () => {
  const dir = createTempProject({});
  const tools = createTools(dir, CONFIG);
  const defs = toToolDefinitions(tools);
  assert.ok(defs.length === tools.length);
  assert.ok(defs.every((d) => d.type === "function"));
  assert.ok(defs.every((d) => d.function.name && d.function.description));
});

test("run_shell 执行命令并捕获输出", () => {
  const dir = createTempProject({});
  const tools = createTools(dir, CONFIG);
  const shellTool = tools.find((t) => t.name === "run_shell");
  const result = shellTool.execute({ command: "echo hello_agent" });
  assert.strictEqual(result.ok, true);
  assert.ok(result.stdout.includes("hello_agent"));
});
