# @kd/i18n 全自动国际化 — 完整实现方案 v5

## 概述

将 `keendata-i18n-kit` 和 `@kd/i18n` 合并为单一 npm 包 `@kd/i18n`，以 gaea-fe-new 为唯一金标，实现 `npx @kd/i18n` 一键完成同框架 KeenData Vue2 项目的全部国际化工作。

### voerkai18n 命令职责边界

| 命令 | 作用 | 本工具处理方式 |
|---|---|---|
| `voerkai18n init` | 生成 languages 目录结构 | **scaffold 模块替代** |
| `voerkai18n extract` | 扫描 `t()` 调用提取词条到 `default.json` | **保留调用**，v2 核心能力 |
| `voerkai18n translate` | 调用百度翻译 API 填充翻译 | **LLM 翻译替代** |
| `voerkai18n compile` | 将 `default.json` 编译为运行时 `zh.js`/`en.js`/`jp.js`/`ar.js`/`idMap.js`/`index.js` | **保留调用**，v2 核心能力 |

`@voerkai18n/cli` 版本必须锁定 `2.1.13`，因为 v3 的 extract/compile 行为与 v2 不兼容。

### voerkai18n-loader 工作原理（已验证源码）

`vue.config.js` 中配置 `voerkai18n-loader`（`autoImport: true`），在 webpack 编译时做两件事：

1. **autoImport**：如果文件中没有 `import { t } from "..."`，自动注入。Vue 文件注入到 `<script>` 标签后，JS 文件注入到文件顶部。使用相对路径。
2. **replaceTranslateText**：将 `t("中文")` 中的中文替换为 idMap 中的数字 ID（如 `t("1")`）。

因此：Vue template 中用 `t("中文")` 无需手动 import；Vue script 中用 `this.t("中文")` 无需 import（i18nPlugin 注册为实例方法）；独立 JS 文件手动 `import { t } from "@/languages"` 会阻止 loader 用相对路径重复注入（loader 检测到已有 import 则跳过）。

### 完整流程

```
scaffold → inject → check_cli → doctor → scan → apply → extract → translate(LLM) → validate → compile → finish
```

### preset 匹配规则

`keendata-vue2-voerkai` preset 是所有 KeenData Vue2 项目的国际化规则模板。匹配条件基于**项目类型**，不要求 i18n 基建已就位：

- 框架为 `vue2`
- 依赖包含 `@kd/components`
- 满足以下条件之一：已安装 voerkai18n（正在接入或已接入）、已存在 `src/languages` 目录（scaffold 已执行过）

**设计原则**：preset 匹配 = "这个项目是 KeenData Vue2 项目"，doctor 检查 = "这个项目的 i18n 基建是否完整"。两者不能混在一起：不能因为项目缺少 vue-i18n 依赖就不匹配 preset，否则 doctor 只会输出 1 条 "未命中 preset" 的 warn，无法执行任何实际检查。

---

## 一、合并为单包

- `keendata-i18n-kit/src/*` 全部移入 `@kd/i18n/src/kit/`，agent 的 `require("keendata-i18n-kit")` 改为 `require("./kit")`
- `package.json` 合并 dependencies（`@babel/parser`、`@babel/traverse`、`@babel/generator`、`@babel/types`），`bin` 指向 `bin/@kd/i18n.js`，去掉 `private: true`
- 删除 kit 的 `file:../keendata-i18n-kit` 依赖引用
- `pnpm install` 统一在 agent 包内安装

---

## 二、scaffold 模块

**文件**：`src/kit/scaffold.js` + `src/kit/templates/`

将 gaea-fe-new 的基础设施文件作为模板内嵌。`scaffold(projectRoot, profile, config)` 逐文件写入（已存在则跳过，`--force` 覆盖）。

### 模板文件清单

