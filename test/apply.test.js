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

// ===== 国际化时区变换测试 =====

test("el-date-picker type=datetime 替换为 kd-date-picker（配对标签）", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><el-date-picker v-model="val" type="datetime" placeholder="选择时间"></el-date-picker></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("<kd-date-picker"), "应替换为 kd-date-picker");
  assert.ok(result.includes("</kd-date-picker>"), "闭合标签也应替换");
  assert.ok(!result.includes("<el-date-picker"), "不应残留 el-date-picker");
});

test("el-date-picker type=datetime 替换为 kd-date-picker（自闭合标签）", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><el-date-picker v-model="val" type="datetime" /></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("<kd-date-picker"), "自闭合标签也应替换为 kd-date-picker");
  assert.ok(!result.includes("<el-date-picker"), "不应残留 el-date-picker");
});

test("el-date-picker 非 datetime 类型不替换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><el-date-picker v-model="val" type="date" placeholder="选择日期"></el-date-picker></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("<el-date-picker"), "type=date 不应替换");
  assert.ok(!result.includes("<kd-date-picker"), "不应出现 kd-date-picker");
});

test("Date.now() 替换为 this.tzDateNow()", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>test</div></template><script>export default { methods: { getTime() { return Date.now(); } } }</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("this.tzDateNow()"), "Date.now() 应替换为 this.tzDateNow()");
  assert.ok(!result.includes("Date.now()"), "不应残留 Date.now()");
});

test("new Date() 无参替换为 this.tzNewDate()", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>test</div></template><script>export default { methods: { getDate() { return new Date(); } } }</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("this.tzNewDate()"), "new Date() 应替换为 this.tzNewDate()");
  assert.ok(!/\bnew\s+Date\(\)/.test(result), "不应残留 new Date()");
});

test("new Date 带参数不替换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>test</div></template><script>export default { methods: { getDate() { return new Date("2024-01-01"); } } }</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('new Date("2024-01-01")'), "带参数的 new Date 不应替换");
});

test("parseTime() 无参替换为 parseTime(this.tzNewDate())", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>test</div></template><script>export default { methods: { fmt() { return parseTime(); } } }</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("parseTime(this.tzNewDate())"), "parseTime() 应替换为 parseTime(this.tzNewDate())");
});

test("dayjs() 无参替换为 this.$i18nNow()", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>test</div></template><script>export default { methods: { now() { return dayjs(); } } }</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("this.$i18nNow()"), "dayjs() 应替换为 this.$i18nNow()");
  assert.ok(!/\bdayjs\(\)/.test(result), "不应残留 dayjs()");
});

test("时区变换幂等性：重复执行不产生重复替换", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>test</div></template><script>export default { methods: { run() { const a = Date.now(); const b = new Date(); const c = parseTime(); const d = dayjs(); } } }</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(!result.includes("Date.now()"), "不应残留 Date.now()");
  assert.ok(!result.includes("this.tzDateNow(this.tzDateNow"), "不应产生嵌套 tzDateNow");
  assert.ok(!result.includes("this.tzNewDate(this.tzNewDate"), "不应产生嵌套 tzNewDate");
  assert.ok(!result.includes("this.$i18nNow(this.$i18nNow"), "不应产生嵌套 $i18nNow");
});

test("独立 JS 文件中的时区变换", () => {
  const projectRoot = createTempProject({
    "src/utils.js": `export function getTime() { return Date.now(); }`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/utils.js"), "utf8");
  assert.ok(result.includes("this.tzDateNow()"), "JS 文件中 Date.now() 也应替换");
});

test("HTML 注释原样保留不被清除", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><!-- 这是注释 --><div>实际内容</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("<!-- 这是注释 -->"), "HTML 注释应原样保留");
});

test("含中文的 HTML 注释保留且不翻译", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><!-- <kd-column-text p-l="failureCount,失败数量"></kd-column-text> --><div>实际内容</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("<!--"), "注释标记应保留");
  assert.ok(result.includes("失败数量"), "注释中的中文应保留原文");
  assert.ok(!result.includes("t('失败数量')"), "注释中的中文不应被翻译");
});

