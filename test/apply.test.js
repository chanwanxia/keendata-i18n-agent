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

test("三元模板字面量拆分为独立 t() 调用", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div :title="\`已选\${isCheckDb ? '数据库' : '数据表'}列表\`"></div></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    result.includes("isCheckDb ? t('已选数据库列表') : t('已选数据表列表')"),
    `应拆分为两个独立 t() 调用，实际: ${result}`,
  );
  assert.ok(!result.includes("{}"), `不应使用占位符，实际: ${result}`);
});

test("p-l 绑定属性拼接表达式转换为模板字面量", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><kd-column-text :p-l="'tableName,' + '数据表'"></kd-column-text></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    result.includes(":p-l=\"`tableName,${t('数据表')}`\""),
    `应生成模板字面量格式，实际: ${result}`,
  );
  assert.ok(
    !result.includes("'tableName,' +"),
    `不应保留字符串拼接，实际: ${result}`,
  );
});

test("绑定属性中的 t() 调用使用单引号", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div :title="\`你好\${name}\`"></div></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    result.includes("t('你好{}'"),
    `绑定属性中应使用单引号，实际: ${result}`,
  );
 assert.ok(
   !result.includes('t("你好{}"'),
   `绑定属性中不应使用双引号，实际: ${result}`,
 );
});

test("双重包裹的 t(t('...')) 被展开为 t('...') — 文本节点", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><el-button @click="onCancel">{{ t(t('取消')) }}</el-button></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    !result.includes("t(t("),
    `双重包裹应被展开，实际: ${result}`,
  );
  assert.ok(
    result.includes("t('取消')"),
    `应保留单层 t('取消')，实际: ${result}`,
  );
});

test("双重包裹的 t(t('...')) 被展开为 t('...') — 绑定属性", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><reason-popover-btn :btn-text="t(t('驳回'))"></reason-popover-btn></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    !result.includes("t(t("),
    `双重包裹应被展开，实际: ${result}`,
  );
  assert.ok(
    result.includes("t('驳回')"),
    `应保留单层 t('驳回')，实际: ${result}`,
  );
});

test("双重包裹的 this.t(this.t('...')) 被展开 — script 区域", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { data() { return { msg: this.t(this.t("测试文案")) }; } }</script>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    !result.includes("this.t(this.t("),
    `双重包裹应被展开，实际: ${result}`,
  );
  assert.ok(
    result.includes('this.t("测试文案")'),
    `应保留单层 this.t("测试文案")，实际: ${result}`,
  );
});

test("三重嵌套 t(t(t('...'))) 被完全展开", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>{{ t(t(t('深层嵌套'))) }}</div></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    !result.includes("t(t("),
    `三重嵌套应被完全展开，实际: ${result}`,
  );
  assert.ok(
    result.includes("t('深层嵌套')"),
    `应保留单层 t('深层嵌套')，实际: ${result}`,
  );
});

test("绑定属性中的三元 + 模板字面量正确转换，不破坏标签结构", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><kd-popover-button confirm-text="确认" :reference-text="selectionArr.length > 0 ? \`彻底删除 (\${selectionArr.length})\` : '彻底删除'" @confirm="toDel()"></kd-popover-button></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    result.includes(":confirm-text=\"t('确认')\""),
    `confirm-text 应转换为 t('确认')，实际: ${result}`,
  );
  assert.ok(
    result.includes("t('彻底删除 ({})', selectionArr.length)"),
    `模板字面量应转换为 t('彻底删除 ({})', ...)，实际: ${result}`,
  );
  assert.ok(
    result.includes("t('彻底删除')"),
    `字符串字面量应转换为 t('彻底删除')，实际: ${result}`,
  );
  assert.ok(
    result.includes("@confirm=\"toDel()\""),
    `@confirm 属性应保持原样，实际: ${result}`,
  );
  assert.ok(
    result.includes("</kd-popover-button>"),
    `闭合标签应保持原样，实际: ${result}`,
  );
  assert.ok(
    !result.includes("{{ t(\"0 ?"),
    `不应将比较运算符 > 误识别为文本节点边界，实际: ${result}`,
  );
});

test("绑定属性中比较运算符 > 不被误识别为文本节点边界", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div :class="count > 0 ? '有数据' : '无数据'">{{ count > 0 ? '显示' : '隐藏' }}</div></template>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });

  const result = fs.readFileSync(
    path.join(projectRoot, "src/test.vue"),
    "utf8",
  );
  assert.ok(
    result.includes("t('显示')"),
    `mustache 中的中文应被转换，实际: ${result}`,
  );
  assert.ok(
    result.includes("</div>"),
    `标签结构应保持完整，实际: ${result}`,
  );
});