| 模板文件 | 目标路径 | 说明 |
|---|---|---|
| `languages/index.js` | `src/languages/index.js` | VoerkaI18n scope 入口，`{{packageName}}` 替换为 `profile.packageName` |
| `languages/storage.js` | `src/languages/storage.js` | localStorage 存储器，固定内容 |
| `languages/settings.json` | `src/languages/settings.json` | 语言列表（zh/en/jp/ar），固定内容 |
| `languages/formatters/zh.js` | `src/languages/formatters/zh.js` | 空格式化器 |
| `languages/formatters/en.js` | `src/languages/formatters/en.js` | 空格式化器 |
| `languages/formatters/jp.js` | `src/languages/formatters/jp.js` | 空格式化器 |
| `languages/formatters/ar.js` | `src/languages/formatters/ar.js` | 空格式化器 |
| `languages/translates/default.json` | `src/languages/translates/default.json` | 空翻译源 `{}` |
| `languages/i18n-plugin/i18nMixin.js` | `src/languages/i18n-plugin/i18nMixin.js` | RTL 方向切换 mixin |
| `mixins/i18n-width-mixin.js` | `src/mixins/i18n-width-mixin.js` | `getI18nWidth` 宽度适配 helper |
| `styles/i18n-style.scss` | `src/styles/i18n-style.scss` | RTL 样式覆盖 |
| `utils/elementui-utils.js` | `src/utils/elementui-utils.js` | Element UI + KD 组件 locale 适配；依赖 `@kd/components >= 5.x`（v5 起才有 `dist/locale/lang/*`）；通过 VueI18n 实例统一接管 Element UI + @kd/components 的 locale；main.js inject 依赖此文件的 `i18n` 导出 |
| `postcss.config.js` | `postcss.config.js` | postcss-rtlcss 配置（如不存在则创建，已存在则注入 postcss-rtlcss 插件配置） |

### postcss.config.js 模板

```js
module.exports = {
  plugins: {
    autoprefixer: {},
    "postcss-rtlcss": {
      enabled: true,
      autoRename: true,
      ignoreImportant: true,
      processRoot: true,
      processKeyFrames: false,
      processUrls: false,
    },
  },
};
```

如果目标项目已有 `postcss.config.js`，检测是否包含 `postcss-rtlcss` 配置，如无则在 plugins 中注入。

---

## 三、inject 模块

**文件**：`src/kit/inject.js`

### 3.1 package.json 依赖注入

读取目标项目 `package.json`，JSON parse/serialize 方式注入：

**dependencies 补齐**（如缺）：
- `@voerkai18n/runtime: "^2.1.13"`
- `@voerkai18n/vue2: "^2.1.13"`
- `vue-i18n: "8.28.2"`（elementui-utils.js 依赖 VueI18n 实例接管 Element UI + @kd/components 的 locale）

**devDependencies 补齐**（如缺）：
- `@voerkai18n/cli: "^2.1.13"`（本地 devDependency，用于 `pnpm exec voerkai18n`）
- `voerkai18n-loader: "^2.1.13"`
- `postcss: "^8.5.14"`
- `postcss-rtlcss: "^6.0.0"`
- `postcss-html: "^1.8.1"`
- `postcss-scss: "^4.0.9"`

**scripts 补齐**（如缺）：
- `i18n:extract: "voerkai18n extract -D && prettier --write src/languages/*.*"`
- `i18n:compile: "voerkai18n compile && prettier --write src/languages/*.*"`

版本号严格锁定 `^2.1.13`（voerkai18n 系列）和金标版本（postcss 系列）。

写回 `package.json`，保留原有缩进。不自动执行 `pnpm install`，输出提示让用户手动安装。

### 3.2 全局 CLI 版本检查

- 执行 `voerkai18n --version`，解析版本号
- 如果未安装：输出 `请执行: pnpm add -g @voerkai18n/cli@2.1.13`
- 如果版本是 `3.x`：输出 `检测到 voerkai18n v3.x，与当前工具链不兼容，请降级: pnpm add -g @voerkai18n/cli@2.1.13`
- 如果版本是 `2.1.x`：通过
- 版本不匹配时 agent stop，不继续执行

### 3.3 main.js AST 注入

用 `@babel/parser` 解析，`@babel/traverse` 遍历，`@babel/generator` 输出：

**插入 import**（在现有 import 区域末尾）：
- `import { i18nScope } from "@/languages"`
- `import { i18nPlugin } from "@voerkai18n/vue2"`
- `import { i18nWidthMixin } from "@/mixins/i18n-width-mixin"`
- `require("@/styles/i18n-style.scss")`

**插入 Vue 调用**（在现有 `Vue.use(...)` 序列附近）：
- `Vue.use(i18nPlugin, { i18nScope })`
- `Vue.mixin(i18nWidthMixin)`