test("多个 HTML 注释均保留", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><!-- 注释一 --><div>内容</div><!-- 注释二 --></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("<!-- 注释一 -->"), "第一个注释应保留");
  assert.ok(result.includes("<!-- 注释二 -->"), "第二个注释应保留");
});

// ===== import { t } 注入策略修正测试 =====

test("Vue 组件仅 this.t() 不注入 import { t }", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>{{ t('标题') }}</div></template><script>export default { methods: { show() { return this.t("操作成功"); } } }</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("this.t("), "普通 methods 中应使用 this.t()");
  assert.ok(!result.includes('import { t }'), "仅 this.t() 的 Vue 组件不应注入 import");
});

test("Vue 组件 props default 有中文时注入 import { t }", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { props: { title: { type: String, default: "用户" } } }</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('t("用户")'), "props default 应使用 t()");
  assert.ok(result.includes('import { t }'), "props default 有 t() 时应注入 import");
});

test("Vue 组件 beforeRouteEnter 有中文时注入 import { t }", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { beforeRouteEnter(to, from, next) { to.meta.title = "首页"; next(); } }</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('t("首页")'), "beforeRouteEnter 应使用 t()");
  assert.ok(result.includes('import { t }'), "beforeRouteEnter 有 t() 时应注入 import");
});

test("cleanup 移除 Vue 文件中不必要的 import { t }", () => {
  const { cleanupI18n } = require("../src/kit/apply");
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>{{ t('标题') }}</div></template><script>import { t } from "@/languages";\nexport default { methods: { show() { return this.t("操作成功"); } } }</script>`,
  });
  cleanupI18n(projectRoot, CONFIG);
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(!result.includes('import { t }'), "无独立 t() 的 Vue 文件应移除多余的 import");
  assert.ok(result.includes("this.t("), "this.t() 调用应保留");
});

test("cleanup 保留 Vue 文件中必要的 import { t }（props default 有 t()）", () => {
  const { cleanupI18n } = require("../src/kit/apply");
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>import { t } from "@/languages";\nexport default { props: { title: { type: String, default: t("用户") } }, methods: { show() { return this.t("操作成功"); } } }</script>`,
  });
  cleanupI18n(projectRoot, CONFIG);
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('import { t }'), "有独立 t() 调用的 Vue 文件应保留 import");
});

test("cleanup 保留独立 JS 文件的 import { t }", () => {
  const { cleanupI18n } = require("../src/kit/apply");
  const projectRoot = createTempProject({
    "src/utils.js": `import { t } from "@/languages";\nexport function getTitle() { return t("首页"); }`,
  });
  cleanupI18n(projectRoot, CONFIG);
  const result = fs.readFileSync(path.join(projectRoot, "src/utils.js"), "utf8");
  assert.ok(result.includes('import { t }'), "独立 JS 文件应保留 import");
});

// ===== 中文名称接入变换测试 =====

test("kd-column-text p-l 中的 t('中文名称') 转换为 displayNameLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><kd-column-text :p-l="\`realName,\${t('中文名称')}\`"></kd-column-text></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('中文名称')"), `应转换为 displayNameLabel，实际: ${result}`);
  assert.ok(!result.includes("t('中文名称')"), "不应残留 t('中文名称')");
});

test("t('显示名称') 是普通国际化文本，不转换为 displayNameLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><kd-column-text :p-l=\"`realName,${t('显示名称')}`\"></kd-column-text></template>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(!result.includes("displayNameLabel"), `显示名称不应转换为 displayNameLabel，实际: ${result}`);
});

test("kd-column-text p-l 中的 t('中文名') 转换为 displayNameLabel('中文名')", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><kd-column-text :p-l="\`realName,\${t('中文名')}\`"></kd-column-text></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('中文名')"), `应转换为 displayNameLabel('中文名')，实际: ${result}`);
});

test("el-descriptions-item label 中的 t('中文名称：') 转换为 displayNameLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><el-descriptions :colon="false"><el-descriptions-item :label="t('中文名称：')">{{ realName }}</el-descriptions-item></el-descriptions></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('中文名称：')"), `应转换为 displayNameLabel('中文名称：')，实际: ${result}`);
});

test("el-descriptions-item label 中的 t('中文名：') 转换为 displayNameLabel('中文名：')", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><el-descriptions :colon=\"false\"><el-descriptions-item :label=\"t('中文名：')\">{{ realName }}</el-descriptions-item></el-descriptions></template>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('中文名：')"), `应转换为 displayNameLabel('中文名：')，实际: ${result}`);
});

test("cleanup 将 displayNameLabel 参数中的 Unicode 转义还原为中文", () => {
  const projectRoot = createTempProject({
    "src/test.vue": String.raw`<template><el-descriptions-item :label="displayNameLabel('\u4e2d\u6587\u540d\uff1a')">{{ userInfo.realName }}</el-descriptions-item></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('中文名：')"), `Unicode 转义应还原为中文，实际: ${result}`);
  assert.ok(!result.includes("\\u4e2d"), `不应残留 Unicode 转义，实际: ${result}`);
});

