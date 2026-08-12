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
    "src/languages/i18n-plugin/i18nMixin.js",
    "src/languages/formatters/zh.js",
    "src/languages/formatters/en.js",
    "src/languages/formatters/jp.js",
    "src/languages/formatters/ar.js",
    "src/mixins/i18n-width-mixin.js",
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
