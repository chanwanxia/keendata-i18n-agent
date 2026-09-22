const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { scanHardcodedChinese } = require("../src/kit/scan");

/**
 * 创建临时项目并写入文件
 * @param {object} files - { 相对路径: 内容 }
 * @returns {string} 临时目录路径
 */
function createTempProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-scan-"));
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
  hardcodedChinese: {
    ignoreFilePrefixes: ["src/languages/formatters/"],
    ignorePatterns: ['from "@/languages"', "from '@/languages'"],
  },
};

test("已包裹 t() 的中文被跳过", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>{{ t("已翻译") }}</div></template>`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.strictEqual(
    result.summary.candidateCount,
    0,
    "已包裹的 t() 不应出现在候选中",
  );
});

test("已包裹 this.t() 的中文被跳过", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { data() { return { label: this.t("已翻译") }; } }</script>`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.strictEqual(result.summary.candidateCount, 0);
});

test("跨行 this.t() 调用的中文被跳过", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { mounted() { const tips = this.t(\n        "跨行翻译文本"\n      ); } }</script>`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.strictEqual(
    result.summary.candidateCount,
    0,
    "跨行 this.t() 调用不应出现在候选中",
  );
});

test("多行块注释中的中文被跳过", () => {
  const projectRoot = createTempProject({
    "src/router.js": `/*
meta:{
    title: "实体管理",
    cache: 路由缓存 非必须参数 默认false
    hideTitle: false  隐藏标题
}
*/
export default [];`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.strictEqual(
    result.summary.candidateCount,
    0,
    "多行块注释中的中文不应出现在候选中",
  );
});

test("多行 HTML 注释中的中文被跳过", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><!--\n  中文注释内容\n--><div></div></template>`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.strictEqual(
    result.summary.candidateCount,
    0,
    "多行 HTML 注释中的中文不应出现在候选中",
  );
});

test("行内注释中的中文被跳过", () => {
  const projectRoot = createTempProject({
    "src/test.js": `const value = 1; // 这里是中文注释`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.strictEqual(
    result.summary.candidateCount,
    0,
    "行内注释中的中文不应出现在候选中",
  );
});

test("字符串里的双斜杠不被当成行内注释", () => {
  const projectRoot = createTempProject({
    "src/test.js": `const url = "http://example.com/中文路径";`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.ok(
    result.summary.candidateCount > 0,
    "字符串中的 // 不应截断后续中文扫描",
  );
});

test("未包裹的中文被检测", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>未翻译文本</div></template>`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.ok(result.summary.candidateCount > 0, "应检测到未包裹的中文");
});

test("路由文件中的中文被检测", () => {
  const projectRoot = createTempProject({
    "src/router/modules/test.js": `export default [{ path: "/", meta: { title: "首页" } }];`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.ok(result.summary.candidateCount > 0, "路由文件中的中文应被检测");
});

test("console 调用中的中文被跳过", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { mounted() { console.log("-----管理元数据模块开始校验-----"); } }</script>`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.strictEqual(
    result.summary.candidateCount,
    0,
    "console 调用中的中文不应出现在候选中",
  );
});

test("displayName 中文侧字段和默认参数不重复扫描", () => {
  const projectRoot = createTempProject({
    "src/mixins/i18n-mixin.js": `export default {
  methods: {
    displayNameConfig() {
      return {
        chLabel: "中文名称",
        chPlaceholder: "请输入中文名称",
        chTip: "请输入中文名称",
        otherLabel: "显示名称",
      };
    },
    displayNameLabel(chLabel = "中文名称", otherLabel = "显示名称") {
      return chLabel || otherLabel;
    },
  },
};`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.strictEqual(
    result.summary.candidateCount,
    1,
    "仅 otherLabel 文案应继续进入扫描结果",
  );
  assert.strictEqual(result.candidates[0].text.includes("otherLabel"), true);
});

test("跨行 console 调用中的中文被跳过", () => {
  const projectRoot = createTempProject({
    "src/test.js": `function test() {\n  console.log(\n    "调试中文信息"\n  );\n}`,
  });

  const result = scanHardcodedChinese(projectRoot, CONFIG);
  assert.strictEqual(
    result.summary.candidateCount,
    0,
    "跨行 console 调用中的中文不应出现在候选中",
  );
});
