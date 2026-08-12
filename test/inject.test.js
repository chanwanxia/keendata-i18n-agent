const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { injectPackageJson, injectVueConfig } = require("../src/kit/inject");

/**
 * 创建临时项目
 * @param {object} files - { 相对路径: 内容 }
 * @returns {string} 临时目录路径
 */
function createTempProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-inject-"));
  Object.entries(files).forEach(([relPath, content]) => {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  });
  return dir;
}

test("package.json 注入依赖和脚本", () => {
  const projectRoot = createTempProject({
    "package.json": JSON.stringify({
      name: "test",
      dependencies: { vue: "2.6.12" },
      devDependencies: {},
      scripts: {},
    }),
  });

  const result = injectPackageJson(projectRoot);

  assert.strictEqual(result.updated, true);
  assert.ok(result.added.includes("dependencies.@voerkai18n/runtime"));

  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  assert.strictEqual(pkg.dependencies["@voerkai18n/runtime"], "^2.1.13");
  assert.strictEqual(pkg.devDependencies["@voerkai18n/cli"], "^2.1.13");
  assert.strictEqual(pkg.devDependencies["postcss-rtlcss"], "^6.0.0");
  assert.ok(pkg.scripts["i18n:extract"]);
  assert.ok(pkg.scripts["i18n:compile"]);
});

test("package.json 已有依赖不重复注入", () => {
  const projectRoot = createTempProject({
    "package.json": JSON.stringify({
      name: "test",
      dependencies: { "@voerkai18n/runtime": "^2.1.13" },
      devDependencies: {},
      scripts: {},
    }),
  });

  const result = injectPackageJson(projectRoot);

  assert.ok(!result.added.includes("dependencies.@voerkai18n/runtime"));
});

test("vue.config.js 注入 voerkai18n-loader", () => {
  const projectRoot = createTempProject({
    "vue.config.js": `module.exports = { configureWebpack: { module: { rules: [] } } };`,
  });

  const { injectVueConfig } = require("../src/kit/inject");
  const result = injectVueConfig(projectRoot);

  assert.strictEqual(result.updated, true);
  const content = fs.readFileSync(path.join(projectRoot, "vue.config.js"), "utf8");
  assert.ok(content.includes("voerkai18n-loader"), "应包含 voerkai18n-loader");
  assert.ok(content.includes("autoImport: true"), "应包含 autoImport: true");
});

test("vue.config.js 已有 loader 不重复注入", () => {
  const projectRoot = createTempProject({
    "vue.config.js": `module.exports = { configureWebpack: { module: { rules: [{ test: /\\.js$/, use: [{ loader: "voerkai18n-loader" }] }] } } };`,
  });

  const { injectVueConfig } = require("../src/kit/inject");
  const result = injectVueConfig(projectRoot);

  assert.strictEqual(result.updated, false);
});
