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

test("vue.config.js force 重新注入不产生残留", () => {
  // 模拟真实项目结构：configureWebpack 中已有其他 rules
  const projectRoot = createTempProject({
    "vue.config.js": `const { defineConfig } = require("@vue/cli-service");
const path = require("path");

module.exports = defineConfig({
  configureWebpack: {
    module: {
      rules: [
        {
          test: /\\.css$/,
          use: ["css-loader"],
        },
      ],
    },
    plugins: [],
  },
});
`,
  });

  const { injectVueConfig } = require("../src/kit/inject");

  // 第一次注入
  const result1 = injectVueConfig(projectRoot, {});
  assert.strictEqual(result1.updated, true);
  const content1 = fs.readFileSync(path.join(projectRoot, "vue.config.js"), "utf8");
  assert.ok(content1.includes("voerkai18n-loader"), "第一次注入后应包含 voerkai18n-loader");

  // 统计 voerkai18n-loader 出现次数（应该只有 1 次）
  const count1 = (content1.match(/voerkai18n-loader/g) || []).length;
  assert.strictEqual(count1, 1, `第一次注入后应只有 1 个 voerkai18n-loader，实际 ${count1}`);

  // force 重新注入
  const result2 = injectVueConfig(projectRoot, { force: true });
  assert.strictEqual(result2.updated, true);
  const content2 = fs.readFileSync(path.join(projectRoot, "vue.config.js"), "utf8");
  assert.ok(content2.includes("voerkai18n-loader"), "force 重新注入后应包含 voerkai18n-loader");

  // 统计 voerkai18n-loader 出现次数（应该仍然只有 1 次，无残留）
  const count2 = (content2.match(/voerkai18n-loader/g) || []).length;
  assert.strictEqual(count2, 1, `force 重新注入后应只有 1 个 voerkai18n-loader，实际 ${count2}`);

  // 确保原有规则不被破坏
  assert.ok(content2.includes("css-loader"), "原有 css-loader 规则应保留");

  // 确保语法有效：尝试 require 解析
  assert.doesNotThrow(() => {
    // vue.config.js 使用 defineConfig，直接检查语法平衡
    const openBraces = (content2.match(/{/g) || []).length;
    const closeBraces = (content2.match(/}/g) || []).length;
    assert.strictEqual(openBraces, closeBraces, "大括号应平衡");
  }, "vue.config.js 语法检查失败");
});

test("vue.config.js 多次 force 注入保持干净", () => {
  const projectRoot = createTempProject({
    "vue.config.js": `module.exports = {
  configureWebpack: {
    module: {
      rules: [],
    },
  },
};
`,
  });

  const { injectVueConfig } = require("../src/kit/inject");

  // 连续 3 次 force 注入
  for (let i = 0; i < 3; i++) {
    injectVueConfig(projectRoot, { force: true });
  }

  const content = fs.readFileSync(path.join(projectRoot, "vue.config.js"), "utf8");
  const count = (content.match(/voerkai18n-loader/g) || []).length;
  assert.strictEqual(count, 1, `3 次 force 注入后应只有 1 个 voerkai18n-loader，实际 ${count}`);

  const openBraces = (content.match(/{/g) || []).length;
  const closeBraces = (content.match(/}/g) || []).length;
  assert.strictEqual(openBraces, closeBraces, "大括号应平衡");
});