**旧 vue-i18n 替换**：
- 如果存在 `import i18n from "@/assets/lang/index"` 等旧引入，替换为 `import { i18n } from "@/utils/elementui-utils"`
- 保留 `Vue.use(ElementUI, { i18n: (key, value) => i18n.t(key, value) })` 调用模式
- 确保 `new Vue({...})` 实例选项中保留 `i18n` 引用（elementui-utils 导出的 VueI18n 实例），金标 main.js 中为 `new Vue({ router, store, i18n, render })`
- 如果 Vue 实例化 options 中没有 `i18n` 字段，注入 `i18n`（elementui-utils 导出的 VueI18n 实例，用于 Element UI 组件内部翻译）

已存在则跳过。

### 3.4 vue.config.js 注入

在 `configureWebpack.module.rules` 中插入 voerkai18n-loader 规则：

```js
{
  test: /\.(js|vue)$/,
  use: [{
    loader: "voerkai18n-loader",
    options: { autoImport: true, debug: false }
  }],
  include: path.join(__dirname, "src"),
  enforce: "pre"
}
```

- 无 `configureWebpack` 字段则创建
- 已有 voerkai18n-loader 则跳过

**exclude 配置说明**：
如目标项目存在含大量非业务中文字符串的文件（SQL 格式化工具、正则表达式、测试数据等），应在 voerkai18n-loader 规则的 `exclude` 中添加。金标项目排除了 `src/utils/sql-formatter-utils.js`。inject 时不自动添加 exclude（项目特定），在输出中提示用户检查。

### 3.5 App.vue 路由标题注入

解析 `<script>` 部分：
- 注入 `import { i18nMixin } from "@/languages/i18n-plugin/i18nMixin"`
- 组件 options 中添加 `mixins: [i18nMixin()]`（已有 mixins 则追加）
- **替换**整个 `$route` watch handler 为标准模式：
  - 从原 watch 中提取项目特定的 fallback 标题（如"数据湖"），替换到标准模式中
  - 标准模式：
 ```js
 const subTitle = this.t(route?.meta?.title ?? "通用配置");
 const prefix = this.t(this.tabPrefix) || this.t("数据中台");
 document.title = subTitle ? `${subTitle} - ${prefix}` : prefix;
 ```
- fallback 标题从原项目的 `?? "原标题"` 中提取，"数据中台" 作为 prefix 固定值
- 已是标准模式（`this.t(route?.meta?.title ??`）则跳过

### 3.6 Accept-Language 注入

- 搜索 `src/utils/` 下含 `interceptors.request.use` 的文件
- 在请求拦截器函数体中注入：
  ```js
  const languageMap = { zh: "zh-CN", en: "en-US", jp: "ja-JP", ar: "ar" };
  config.headers["Accept-Language"] = languageMap[localStorage.getItem("language") || "zh"];
  config.headers["X-Timezone"] = localStorage.getItem("i18n-tz") || "";
  ```
- 已有 `Accept-Language` 则跳过

### 3.7 layout-header 语言切换器注入

对 `src/layout/layout-header/index.vue`（或等价头部组件）执行注入：

**查找策略**：优先 `src/layout/layout-header/index.vue`；如不存在，搜索 `src/layout/` 下含 `right-box` class 的 `.vue` 文件。

**template 注入**：在 `<div class="right-box">` 内部注入语言切换器：
```html
<kd-select
  :value="activeLanguage"
  :options="languages"
  label="title"
  val="name"
  width="160"
  @change="changeLanguage"
></kd-select>
```

**script 注入**：
- 注入 `import { i18nMixin } from "@/languages/i18n-plugin/i18nMixin"`
- 组件 options 添加 `mixins: [i18nMixin()]`（已有 mixins 则追加）

`activeLanguage`、`languages`、`changeLanguage` 均由 `i18nMixin()` 的 computed/methods 提供，无需额外声明。

**幂等性**：已包含 `i18nMixin` 或 `activeLanguage` 则跳过。

### 3.8 @kd/components 版本检查

在 `injectPackageJson` 后检查 `@kd/components` 版本：
- 读取 `package.json` 的 `dependencies["@kd/components"]`
- 若版本 `< 5.0.0`（如 `^4.x`），输出 fail：`@kd/components 版本过低，国际化 locale 文件需要 v5+，请升级: pnpm add @kd/components@^5`
- 若不存在 `@kd/components` 依赖，输出 fail：`未检测到 @kd/components，elementui-utils.js 中的 KD 组件 locale 将不可用`
- doctor 会作为检查项报告，agent 输出提示让用户手动升级

### 3.9 inject 幂等性与 force 模式