test("beforeRouteEnter 中使用 t() 而非 this.t()，并注入 import", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<script>
export default {
  beforeRouteEnter(to, from, next) {
    if (to.query.id) {
      to.meta.title = "编辑数据源";
    } else {
      to.meta.title = "新建数据源";
    }
    next();
  },
};
</script>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('t("编辑数据源")'), "beforeRouteEnter 中应使用 t() 而非 this.t()");
  assert.ok(result.includes('t("新建数据源")'), "beforeRouteEnter 中应使用 t()");
  assert.ok(!result.includes("this.t("), "不应出现 this.t()");
  assert.ok(
    result.includes('import { t } from "@/languages"'),
    "应注入 import { t }",
  );
});

test("props default 中使用 t() 而非 this.t()，并注入 import", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<script>
export default {
  props: {
    title: {
      type: String,
      default: "用户",
    },
  },
};
</script>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('t("用户")'), "props default 中应使用 t()");
  assert.ok(!result.includes("this.t("), "不应出现 this.t()");
  assert.ok(
    result.includes('import { t } from "@/languages"'),
    "应注入 import { t }",
  );
});

test("普通 methods 中仍使用 this.t()", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<script>
export default {
  methods: {
    showMessage() {
      return "操作成功";
    },
  },
};
</script>`,
  });

  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("this.t("), "普通 methods 中应使用 this.t()");
  assert.ok(!result.includes('import { t }'), "普通 methods 不应注入 import");
});

// ============ isRtl 内联样式转换测试 ============

test(":style 对象语法的方向性属性转换为 isRtl 条件表达式", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div :style="{ 'padding-right': '32px' }">test</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("isRtl ?"), "应生成 isRtl 条件表达式");
  assert.ok(result.includes("'padding-left'"), "RTL 分支应使用 padding-left");
  assert.ok(result.includes("'padding-right'"), "LTR 分支应保留 padding-right");
});

test("静态 style 属性的方向性 CSS 转换为 :style isRtl 条件表达式", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div style="padding-right: 32px;">test</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes(":style="), "应转换为 :style 绑定");
  assert.ok(result.includes("isRtl ?"), "应生成 isRtl 条件表达式");
  assert.ok(result.includes("'padding-left'"), "RTL 分支应使用 padding-left");
  assert.ok(!result.includes('style="padding-right'), "不应保留原静态 style");
});

test(":style 值中包含嵌套大括号时正确转换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div :style="{ 'padding-right': getStyle({ active: true }) }">test</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("isRtl ?"), "应生成 isRtl 条件表达式");
  assert.ok(result.includes("getStyle({ active: true })"), "应保留完整的函数调用");
});

test("v-bind:style 的方向性属性转换为 isRtl 条件表达式", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div v-bind:style="{ 'margin-left': '10px' }">test</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("v-bind:style="), "应保留 v-bind:style 前缀");
  assert.ok(result.includes("isRtl ?"), "应生成 isRtl 条件表达式");
  assert.ok(result.includes("'margin-right'"), "RTL 分支应使用 margin-right");
});

test("静态 style 多个方向性属性同时转换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div style="padding-right: 32px; margin-left: 10px;">test</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("isRtl ?"), "应生成 isRtl 条件表达式");
  assert.ok(result.includes("'padding-left'"), "padding-right 应映射为 padding-left");
  assert.ok(result.includes("'margin-right'"), "margin-left 应映射为 margin-right");
});

test("静态 style 混合方向性和非方向性属性", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div style="padding-right: 32px; color: red;">test</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("isRtl ?"), "应生成 isRtl 条件表达式");
  assert.ok(result.includes("'padding-left'"), "方向性属性应转换");
  assert.ok(result.includes("'color': 'red'"), "非方向性属性应保留在两个分支中");
});

test("非方向性静态 style 不被转换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div style="color: red; font-size: 14px;">test</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(!result.includes("isRtl"), "非方向性 style 不应转换");
  assert.ok(result.includes('style="color: red'), "应保留原静态 style");
});

test(":style left 属性转换为 right", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div :style="{ 'left': '10px' }">test</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("'right'"), "left 应映射为 right");
  assert.ok(result.includes("'left'"), "LTR 分支应保留 left");
});

test("多行 :style 对象正确转换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div :style="{
  'padding-right': '32px',
  color: 'red'
}">test</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("isRtl ?"), "多行 :style 应正确转换");
  assert.ok(result.includes("'padding-left'"), "应映射为 padding-left");
});

test("已转换的 isRtl 样式不会被重复转换（幂等性）", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div :style="isRtl ? { 'padding-left': '32px' } : { 'padding-right': '32px' }">test</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(!result.includes("isRtl ? isRtl"), "不应产生嵌套 isRtl 条件");
});

test("静态 style 的 left 属性转换为 right", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div style="left: 10px;">test</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes(":style="), "应转换为 :style 绑定");
  assert.ok(result.includes("'right'"), "left 应映射为 right");
  assert.ok(result.includes("'left'"), "LTR 分支应保留 left");
});
