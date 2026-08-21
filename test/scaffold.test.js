const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { scaffold } = require("../src/kit/scaffold");

/**
 * 创建临时项目目录用于测试
 * @returns {string} 临时目录路径
 */
function createTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-test-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "test-project" }));
  return dir;
}

test("scaffold 创建所有模板文件", () => {
  const projectRoot = createTempProject();
  const profile = { packageName: "test-project" };
  const config = {};

  const result = scaffold(projectRoot, profile, config);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.summary.createdCount, 12);

  const expectedFiles = [
    "src/languages/index.js",
    "src/languages/storage.js",
    "src/languages/settings.json",
    "src/languages/translates/default.json",
    "src/languages/formatters/zh.js",
    "src/languages/formatters/en.js",
    "src/languages/formatters/jp.js",
    "src/languages/formatters/ar.js",
    "src/mixins/i18n-mixin.js",
    "src/utils/i18n.js",
    "src/styles/i18n-style.scss",
    "src/utils/elementui-utils.js",
  ];

  expectedFiles.forEach((file) => {
    assert.ok(fs.existsSync(path.join(projectRoot, file)), `文件应存在: ${file}`);
  });
});

test("scaffold 替换 packageName 占位符", () => {
  const projectRoot = createTempProject();
  const profile = { packageName: "my-app" };

  scaffold(projectRoot, profile, {});

  const indexContent = fs.readFileSync(path.join(projectRoot, "src/languages/index.js"), "utf8");
  assert.ok(indexContent.includes('"my-app"'), "packageName 应被替换");
  assert.ok(!indexContent.includes("{{packageName}}"), "占位符不应残留");
});

test("scaffold 已存在文件不被覆盖", () => {
  const projectRoot = createTempProject();
  const profile = { packageName: "test-project" };

  const customPath = path.join(projectRoot, "src/languages/storage.js");
  fs.mkdirSync(path.dirname(customPath), { recursive: true });
  fs.writeFileSync(customPath, "// custom content");

  const result = scaffold(projectRoot, profile, {});

  assert.strictEqual(result.summary.skippedCount, 1);
  const content = fs.readFileSync(customPath, "utf8");
  assert.strictEqual(content, "// custom content");
});

test("scaffold --force 覆盖已存在文件", () => {
  const projectRoot = createTempProject();
  const profile = { packageName: "test-project" };

  const customPath = path.join(projectRoot, "src/languages/storage.js");
  fs.mkdirSync(path.dirname(customPath), { recursive: true });
  fs.writeFileSync(customPath, "// custom content");

  scaffold(projectRoot, profile, {}, { force: true });

  const content = fs.readFileSync(customPath, "utf8");
  assert.ok(!content.includes("// custom content"), "force 应覆盖已有文件");
});

test("scaffold 创建 postcss.config.js", () => {
  const projectRoot = createTempProject();
  const profile = { packageName: "test-project" };

  scaffold(projectRoot, profile, {});

  const postcssPath = path.join(projectRoot, "postcss.config.js");
  assert.ok(fs.existsSync(postcssPath));
  const content = fs.readFileSync(postcssPath, "utf8");
  assert.ok(content.includes("postcss-rtlcss"));
});

// ===== postcss.config.js 重复 key 修复测试 =====