test("cleanup 对跳过 apply 的基础设施文件也还原 Unicode 转义", () => {
  const projectRoot = createTempProject({
    "src/mixins/i18n-mixin.js": String.raw`export const i18nMixin = { methods: { displayNameLabel(chLabel = "\u4e2d\u6587\u540d\u79f0") { return chLabel; } } };`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/mixins/i18n-mixin.js"), "utf8");
  assert.ok(result.includes('chLabel = "中文名称"'), `基础设施文件中的 Unicode 转义应还原，实际: ${result}`);
  assert.ok(!result.includes("\\u4e2d"), `不应残留 Unicode 转义，实际: ${result}`);
  assert.ok(!result.includes("this.t"), `基础设施文件不应被 apply 包裹 t()，实际: ${result}`);
});

test("cleanup 还原 displayNameLabel Unicode 但保留正则 Unicode 范围", () => {
  const projectRoot = createTempProject({
    "src/test.vue": String.raw`<template><kd-input :title="displayNameLabel('\u4e2d\u6587\u540d')"></kd-input></template><script>export default { data() { return { reg: /^[^\u4e00-\u9fa5 ]*$/, regText: "^[^\\u4e00-\\u9fa5 ]*$" }; } };</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('中文名')"), `displayNameLabel 参数应还原中文，实际: ${result}`);
  assert.ok(result.includes(String.raw`/^[^\u4e00-\u9fa5 ]*$/`), `正则 Unicode 范围应保留，实际: ${result}`);
  assert.ok(result.includes(String.raw`"^[^\\u4e00-\\u9fa5 ]*$"`), `双反斜杠字符串应保留，实际: ${result}`);
});

test("cleanup 保留 RegExp 构造函数字符串中的 Unicode 范围", () => {
  const projectRoot = createTempProject({
    "src/test.js": String.raw`const title = displayNameLabel('\u4e2d\u6587\u540d');
const sReg = new RegExp("^[^\u4e00-\u9fa5 ]*$");`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.js"), "utf8");
  assert.ok(result.includes("displayNameLabel('中文名')"), `displayNameLabel 应还原中文，实际: ${result}`);
  assert.ok(
    result.includes(String.raw`new RegExp("^[^\u4e00-\u9fa5 ]*$")`),
    `RegExp 构造函数字符串中的 Unicode 范围应保留，实际: ${result}`,
  );
});

test("cleanup 展开嵌套 displayNameLabel 调用", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><kd-input :placeholder="
      displayNameLabel(
        displayNameLabel('请输入中文名称', t('请输入显示名称')),
        t('请输入显示名称'),
      )
    "></kd-input></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(
    result.includes("displayNameLabel('请输入中文名称', t('请输入显示名称'))"),
    `应保留单层 displayNameLabel，实际: ${result}`,
  );
  assert.ok(
    !result.includes("displayNameLabel(displayNameLabel"),
    `不应保留嵌套 displayNameLabel，实际: ${result}`,
  );
});

test("cleanup 还原 displayNameLabel 第一参数中的 t() 调用", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template>
      <kd-column-text :p-l="\`chName,\${displayNameLabel(t('项目中文名称'), t('项目显示名称'))}\`"></kd-column-text>
      <kd-input :title="displayNameLabel(t('中文名'))"></kd-input>
    </template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(
    result.includes("displayNameLabel('项目中文名称', t('项目显示名称'))"),
    `第一参数应还原为中文字符串，第二参数应保留 t()，实际: ${result}`,
  );
  assert.ok(
    result.includes("displayNameLabel('中文名')"),
    `单参数 displayNameLabel 第一参数应还原，实际: ${result}`,
  );
  assert.ok(
    !result.includes("displayNameLabel(t("),
    `displayNameLabel 第一参数不应保留 t()，实际: ${result}`,
  );
});

test("cleanup 还原 this.displayNameLabel 第一参数中的 this.t() 调用", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>
      export default {
        methods: {
          getLabel() {
            return this.displayNameLabel(this.t("中文名"));
          }
        }
      };
    </script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(
    result.includes('this.displayNameLabel("中文名")'),
    `this.displayNameLabel 第一参数应还原为中文字符串，实际: ${result}`,
  );
  assert.ok(
    !result.includes("this.displayNameLabel(this.t("),
    `this.displayNameLabel 第一参数不应保留 this.t()，实际: ${result}`,
  );
});

test("cleanup 还原 displayNameConfig 中文侧字段中的 this.t() 调用", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>
      export default {
        created() {
          this.realNameConfig = this.displayNameConfig({
            required: true,
            chLabel: this.t("中文名"),
            chPlaceholder: this.t("请输入中文名"),
            chTip: this.t("请输入中文名"),
            otherLabel: this.t("显示名称"),
            otherPlaceholder: this.t("请输入显示名称"),
            otherTip: this.t("请输入显示名称")
          });
        }
      };
    </script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(
    result.includes('chLabel: "中文名"'),
    `chLabel 应保留中文原文，实际: ${result}`,
  );
  assert.ok(
    result.includes('chPlaceholder: "请输入中文名"'),
    `chPlaceholder 应保留中文原文，实际: ${result}`,
  );
  assert.ok(
    result.includes('chTip: "请输入中文名"'),
    `chTip 应保留中文原文，实际: ${result}`,
  );
  assert.ok(
    result.includes('otherLabel: this.t("显示名称")'),
    `otherLabel 应继续保留 t()，实际: ${result}`,
  );
  assert.ok(
    result.includes('otherPlaceholder: this.t("请输入显示名称")'),
    `otherPlaceholder 应继续保留 t()，实际: ${result}`,
  );
  assert.ok(
    result.includes('otherTip: this.t("请输入显示名称")'),
    `otherTip 应继续保留 t()，实际: ${result}`,
  );
  assert.ok(
    !/\bch(?:Label|Placeholder|Tip):\s*this\.t\(/.test(result),
    `中文侧字段不应被 this.t() 包裹，实际: ${result}`,
  );
});

test("cleanup 对跳过 apply 的基础设施文件也还原中文侧字段中的 this.t()", () => {
  const projectRoot = createTempProject({
    "src/mixins/i18n-mixin.js": `export default { methods: { displayNameConfig() { return { chLabel: this.t("中文名称"), chPlaceholder: this.t("请输入中文名称"), chTip: this.t("请输入中文名称"), otherLabel: this.t("显示名称") }; } } };`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(
    path.join(projectRoot, "src/mixins/i18n-mixin.js"),
    "utf8",
  );
  assert.ok(
    result.includes('chLabel: "中文名称"'),
    `基础设施文件 chLabel 应还原中文原文，实际: ${result}`,
  );
  assert.ok(
    result.includes('chPlaceholder: "请输入中文名称"'),
    `基础设施文件 chPlaceholder 应还原中文原文，实际: ${result}`,
  );
  assert.ok(
    result.includes('chTip: "请输入中文名称"'),
    `基础设施文件 chTip 应还原中文原文，实际: ${result}`,
  );
  assert.ok(
    result.includes('otherLabel: this.t("显示名称")'),
    `基础设施文件 otherLabel 应保留 t()，实际: ${result}`,
  );
});

test("cleanup 还原 chLabel 默认参数中的 this.t()", () => {
  const projectRoot = createTempProject({
    "src/mixins/i18n-mixin.js": `export default { methods: { displayNameLabel(chLabel = this.t("中文名称"), otherLabel = this.t("显示名称")) { return chLabel; } } };`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(
    path.join(projectRoot, "src/mixins/i18n-mixin.js"),
    "utf8",
  );
  assert.ok(
    result.includes('displayNameLabel(chLabel = "中文名称", otherLabel = this.t("显示名称"))'),
    `chLabel 默认参数应还原中文原文，实际: ${result}`,
  );
});

test("el-form-item label 中的 t('中文名') 转换为 displayNameConfig 模式", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><el-form-item :label=\"t('中文名')\" prop=\"realName\"><kd-input v-model=\"form.realName\"></kd-input></el-form-item></template><script>export default { data() { return { form: {} }; } };</script>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('realNameConfig.label'), `应使用 realNameConfig.label，实际: ${result}`);
  assert.ok(result.includes('realNameConfig.rules'), `应使用 realNameConfig.rules，实际: ${result}`);
  assert.ok(result.includes('realNameConfig: {}'), `data 中应有 realNameConfig: {}，实际: ${result}`);
  assert.ok(result.includes('this.realNameConfig = this.displayNameConfig'), `created 中应有 config 初始化，实际: ${result}`);
});

test("el-form-item label 中的 t('中文名称') 转换为 displayNameConfig 使用默认 chLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><el-form-item :label=\"t('中文名称')\" prop=\"realName\"><kd-input v-model=\"form.realName\"></kd-input></el-form-item></template><script>export default { data() { return { form: {} }; } };</script>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('realNameConfig.label'), `应使用 realNameConfig.label，实际: ${result}`);
  assert.ok(result.includes('this.realNameConfig = this.displayNameConfig'), `应有 displayNameConfig 初始化，实际: ${result}`);
  // "中文名称"是默认 chLabel，不需要显式传参
  assert.ok(!result.includes('chLabel:'), `中文名称是默认值，不需要显式 chLabel，实际: ${result}`);
});

test("el-form-item 保留到已有 created() 中", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><el-form-item :label=\"t('中文名')\" prop=\"realName\"><kd-input v-model=\"form.realName\"></kd-input></el-form-item></template><script>export default { data() { return { form: {} }; }, created() { this.init(); } };</script>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('this.realNameConfig = this.displayNameConfig'), `应注入到 created 中，实际: ${result}`);
  assert.ok(result.includes('this.init()'), `原有 created 代码应保留，实际: ${result}`);
});

test("display name 变换幂等性：重复执行不产生重复注入", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><el-form-item :label=\"t('中文名')\" prop=\"realName\"><kd-input v-model=\"form.realName\"></kd-input></el-form-item></template><script>export default { data() { return { form: {} }; } };</script>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  const configCount = (result.match(/this\.realNameConfig = this\.displayNameConfig/g) || []).length;
  assert.strictEqual(configCount, 1, `config 初始化应只有 1 处，实际 ${configCount} 处`);
});

test("placeholder 中的 t('中文名') 转换为 displayNameLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": '<template><kd-input :placeholder="`${t(\'请输入登录名\')}/${t(\'中文名\')}`"></kd-input></template>',
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('中文名')"), `placeholder 中应转换为 displayNameLabel，实际: ${result}`);
  assert.ok(!result.includes("t('中文名')"), "不应残留 t('中文名')");
});

test("script 中 this.t('中文名称') 转换为 this.displayNameLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { methods: { getLabel() { return this.t('中文名称'); } } }</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("this.displayNameLabel('中文名称')"), `script 中应转换为 this.displayNameLabel，实际: ${result}`);
});

test("t('显示名称列表') 不被转换（不含中文名关键词）", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div>{{ t('显示名称列表') }}</div></template>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(!result.includes("displayNameLabel"), `不含中文名的文本不应转换，实际: ${result}`);
});

test("el-form-item prop 有 rules 时设置 required: true", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><el-form-item :label=\"t('中文名')\" prop=\"realName\"><kd-input v-model=\"form.realName\"></kd-input></el-form-item></template><script>export default { data() { return { form: {}, rules: { realName: [this.mBlurRequired()] } }; } };</script>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('required: true'), `prop 有 rules 时应设置 required: true，实际: ${result}`);
});

test("el-form-item displayNameConfig 保留原 rules 中的自定义 validator", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><el-form-item :label="t('中文名称')" prop="nameCh"><kd-input v-model="form.nameCh"></kd-input></el-form-item></template><script>export default { data() { const validateNameCh = async (rule, value, callback) => callback(); return { form: {}, rules: { nameCh: [this.mBlurRequired(this.t("请输入中文名称")), this.mValidateChinese(), { validator: validateNameCh, trigger: "blur" }], type: [this.mChangeRequired(this.t("请选择类型"))] } }; } };</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("nameChConfig.rules"), `应使用 nameChConfig.rules，实际: ${result}`);
  assert.ok(result.includes("required: true"), `必填规则应映射为 required: true，实际: ${result}`);
  assert.ok(result.includes("rules: [{ validator: this.validateNameCh, trigger: \"blur\" }]"), `自定义 validator 应追加到 displayNameConfig.rules，实际: ${result}`);
  assert.ok(result.includes("async validateNameCh(rule, value, callback)"), `validateNameCh 应提升到 methods，实际: ${result}`);
  assert.ok(!result.includes("const validateNameCh"), `data 中不应保留局部 validateNameCh，实际: ${result}`);
  assert.ok(result.includes("type: [this.mChangeRequired"), `其他字段 rules 不应被删除，实际: ${result}`);
  assert.ok(!result.includes("nameCh: ["), `旧 nameCh rules 应移除避免重复校验，实际: ${result}`);
});

test("cleanup 修复旧版 displayNameConfig 丢失的命名 validator", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><el-form-item :label="nameChConfig.label" prop="nameCh" :rules="nameChConfig.rules"><kd-input v-model="form.nameCh"></kd-input></el-form-item></template><script>export default { data() { const validateNameCh = async (rule, value, callback) => callback(); return { nameChConfig: {}, form: {}, rules: { type: [this.mChangeRequired(this.t("请选择类型"))] } }; }, created() { this.nameChConfig = this.displayNameConfig({ required: true }); } };</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('rules: [{ validator: this.validateNameCh, trigger: "blur" }]'), `旧版丢失的 validateNameCh 应补回，实际: ${result}`);
  assert.ok(result.includes("async validateNameCh(rule, value, callback)"), `旧版局部 validateNameCh 应提升到 methods，实际: ${result}`);
  assert.ok(!result.includes("const validateNameCh"), `data 中不应保留局部 validateNameCh，实际: ${result}`);
});