inject 的所有子模块（main.js、vue.config.js、App.vue、interceptors、layout-header）都具备幂等性：
- 已包含目标代码时跳过，不重复注入
- `force=true` 模式下，**仅 vue.config.js 会先清理再重新注入**（移除所有已存在的 voerkai18n-loader 规则块后重新注入一个），其他子模块仍跳过（因为它们一旦注入就不会"内容不完整"）
- 这确保了 doctor 修复重试时不会产生重复代码（如重复的 voerkai18n-loader 规则、重复的 import 语句）

---

## 四、apply 模块改造

**文件**：`src/kit/apply.js`

### 4.1 p-l 属性格式

金标格式（严格匹配）：
```
:p-l="`fieldName,${t('中文')}`"
```
- 外层：双引号
- 内层：反引号模板字面量
- t() 参数：单引号

`p-l="fieldName,中文标签"` 转换为 `:p-l="\`fieldName,${t('中文标签')}\`"`

p-l 处理扩展到所有 `kd-column-*` 组件（`kd-column-text`、`kd-column-show`、`kd-column-filter`、`kd-column-form`、`kd-column-forms`、`kd-column-action`）。

### 4.2 template 和 script 的 t() 调用规范

三种上下文严格按金标区分：

- **Vue `<template>` 区**：生成 `t("中文")` 或 `t("中文", arg)`。不需要手动 import — voerkai18n-loader 的 `autoImport: true` 在编译时自动注入 `import { t }` 到 `<script>` 中。
- **Vue `<script>` 区（组件内）**：生成 `this.t("中文")` 或 `this.t("中文", arg)`。`t` 通过 `Vue.use(i18nPlugin, { i18nScope })` 注册为 Vue 实例方法，不需要 import。
- **独立 `.js` 文件**：生成 `t("中文")` + `import { t } from "@/languages"`。手动 import 使用 `@/languages` 别名（比 loader 的相对路径更清晰），且 loader 检测到已有 import 会跳过自动注入。

当前代码已通过 `const translator = options.vueComponent ? "this.t" : "t"` 区分 script 和独立 JS，template 区用 `t`。保持此逻辑。

template 变换仍用正则（因为 Vue2 template 不是标准 JS，无法直接用 babel parser），但增强：
- 补充单引号属性匹配（`placeholder='中文'`）
- 处理多行属性值
- 修复 `:placeholder="t('中文')"` 已有 v-bind 表达式的正确处理

### 4.3 shouldTransformStringLiteral 修正

当前错误排除了对象属性的 value。修改为：

- 仅排除作为 **key** 的 StringLiteral（`parent.key === node && !parent.computed`）
- 作为 **value** 的 StringLiteral（`parent.value === node`）应被转换
  - `label: "中文"` → `label: this.t("中文")`（Vue script 中）
  - `label: "中文"` → `label: t("中文")`（独立 JS 中）
- 验证三元表达式、函数参数、校验器参数中的中文均被正确处理

### 4.4 路由文件处理

- 从 `ignoreFilePrefixes` 中移除 `"src/router/modules/"`
- 路由 `title: "中文"` → `title: t("中文")`
- 自动注入 `import { t } from "@/languages"`

### 4.5 import 注入策略

- **Vue 文件**：不注入 `import { t }`（loader 的 autoImport 处理）
- **独立 JS 文件**：注入 `import { t } from "@/languages"`（已有则跳过）
- 当前代码已正确实现此逻辑

### 4.6 `.meta.title` 表达式自动 t() 包裹

金标项目中 layout 组件（layout-header、layout-nav-bar、layout-breadcrumb、layout-main）均使用 `t(item.meta.title)` 包裹路由标题。apply 模块自动检测 mustache 和 v-bind 中的 `.meta.title` 表达式并包裹 `t()`。

**匹配模式**：
- `{{ item.meta.title }}` → `{{ t(item.meta.title) }}`
- `{{ val.meta.title }}` → `{{ t(val.meta.title) }}`
- `{{ currentPathMeta.title }}` → `{{ t(currentPathMeta.title) }}`（identifier 含 `meta` 或 `Path` 关键字时匹配 `.title`）
- `:title="item.meta.title"` → `:title="t(item.meta.title)"`

**幂等性**：已在 `t()` 内的跳过。

**适用范围**：仅 template 区，不适用于 script 区（script 中 `title: "中文"` 已由 StringLiteral 规则处理）。

### 4.7 isRtl 内联样式自动转换