test("ensurePostcssConfig force 模式不产生重复 postcss-rtlcss key", () => {
  const { ensurePostcssConfig } = require("../src/kit/scaffold");
  const projectRoot = createTempProject();

  // 先 scaffold 一次创建 postcss.config.js
  scaffold(projectRoot, { packageName: "test" }, {});

 // 模拟已有 postcss-rtlcss 的情况下 force 重新注入
 ensurePostcssConfig(projectRoot, { force: true });

  const content = fs.readFileSync(path.join(projectRoot, "postcss.config.js"), "utf8");
  // 统计 postcss-rtlcss 出现次数（key 出现在 plugins 对象中）
  const matches = content.match(/["']?postcss-rtlcss["']?\s*:/g) || [];
  assert.strictEqual(matches.length, 1, `应只有 1 个 postcss-rtlcss key，实际 ${matches.length} 个:\n${content}`);
});

test("ensurePostcssConfig 向已有配置注入不重复", () => {
  const { ensurePostcssConfig } = require("../src/kit/scaffold");
  const projectRoot = createTempProject();

  // 创建一个已有 autoprefixer 但没有 postcss-rtlcss 的配置
  fs.writeFileSync(
    path.join(projectRoot, "postcss.config.js"),
    `module.exports = {\n  plugins: {\n    autoprefixer: {},\n  },\n};\n`,
  );

  ensurePostcssConfig(projectRoot, {});

  const content = fs.readFileSync(path.join(projectRoot, "postcss.config.js"), "utf8");
  const matches = content.match(/["']?postcss-rtlcss["']?\s*:/g) || [];
  assert.strictEqual(matches.length, 1, "注入后应只有 1 个 postcss-rtlcss key");
  assert.ok(content.includes("autoprefixer"), "原有的 autoprefixer 应保留");
});

test("ensurePostcssConfig force 模式移除旧配置再注入", () => {
  const { ensurePostcssConfig } = require("../src/kit/scaffold");
  const projectRoot = createTempProject();

  // 创建已有 postcss-rtlcss（旧配置，可能格式不同）的文件
  fs.writeFileSync(
    path.join(projectRoot, "postcss.config.js"),
    `module.exports = {\n  plugins: {\n    autoprefixer: {},\n    "postcss-rtlcss": {\n      enabled: false,\n    },\n  },\n};\n`,
  );

  // force 重新注入
  ensurePostcssConfig(projectRoot, { force: true });

  const content = fs.readFileSync(path.join(projectRoot, "postcss.config.js"), "utf8");
  const matches = content.match(/["']?postcss-rtlcss["']?\s*:/g) || [];
  assert.strictEqual(matches.length, 1, "force 后应只有 1 个 postcss-rtlcss key");
  assert.ok(content.includes("enabled: true"), "应使用新配置 enabled: true");
  assert.ok(!content.includes("enabled: false"), "旧配置 enabled: false 应被移除");
});

test("i18n-mixin 模板包含 displayName 方法", () => {
  const projectRoot = createTempProject();
  scaffold(projectRoot, { packageName: "test" }, {});

  const content = fs.readFileSync(
    path.join(projectRoot, "src/mixins/i18n-mixin.js"),
    "utf8",
  );
  assert.ok(
    content.includes("displayNameLabel"),
    "i18n-mixin.js 应包含 displayNameLabel 方法",
  );
  assert.ok(
    content.includes("displayNameConfig"),
    "i18n-mixin.js 应包含 displayNameConfig 方法",
  );
});

test("scaffold 为已存在的 i18n-mixin 补充操作栏自动宽度 helper", () => {
  const projectRoot = createTempProject();
  const mixinPath = path.join(projectRoot, "src/mixins/i18n-mixin.js");
  fs.mkdirSync(path.dirname(mixinPath), { recursive: true });
  fs.writeFileSync(
    mixinPath,
    `export const i18nMixin = {
  methods: {
    getI18nWidth() {
      return "auto";
    },

    // "中文名称"接入配置
    displayNameLabel() {
      return "";
    },
  },
};
`,
  );

  const result = scaffold(projectRoot, { packageName: "test" }, {});
  const content = fs.readFileSync(mixinPath, "utf8");

  assert.strictEqual(result.summary.actionColumnWidthUpdated, true);
  assert.ok(
    content.includes("getActionColumnWidth"),
    "应补充 getActionColumnWidth",
  );
  assert.ok(
    content.includes("displayNameLabel"),
    "应保留既有 displayNameLabel",
  );
});
