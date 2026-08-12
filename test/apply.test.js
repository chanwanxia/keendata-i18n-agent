const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { applyI18n } = require("../src/kit/apply");

/**
 * 创建临时项目并写入文件
 * @param {object} files - { 相对路径: 内容 }
 * @returns {string} 临时目录路径
 */
function createTempProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-apply-"));
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
  apply: {
    templateAttributes: ["placeholder", "title", "label"],
    specialComponents: [
      "kd-column-text",
      "kd-column-show",
      "kd-column-filter",
      "kd-column-form",
      "kd-column-action",
    ],
  },
};

test("p-l 属性转换为金标格式", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><kd-column-text p-l="name,名称"></kd-column-text></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    result.includes(":p-l=\"`name,${t('名称')}`\""),
    `应生成金标格式，实际: ${result}`,
  );
});

test("template 文本节点转换为 t()", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>你好世界</div></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    result.includes('t("你好世界")'),
    `应包含 t("你好世界")，实际: ${result}`,
  );
});

test("template 属性转换为 t() 单引号", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><el-input placeholder="请输入"></el-input></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(result.includes(":placeholder="), "应转换为 v-bind 属性");
  assert.ok(
    result.includes("t('请输入')"),
    `应包含 t('请输入')，实际: ${result}`,
  );
});

test("script 中对象属性 value 转换为 this.t()", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { data() { return { label: "中文标签" }; } }</script>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    result.includes('this.t("中文标签")'),
    `应包含 this.t("中文标签")，实际: ${result}`,
  );
});

test("独立 JS 文件生成 t() 并注入 import", () => {
  const projectRoot = createTempProject({
    "src/routes.js": `export default [{ path: "/", meta: { title: "首页" } }];`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/routes.js"),
    "utf8",
  );
  assert.ok(result.includes('t("首页")'), `应包含 t("首页")，实际: ${result}`);
  assert.ok(
    result.includes('import { t } from "@/languages"'),
    "应注入 import",
  );
});

test("字符串拼接转换为 t() 带占位符", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { methods: { greet() { return "你好" + this.name; } } }</script>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    result.includes('this.t("你好{}"'),
    `应包含 this.t("你好{}"), 实际: ${result}`,
  );
});

test("模板字面量转换为 t() 带占位符", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { methods: { greet() { return \`你好\${this.name}\`; } } }</script>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    result.includes('this.t("你好{}"'),
    `应包含 this.t("你好{}"), 实际: ${result}`,
  );
});

test("已包裹的 t() 不被重复转换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>{{ t("已翻译") }}</div></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  const matchCount = (result.match(/t\("已翻译"\)/g) || []).length;
  assert.strictEqual(matchCount, 1, "t() 不应被重复包裹");
});

test("console 调用中的中文不被转换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { mounted() { console.log("-----管理元数据模块开始校验-----"); } }</script>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    !result.includes("this.t("),
    `console 调用中的中文不应被 t() 包裹，实际: ${result}`,
  );
  assert.ok(
    result.includes('console.log("-----管理元数据模块开始校验-----")'),
    `console 调用应保持原样，实际: ${result}`,
  );
});

test("已包裹 t() 的绑定属性不被重复转换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><el-table-column :formatter="(value) => (value ? t('是') : t('否'))"></el-table-column></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    !result.includes("t(t("),
    `已包裹的 t() 不应被重复包裹，实际: ${result}`,
  );
  assert.ok(result.includes("t('是')"), `t('是') 应保持原样，实际: ${result}`);
});

test("已包裹 t() 的模板字面量绑定属性不被重复转换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><el-input :placeholder="t('当分区字段为多个字段时')"></el-input></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    !result.includes("t(t("),
    `已包裹的模板字面量 t() 不应被重复包裹，实际: ${result}`,
  );
});

test("HTML 注释中的中文不被转换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><!-- <kd-column-text p-l="failureCount,失败数量"></kd-column-text> --><div>实际内容</div></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    !result.includes("t('失败数量')"),
    `HTML 注释中的中文不应被转换，实际: ${result}`,
  );
});

test("箭头函数属性中的已有 t() 不被破坏", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><kd-column-text :formatter="(value) => (value ? t('是') : t('否'))"></kd-column-text></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    !result.includes("{{ t("),
    `箭头函数中的 => 不应触发文本节点匹配，实际: ${result}`,
  );
  assert.ok(result.includes("t('是')"), `t('是') 应保持原样，实际: ${result}`);
});

test("vm.t() 调用不被重复转换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { beforeRouteEnter(to, from, next) { next((vm) => { to.meta.title = vm.t("用户绑定"); }); } }</script>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    !result.includes("this.t("),
    `vm.t() 不应被嵌套 this.t()，实际: ${result}`,
  );
  assert.ok(
    result.includes('vm.t("用户绑定")'),
    `vm.t() 应保持原样，实际: ${result}`,
  );
});

test("RegExp 构造函数中的中文字符串不被转换", () => {
  const projectRoot = createTempProject({
    "src/test.js": `const sReg = new RegExp("^[^\u4e00-\u9fa5 ]*$");`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(path.join(projectRoot, "src/test.js"), "utf8");
  assert.ok(
    !result.includes("t("),
    `RegExp 中的中文不应被 t() 包裹，实际: ${result}`,
  );
  assert.ok(
    result.includes("new RegExp"),
    `RegExp 构造应保持原样，实际: ${result}`,
  );
});

test("直接调用 RegExp() 中的中文字符串不被转换", () => {
  const projectRoot = createTempProject({
    "src/test.js": `const sReg = RegExp("^[^\\u4e00-\\u9fa5 ]*$");`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(path.join(projectRoot, "src/test.js"), "utf8");
  assert.ok(
    !result.includes("t("),
    `RegExp() 中的中文不应被 t() 包裹，实际: ${result}`,
  );
});