postcss-rtlcss 无法自动转换 Vue template 中 `:style` 绑定的内联样式。apply 模块检测方向性 CSS 属性并自动转换为 `isRtl` 条件表达式。

**方向性属性映射表**（left ↔ right）：
```
padding-left ↔ padding-right
margin-left ↔ margin-right
left ↔ right
border-left ↔ border-right
```

**转换规则**（仅处理对象语法 `:style="{ ... }"`）：
- `:style="{ 'padding-right': '32px' }"` → `:style="isRtl ? { 'padding-left': '32px' } : { 'padding-right': '32px' }"`
- `:style="{ 'margin-left': '80px' }"` → `:style="isRtl ? { 'margin-right': '80px' } : { 'margin-left': '80px' }"`
- 多属性对象：仅转换方向性属性，非方向性属性（如 `color`）保持不变，合并到两个分支

**JS 级别 isRtl 使用**：
- 检测 script 中 `style.left`、`style.right`、`cssFloat`、`styleFloat` 等赋值为 `"left"` / `"right"` 的情况
- 转换为三元表达式：`style.cssFloat = "left"` → `style.cssFloat = this.isRtl ? "right" : "left"`

**幂等性**：已包含 `isRtl` 的跳过。

### 4.8 `inject: ["isRtl"]` 自动注入

当 apply 模块在某 `.vue` 文件中引入了 `isRtl` 引用（通过 4.7 的内联样式转换，或检测到已有 `isRtl` 使用），但组件 script 中缺少 `inject` 声明时，自动注入。

**检测条件**：文件中出现了 `isRtl` 标识符引用（template 或 script），但 script options 中没有 `inject` 声明 `isRtl`。

**注入逻辑**：
- 已有 `inject:` 数组 → 追加 `"isRtl"`
- 无 `inject` → 在 `export default {` 后注入 `inject: ["isRtl"],`

`isRtl` 由 App.vue 的 `i18nMixin()` 通过 `provide()` 向所有子组件提供，使用前需 `inject`。

### 4.9 `getI18nWidth` 宽度适配使用规范

金标项目中 `el-table-column` 的 `width` 和 `el-form` 的 `label-width` 使用 `getI18nWidth` 按语言适配宽度。apply 模块不自动转换（需根据业务判断），但 DESIGN.md 记录规范：

```html
<!-- 逗号分隔格式：zh,en,jp,ar -->
<kd-column-action :width="getI18nWidth('130, 160')"></kd-column-action>

<!-- 对象格式：{ zh: '100px', en: '150px', jp: '120px', ar: '140px' } -->
<el-form :label-width="getI18nWidth({ zh: '80px', en: '120px' })"></el-form>
```

`getI18nWidth` 由 `Vue.mixin(i18nWidthMixin)` 全局注册，所有组件可直接使用 `this.getI18nWidth()`。

### 4.10 el-form label-width 自动适配

金标项目中所有 `el-form` 使用 `label-width="auto"`，让 Element UI 根据内容自动计算宽度（不同语言下 label 宽度不同，固定 px 值会导致截断或留白）。

apply 模块自动转换：
- `label-width="110px"` → `label-width="auto"`
- `label-width="0px"` → 保持不变（特殊布局用途）
- `label-width="0"` → 保持不变
- `label-width="auto"` → 保持不变

仅处理静态字符串值（`label-width="XXpx"`），不处理动态绑定（`:label-width="..."`）——动态绑定应由 `getI18nWidth` 处理。

---

## 五、LLM 翻译模块

**文件**：`src/kit/translate.js`

替代 `voerkai18n translate` 命令，使用 OpenAI 兼容 API 直接翻译 `default.json`。

### 流程

1. `voerkai18n extract` 执行后，`default.json` 中每个 key（中文原文）的 `en`/`jp`/`ar` 值为空
2. LLM 翻译模块读取 `default.json`，收集所有缺失翻译的 `(sourceText, language)` 对
3. 每批最多 50 个 sourceText，发送给 OpenAI 兼容 API
4. prompt 包含 glossary 术语表作为翻译约束，要求保持 `{}` 占位符不变
5. 将翻译结果写回 `default.json`
6. 执行 glossary 后处理校正（保留现有 `applyGlossaryPostProcess` 逻辑）
7. 执行占位符校验

### 环境变量

- `OPENAI_API_KEY`（必需，否则回退 glossary）
- `OPENAI_BASE_URL`（默认 `https://api.openai.com/v1`）
- `OPENAI_MODEL`（默认 `gpt-5.5`）