test("cleanup 修复旧版 displayNameConfig 中已存在 rules 的裸 validator 引用", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><el-form-item :label="nameChConfig.label" prop="nameCh" :rules="nameChConfig.rules"><kd-input v-model="form.nameCh"></kd-input></el-form-item></template><script>export default { data() { const validateNameCh = async (rule, value, callback) => callback(); return { nameChConfig: {}, form: {}, rules: { type: [this.mChangeRequired(this.t("请选择类型"))] } }; }, created() { this.nameChConfig = this.displayNameConfig({ required: true, rules: [{ validator: validateNameCh, trigger: "blur" }] }); }, methods: { submit() {} } };</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('rules: [{ validator: this.validateNameCh, trigger: "blur" }]'), `旧版裸 validator 应改为 this.validateNameCh，实际: ${result}`);
  assert.ok(result.includes("async validateNameCh(rule, value, callback)"), `validateNameCh 应提升到 methods，实际: ${result}`);
  assert.ok(!result.includes("const validateNameCh"), `data 中不应保留局部 validateNameCh，实际: ${result}`);
});

// ===== 中文名称子串匹配测试 =====

test("kd-column-text p-l 中的 t('标签中文名称') 子串匹配转换为 displayNameLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><kd-column-text :p-l=\"`chName,${t('标签中文名称')}`\"></kd-column-text></template>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('标签中文名称', t('标签显示名称'))"), `应生成带 otherLabel 的调用，实际: ${result}`);
  assert.ok(!result.includes("t('标签中文名称')"), "不应残留 t('标签中文名称')");
});

