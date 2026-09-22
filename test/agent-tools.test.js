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

test("read_file 跳过翻译资源全文读取", () => {
  const dir = createTempProject({
    "src/languages/translates/default.json": JSON.stringify({ hello: "你好" }),
  });
  const tools = createTools(dir, CONFIG);
  const readTool = tools.find((t) => t.name === "read_file");
  const result = readTool.execute({
    relativePath: "src/languages/translates/default.json",
  });

  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.content, "");
  assert.match(result.reason, /translate_entries/);
});

test("read_file 截断超大业务文件", () => {
  const largeContent = "a".repeat(60000);
  const dir = createTempProject({
    "src/large.js": largeContent,
  });
  const tools = createTools(dir, CONFIG);
  const readTool = tools.find((t) => t.name === "read_file");
  const result = readTool.execute({ relativePath: "src/large.js" });

  assert.strictEqual(result.truncated, true);
  assert.strictEqual(result.originalLength, largeContent.length);
  assert.ok(result.content.length < largeContent.length);
});

test("write_file 覆盖已存在文件内容", () => {
  const dir = createTempProject({ "src/new.js": "" });
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

test("write_file 保留 iconfont 私有区 Unicode 转义", () => {
  const dir = createTempProject({ "src/draw-fun.js": "" });
  const tools = createTools(dir, CONFIG);
  const writeTool = tools.find((t) => t.name === "write_file");
  const result = writeTool.execute({
    relativePath: "src/draw-fun.js",
    content: String.raw`const icon = "\ue725";
const title = "\u4e2d\u6587\u540d";`,
  });
  assert.strictEqual(result.written, true);
  const content = fs.readFileSync(
    path.join(dir, "src/draw-fun.js"),
    "utf8",
  );
  assert.ok(content.includes(String.raw`const icon = "\ue725";`), `iconfont 私有区不应反解码，实际: ${content}`);
  assert.ok(content.includes('const title = "中文名";'), `普通中文 Unicode 仍应还原，实际: ${content}`);
});

test("write_file 不因注释差异中断写入", () => {
  const dir = createTempProject({
    "src/index.vue": `<template>
<!--      <div class="sdtitle">-->
<div>确认</div>
</template>`,
  });
  const tools = createTools(dir, CONFIG);
  const writeTool = tools.find((t) => t.name === "write_file");
  const result = writeTool.execute({
    relativePath: "src/index.vue",
    content: `<template>
<div>{{ t("确认") }}</div>
</template>`,
  });
  const content = fs.readFileSync(path.join(dir, "src/index.vue"), "utf8");
  assert.strictEqual(result.written, true);
  assert.ok(content.includes('t("确认")'));
});

test("write_file 支持大文件完整写入", () => {
  const dir = createTempProject({
    "src/large.vue": `<template><div>旧内容</div></template>`,
  });
  const tools = createTools(dir, CONFIG);
  const writeTool = tools.find((t) => t.name === "write_file");
  const nextContent = `<template>
${'<section class="row">无关内容</section>\n'.repeat(700)}
<el-button>{{ t("确认") }}</el-button>
</template>`;
  const result = writeTool.execute({
    relativePath: "src/large.vue",
    content: nextContent,
  });
  const content = fs.readFileSync(path.join(dir, "src/large.vue"), "utf8");
  assert.strictEqual(result.written, true);
  assert.ok(content.includes('{{ t("确认") }}'));
  assert.ok(content.includes("无关内容"));
  assert.strictEqual(content, nextContent);
});

test("write_file 拒绝创建不存在的文件", () => {
  const dir = createTempProject({});
  const tools = createTools(dir, CONFIG);
  const writeTool = tools.find((t) => t.name === "write_file");
  const result = writeTool.execute({
    relativePath: "src/deep/nested/file.js",
    content: "ok",
  });
  assert.ok(result.error);
  assert.match(result.error, /禁止创建文件/);
  assert.ok(!fs.existsSync(path.join(dir, "src/deep/nested/file.js")));
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

test("scaffold 工具执行后清理基础设施文件 Unicode 转义", () => {
  const dir = createTempProject({
    "src/mixins/i18n-mixin.js": String.raw`export default { methods: { displayNameLabel(chLabel = "\u4e2d\u6587\u540d\u79f0") { return chLabel; } } };`,
  });
  const tools = createTools(dir, CONFIG);
  const scaffoldTool = tools.find((t) => t.name === "scaffold");
  const result = scaffoldTool.execute({ force: false });
  const content = fs.readFileSync(
    path.join(dir, "src/mixins/i18n-mixin.js"),
    "utf8",
  );
  assert.ok(result.cleanupSummary.cleanedFileCount >= 1);
  assert.ok(content.includes('"中文名称"'), `应还原中文原文，实际: ${content}`);
  assert.ok(!content.includes("\\u4e2d"), `不应残留 Unicode 转义，实际: ${content}`);
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

test("translate_entries 在 agent 中固定使用 llm，不切换到 baidu", async () => {
  const oldLlmKey = process.env.LLM_API_KEY;
  const oldBaiduAppid = process.env.BAIDU_APPID;
  const oldBaiduAppkey = process.env.BAIDU_APPKEY;
  try {
    delete process.env.LLM_API_KEY;
    delete process.env.BAIDU_APPID;
    delete process.env.BAIDU_APPKEY;

    const dir = createTempProject({
      "src/languages/translates/default.json": JSON.stringify({
        你好: { en: "Hello", jp: "こんにちは", ar: "مرحبا" },
      }),
    });
    const tools = createTools(dir, {
      ...CONFIG,
      translate: { provider: "baidu" },
    });
    const translateTool = tools.find((t) => t.name === "translate_entries");

    const result = await translateTool.execute({ provider: "baidu" });

    assert.notStrictEqual(result.provider.used, "baidu");
    assert.doesNotMatch(result.provider.message || "", /BAIDU_APPID/);
  } finally {
    if (oldLlmKey) process.env.LLM_API_KEY = oldLlmKey;
    else delete process.env.LLM_API_KEY;
    if (oldBaiduAppid) process.env.BAIDU_APPID = oldBaiduAppid;
    else delete process.env.BAIDU_APPID;
    if (oldBaiduAppkey) process.env.BAIDU_APPKEY = oldBaiduAppkey;
    else delete process.env.BAIDU_APPKEY;
  }
});

test("translate_entries 工具定义不暴露 provider 或 force 参数", () => {
  const dir = createTempProject({});
  const defs = toToolDefinitions(createTools(dir, CONFIG));
  const translateDef = defs.find(
    (item) => item.function.name === "translate_entries",
  );

  assert.deepStrictEqual(
    Object.keys(translateDef.function.parameters.properties),
    [],
  );
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