### API 调用

- POST `${baseUrl}/chat/completions`
- `temperature: 0`，`response_format: { type: "json_object" }`
- 系统消息：声明翻译引擎角色，附带 glossary 术语表 JSON
- 用户消息：包含待翻译的 sourceText 数组和目标语言列表
- 返回格式：`{ "translations": [{ "source": "中文", "en": "English", "jp": "日本語", "ar": "العربية" }] }`

### 失败处理

- 单批失败时标记为未翻译，不中断整体流程
- `OPENAI_API_KEY` 未设置时回退到 glossary 模式并警告
- `buildFallbackTranslation` 改为返回空字符串（让缺失能被 validate 检测到）

### 增量翻译策略

translate 默认是增量模式，不破坏已有有效翻译：
- 检测 `default.json` 中空翻译和占位式无效翻译（如 `"Text 1"`），只重新翻译这些条目
- 已有有效翻译保持不变，避免重复 LLM 调用
- 每批处理 50 条，输出进度日志（`LLM 翻译进度: 批次 X/Y`），避免长时间无输出
- `force=true` 会清空所有翻译重新翻译，代价极大（词条数 × 语言数），仅在增量翻译多次失败后使用
- agent prompt 中明确指示极慎用 `force=true`

### compile 后 idMap.js 修复

`voerkai18n compile` 生成的 `idMap.js` 可能出现：
- 未加引号的中文 key（`已授权: 1` 而非 `"已授权": 1`），导致 `require()` 失败（ESM）且 JSON.parse 回退也失败
- 尾部分号（`};`）和尾部逗号（`,}`），导致 JSON.parse 失败

这些会导致 voerkai18n-loader 报错 `idMap.ts文件不存在`（因为它遍历完所有候选路径后用最后一个 `.ts` 路径报错）。

`fixIdMapKeys(projectRoot)` 在 compile 后自动执行：
- 引号包裹未加引号的 key
- 移除尾部分号
- 移除对象末尾的尾部逗号

---

## 六、scan 模块增强

**文件**：`src/kit/scan.js`

- 精确跳过已被 `t()` / `this.t()` 包裹的中文：检测中文是否在 `t("...")` 或 `this.t("...")` 的参数内
- 移除 `src/router/modules/` 的 ignoreFilePrefix
- `ignorePatterns` 中的 `"this.t("` 和 `"t("` 改为更精确的检测逻辑，不再简单按行跳过

---

## 七、agent 编排改造

**文件**：`src/policy.js` + `src/runner.js`

### 策略链

```
init_config → create_translation_file → scaffold → inject → check_cli → doctor → scan → apply → extract → translate → validate → compile → finish
```

### 新增动作

- `scaffold`：调用 `kit.scaffold(projectRoot, profile, config)`
- `inject`：调用 `kit.inject(projectRoot, profile, config)`
- `check_cli`：执行 `voerkai18n --version`，非 `2.1.x` 则 stop

### maxSteps

从 12 提升到 20。

### doctor fail 项处理

- 如果 fail 项是 scaffold/inject 能修复的（bootstrap-main、webpack-loader、style-imports、rtl-mixin、rtl-style、width-adaptation、accept-language、component-locale、route-title），回到 scaffold 或 inject 重试一次
- 修复策略按 fail 项类型分发：
  - 文件缺失类（translation-file、rtl-style、width-adaptation、component-locale、rtl-mixin、elementui-utils）：重试 scaffold（force=true 覆盖不完整文件）
  - 代码注入类（bootstrap-main、webpack-loader、style-imports、accept-language、route-title、layout-header-language、dependencies、scripts、postcss-config）：重试 inject（force=true 强制重新注入）
  - 无法自动修复类（kd-components-version 版本过低、global-cli 版本不匹配）：输出提示让用户手动处理
- 用 `state.repairs.scaffoldRetried` / `injectRetried` 防止循环（各最多重试一次）
- 其他 fail 项则 stop

### 上下文连续性

agent 是 Node.js 进程，不受 LLM 上下文窗口限制：
- scan/apply 逐文件遍历，内存占用恒定
- translate 分批 API 调用（50 条/批），不累积上下文
- 全程同步串行执行，不会因上下文中断

### 新增标志

- `--no-auto-scaffold`（默认 true）
- `--no-auto-inject`（默认 true）
- `--project` 可选，默认 `process.cwd()`

---

## 八、doctor 增强

**文件**：`src/kit/doctor.js`