test("el-form-item label 中的 t('标签中文名称') 子串匹配转换为 displayNameConfig", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><el-form-item :label=\"t('标签中文名称')\" prop=\"chName\"><kd-input v-model=\"form.chName\"></kd-input></el-form-item></template><script>export default { data() { return { form: {} }; } };</script>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('chNameConfig.label'), `应使用 chNameConfig.label，实际: ${result}`);
  assert.ok(result.includes('chLabel: "标签中文名称"'), `应包含 chLabel，实际: ${result}`);
  assert.ok(result.includes('otherLabel: this.t("标签显示名称")'), `应包含 otherLabel，实际: ${result}`);
});

test("el-descriptions-item label 中的 t('中文名：') 精确匹配不生成 otherLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><el-descriptions-item :label=\"t('中文名：')\">{{ realName }}</el-descriptions-item></template>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('中文名：')"), `精确匹配应只传 chLabel，实际: ${result}`);
  assert.ok(!result.includes("标签显示名称"), "精确匹配不应生成 otherLabel");
});

test("placeholder 中的 t('请输入标签中文名称') 子串匹配", () => {
  const projectRoot = createTempProject({
    "src/test.vue": '<template><kd-input :placeholder="t(\'请输入标签中文名称\')"></kd-input></template>',
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('请输入标签中文名称', t('请输入标签显示名称'))"), `应生成带 otherLabel 的调用，实际: ${result}`);
});

test("script 中 this.t('标签中文名称') 子串匹配转换为 this.displayNameLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><div></div></template><script>export default { methods: { getLabel() { return this.t('标签中文名称'); } } }</script>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("this.displayNameLabel('标签中文名称', this.t('标签显示名称'))"), `script 中应生成 this.displayNameLabel 带 otherLabel，实际: ${result}`);
});

test("script 中裸 t('中文名称') 不转换为未导入的 displayNameLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": `<template><div></div></template><script>export default { props: { label: { type: String, default: "中文名称" } }, beforeRouteEnter(to, from, next) { to.meta.title = "标签中文名称"; next(); } };</script>`,
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes('t("中文名称")'), `props default 中应保留裸 t()，实际: ${result}`);
  assert.ok(result.includes('t("标签中文名称")'), `beforeRouteEnter 中应保留裸 t()，实际: ${result}`);
  assert.ok(!result.includes("displayNameLabel"), `script 裸 t() 不应转换为 displayNameLabel，实际: ${result}`);
});