- `checkMainBootstrap` 的 fail 降级为 warn（scaffold/inject 后才可能 pass）
- **所有需要修复的检查项统一为 fail**（不再使用 warn），仅 `preset: none` 保留为 warn（信息性提示，不触发修复）
- 新增 `checkDependencies`：验证 package.json 包含 voerkai18n 依赖（`^2.1.13`）和 postcss-rtlcss
- 新增 `checkScripts`：验证 package.json 包含 `i18n:extract` 和 `i18n:compile`
- 新增 `checkGlobalCli`：验证全局 `voerkai18n` 版本为 `2.1.x`
- 新增 `checkPostcssConfig`：验证 postcss.config.js 包含 postcss-rtlcss 配置
- `checkDependencies` 扩展：增加 `@kd/components` 存在性检查（fail 级别）
- 新增 `checkKdComponentsVersion`：验证 `@kd/components` 版本 >= 5.0.0（v5 起才有 `dist/locale/lang/*`），低于 v5 则 fail
- 新增 `checkLayoutHeaderLanguageSwitcher`：验证 layout-header 组件包含 `i18nMixin` 和语言切换器（`activeLanguage` 或 `changeLanguage`），缺失则 fail
- 新增 `checkElementuiUtils`：验证 `src/utils/elementui-utils.js` 存在且包含 `@kd/components/dist/locale` import，缺失则 fail
- doctor fail 项处理扩展：`kd-components-version`、`layout-header-language`、`elementui-utils` 加入可修复列表

---

## 九、审计能力

在 kit CLI 新增 `audit` 命令，供持续检查项目国际化合规性：

- **残留中文扫描**：扫描所有 `.vue`/`.js` 文件中未被 `t()` 包裹的中文
- **翻译完整性检查**：检查 `default.json` 中缺失的语言翻译、占位符不匹配
- **基建合规检查**：doctor 的简化版（检查关键文件和配置是否存在）
- **产物完整性检查**：验证 `generatedFiles` 是否存在且非空
- 输出结构化报告，`--json` 可用于 CI 集成
- **layout-header 语言切换器检查**：验证头部组件包含语言切换 UI
- **@kd/components 版本检查**：验证 v5+
- **isRtl inject 完整性检查**：扫描使用了 `isRtl` 但缺少 `inject: ["isRtl"]` 的组件
- **`.meta.title` 包裹检查**：扫描 template 中未被 `t()` 包裹的 `.meta.title` 表达式
- **isRtl 内联样式检查**：扫描 `:style` 中含方向性属性但未转换为 `isRtl` 条件表达式的组件

---

## 十、单元测试

**目录**：`test/`，使用 `node:test`

独立运行，构造测试 fixture，不依赖真实项目：

### 测试用例

**`scaffold.test.js`**：
- 验证所有 13 个模板文件正确生成
- `{{packageName}}` 正确替换为项目名
- 已存在文件不被覆盖（除非 `--force`）
- postcss.config.js 在已有文件时注入 postcss-rtlcss 配置

**`inject.test.js`**：
- main.js：验证 import 插入、Vue.use/i18nPlugin 注入、旧 vue-i18n 替换
- vue.config.js：验证 voerkai18n-loader 规则插入、不重复
- App.vue：验证 i18nMixin 注入、document.title 逻辑
- interceptors：验证 Accept-Language 注入
- package.json：验证依赖和 scripts 注入
- layout-header：验证 i18nMixin import、mixins 注入、kd-select 语言切换器注入
- layout-header 幂等：已包含 i18nMixin 跳过
- layout-header 搜索：默认路径不存在时搜索 `src/layout/` 下含 `right-box` 的文件
- @kd/components 版本检查：`^4.x` 触发 warn，`^5.x` 通过，不存在触发 warn
- main.js `new Vue({ i18n })` 保留：替换旧 vue-i18n 后 Vue 实例选项保留 i18n

**`apply.test.js`**：
- p-l 转换：`p-l="field,中文"` → `:p-l="\`field,${t('中文')}\`"`（格式严格匹配金标）
- template `t()`：文本节点 `中文` → `{{ t("中文") }}`
- template 属性：`placeholder="中文"` → `:placeholder="t('中文')"`
- script `this.t()`：`label: "中文"` → `label: this.t("中文")`（Vue 组件内）
- 独立 JS `t()`：`title: "中文"` → `title: t("中文")` + import 注入
- 路由文件转换
- 字符串拼接：`"你好" + name` → `this.t("你好{}", name)`
- 模板字面量：`` `你好${name}` `` → `this.t("你好{}", name)`
- `.meta.title` 包裹：`{{ item.meta.title }}` → `{{ t(item.meta.title) }}`
- `.meta.title` 幂等：`{{ t(item.meta.title) }}` 不变
- `.meta.title` v-bind：`:title="item.meta.title"` → `:title="t(item.meta.title)"`
- isRtl 内联样式转换：`:style="{ 'padding-right': '32px' }"` → `:style="isRtl ? { 'padding-left': '32px' } : { 'padding-right': '32px' }"`
- isRtl 内联样式多属性：`:style="{ 'padding-right': '32px', color: 'red' }"` → 两分支各有 color
- isRtl 内联样式幂等：已包含 `isRtl` 的跳过
- JS 级 isRtl：`style.cssFloat = "left"` → `style.cssFloat = this.isRtl ? "right" : "left"`
- `inject: ["isRtl"]` 自动注入：转换后组件 script 中出现 `inject: ["isRtl"]`
- `inject: ["isRtl"]` 幂等：已有 inject 不重复

**`translate.test.js`**：
- mock fetch 验证 LLM 批量翻译请求格式
- 验证翻译结果正确回填 `default.json`
- 验证 glossary 后处理
- 验证占位符校验
- 验证 `OPENAI_API_KEY` 未设置时回退 glossary

**`scan.test.js`**：
- 已包裹 `t("中文")` 的中文被跳过
- 已包裹 `this.t("中文")` 的中文被跳过
- 未包裹的中文被检测
- 路由文件中的中文被检测（不再被 ignoreFilePrefix 跳过）

**`doctor.test.js`**（新增）：
- checkKdComponentsVersion：v4 → fail，v5 → pass，不存在 → fail
- checkLayoutHeaderLanguageSwitcher：缺失 i18nMixin → fail，包含 → pass
- checkElementuiUtils：缺失文件 → fail，缺少 KD locale import → fail
- checkDependencies 扩展：缺少 @kd/components → fail

---

## 十一、CLI 命令总览

```bash
# 一键执行全流程
npx @kd/i18n run --project /path/to/repo

# 使用 LLM 翻译
OPENAI_API_KEY=xxx npx @kd/i18n run --project /path/to/repo

# 在当前目录执行
npx @kd/i18n run

# 审计项目国际化合规性
npx @kd/i18n audit --project /path/to/repo

# JSON 输出（用于 CI）
npx @kd/i18n run --project /path/to/repo --json
```

---

## 十二、假设与默认值

- 目标项目与 gaea-fe-new 同框架：Vue2 + element-ui + @kd/components + vue-cli
- `@voerkai18n/cli` 全局安装版本必须为 `2.1.13`（v3 不兼容）
- package.json 依赖注入后需用户手动执行 `pnpm install`（agent 不自动执行）
- 全局 CLI 需用户手动安装：`pnpm add -g @voerkai18n/cli@2.1.13`
- LLM 翻译默认 `gpt-5.5`，可通过 `OPENAI_MODEL` 覆盖
- `OPENAI_API_KEY` 未设置时 translate 回退 glossary 并警告
- 代码修改后执行 `pnpm lint fix`
- 新增方法必须补充功能注释
- `@kd/components` 版本必须 `>= 5.0.0`，否则 elementui-utils.js 中的 KD 组件 locale 文件不可用（inject 输出 fail，agent 提示用户手动升级）
- layout-header 文件路径默认 `src/layout/layout-header/index.vue`，如不存在则搜索 `src/layout/` 下含 `right-box` 的 `.vue` 文件
- isRtl 内联样式转换仅处理对象语法 `:style="{ ... }"`，不处理字符串语法 `:style="'padding-right: 32px'"`（字符串语法在金标项目中未使用）
- `.meta.title` 自动包裹仅匹配 template mustache 和 v-bind 表达式，不匹配 script 中的属性访问
- `inject: ["isRtl"]` 自动注入仅在 apply 模块检测到 `isRtl` 引用时触发
- `isRtl` 由 App.vue 的 `i18nMixin()` 通过 `provide()` 向所有子组件提供，使用前需 `inject`
- `getI18nWidth` 宽度适配不自动转换（需根据业务判断），仅记录使用规范
- voerkai18n-loader 的 `exclude` 配置为项目特定，inject 不自动添加，在输出中提示用户检查