test("t('中文名称列表') 子串匹配转换为 displayNameLabel 带 otherLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><div>{{ t('中文名称列表') }}</div></template>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('中文名称列表', t('显示名称列表'))"), `子串匹配应生成 otherLabel，实际: ${result}`);
});

test("t('显示名称') 不被转换（普通国际化文本）", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><div>{{ t('显示名称') }}</div></template>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(!result.includes("displayNameLabel"), `显示名称不应转换为 displayNameLabel，实际: ${result}`);
});

test("静态 label 含中文名子串转换为 displayNameLabel", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><el-form-item label=\"标签中文名称\"><kd-input></kd-input></el-form-item></template>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  assert.ok(result.includes("displayNameLabel('标签中文名称', t('标签显示名称'))"), `静态 label 应转换为 displayNameLabel，实际: ${result}`);
});

test("display name 子串匹配幂等性", () => {
  const projectRoot = createTempProject({
    "src/test.vue": "<template><kd-column-text :p-l=\"`chName,${t('标签中文名称')}`\"></kd-column-text></template>",
  });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  applyI18n(projectRoot, CONFIG, { dryRun: false });
  const result = fs.readFileSync(path.join(projectRoot, "src/test.vue"), "utf8");
  const count = (result.match(/displayNameLabel/g) || []).length;
  assert.strictEqual(count, 1, `displayNameLabel 应只出现 1 次，实际 ${count} 次`);
});
