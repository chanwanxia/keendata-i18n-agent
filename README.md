# keendata-i18n-agent

One-command i18n automation for KeenData Vue2 projects. Based on the gold-standard `gaea-fe-new` project, it scaffolds infrastructure, injects code, scans hardcoded Chinese, applies `t()` wrappers, translates via LLM, and compiles language packs — all in a single `npx` call.

## 前置条件

目标项目必须是 KeenData Vue2 技术栈：

- Vue 2.6+
- element-ui
- @kd/components
- vue-cli (vue.config.js)

全局安装 voerkai18n CLI（版本必须 2.1.13，v3 不兼容）：

```bash
pnpm add -g @voerkai18n/cli@2.1.13
```

LLM 翻译需要 OpenAI 兼容 API（不设置则回退到 glossary 术语表模式）：

```bash
export OPENAI_API_KEY=sk-xxx
export OPENAI_BASE_URL=https://api.openai.com/v1   # 可选，默认即此值
export OPENAI_MODEL=gpt-4.1-mini                    # 可选，默认即此值
```

## 快速开始

### 在目标项目中一键执行

```bash
# 进入目标项目目录
cd /path/to/your-project

# 执行全流程
npx keendata-i18n-agent run

# 或指定项目路径
npx keendata-i18n-agent run --project /path/to/your-project

# 使用 LLM 翻译
OPENAI_API_KEY=sk-xxx npx keendata-i18n-agent run --project /path/to/your-project
```

### 审计项目国际化合规性

```bash
npx keendata-i18n-agent audit --project /path/to/your-project
npx keendata-i18n-agent audit --project /path/to/your-project --json
```

审计报告每行附带对应的详细查询命令，可直接复制查看问题清单。

### 分步操作

```bash
# 扫描疑似未国际化中文
npx keendata-i18n-agent scan --project /path/to/repo

# 预览自动改写结果（不写入文件）
npx keendata-i18n-agent apply --project /path/to/repo --dry-run

# 执行自动改写
npx keendata-i18n-agent apply --project /path/to/repo

# 校验翻译完整性与正确性
npx keendata-i18n-agent validate --project /path/to/repo

# 检查 i18n 基建
npx keendata-i18n-agent doctor --project /path/to/repo

# 自动补齐缺失翻译
npx keendata-i18n-agent translate --project /path/to/repo --provider llm
```

## 完整流程

`npx keendata-i18n-agent run` 按以下顺序自动执行：

| 步骤 | 动作                      | 说明                                                               |
| ---- | ------------------------- | ------------------------------------------------------------------ |
| 1    | `init_config`             | 生成 `i18n-kit.config.json`（可选，不存在时自动推导默认配置）      |
| 2    | `create_translation_file` | 创建空的 `translates/default.json`                                 |
| 3    | `scaffold`                | 写入基础设施文件（languages 目录、mixin、样式等）                  |
| 4    | `inject`                  | 向 main.js / vue.config.js / App.vue / interceptors 注入 i18n 代码 |
| 5    | `check_cli`               | 检查全局 voerkai18n CLI 版本是否为 2.1.x                           |
| 6    | `doctor`                  | 检查基建完整性                                                     |
| 7    | `scan`                    | 扫描未被 t() 包裹的中文                                            |
| 8    | `apply`                   | 自动将中文包裹为 t() 调用                                          |
| 9    | `extract`                 | 执行 `voerkai18n extract` 提取词条                                 |
| 10   | `translate`               | LLM 翻译填充 default.json                                          |
| 11   | `validate`                | 校验翻译完整性和正确性                                             |
| 12   | `compile`                 | 执行 `voerkai18n compile` 生成运行时语言包                         |

## CLI 命令

### agent 命令

```bash
npx keendata-i18n-agent run [flags]      # 全流程
npx keendata-i18n-agent audit [flags]    # 审计
```

### kit 命令（细粒度操作）

```bash
npx keendata-i18n-agent scaffold --project /path/to/repo
npx keendata-i18n-agent inject --project /path/to/repo
npx keendata-i18n-agent scan --project /path/to/repo
npx keendata-i18n-agent apply --project /path/to/repo --dry-run
npx keendata-i18n-agent doctor --project /path/to/repo
npx keendata-i18n-agent translate --project /path/to/repo --provider llm
npx keendata-i18n-agent validate --project /path/to/repo
npx keendata-i18n-agent extract --project /path/to/repo
npx keendata-i18n-agent compile --project /path/to/repo
npx keendata-i18n-agent profile --project /path/to/repo
npx keendata-i18n-agent init --project /path/to/repo --write-config
```

### 常用参数

| 参数                   | 说明                                            |
| ---------------------- | ----------------------------------------------- |
| `--project PATH`       | 目标项目路径（默认当前目录）                    |
| `--json`               | 输出 JSON，便于 CI 集成                         |
| `--dry-run`            | apply 模式仅预览不写入                          |
| `--provider NAME`      | 翻译 provider：llm / glossary / baidu / command |
| `--force`              | 覆盖已有文件                                    |
| `--strict`             | scan 发现疑似问题时返回非 0                     |
| `--write-config`       | init 模式下写入 i18n-kit.config.json            |
| `--no-apply`           | run 模式跳过 apply                              |
| `--no-extract`         | run 模式跳过 extract                            |
| `--no-translate`       | run 模式跳过 translate                          |
| `--no-compile`         | run 模式跳过 compile                            |
| `--fail-on-scan`       | run 模式发现疑似未国际化文案时直接失败          |
| `--max-steps N`        | 最大决策步数（默认 20）                         |
| `--decision-mode MODE` | 决策模式：rule / llm                            |

## scan 扫描规则

扫描源码中未被 `t()` / `this.t()` / `$t()` / `vm.t()` 等翻译函数包裹的中文，以下内容会被排除：

| 排除项                 | 说明                                                    |
| ---------------------- | ------------------------------------------------------- |
| 注释                   | `//` 单行注释、`/* */` 多行块注释、`<!-- -->` HTML 注释 |
| `console.*()` 调用     | 调试日志中的中文不纳入国际化范围                        |
| 已包裹的 `t()` 调用    | 支持跨行调用（如 `this.t(` 和字符串在不同行）           |
| `import` / `from` 语句 | 模块导入路径中的中文                                    |
| 配置忽略的文件前缀     | 默认忽略 `src/languages/formatters/`                    |

## apply 改写规则

### 改写范围

| 场景                  | 改写方式                                             |
| --------------------- | ---------------------------------------------------- |
| Vue template 文本节点 | `中文` → `{{ t("中文") }}`                           |
| Vue template 属性     | `placeholder="中文"` → `:placeholder="t('中文')"`    |
| kd-column-* p-l 属性  | `p-l="field,中文"` → `:p-l="\`field,${t('中文')}\`"` |
| Vue script 中文字符串 | `"中文"` → `this.t("中文")`                          |
| 独立 JS 中文字符串    | `"中文"` → `t("中文")` + `import { t }`              |
| 字符串拼接            | `"你好" + name` → `this.t("你好{}", name)`           |
| 模板字面量            | `` `你好${name}` `` → `this.t("你好{}", name)`       |

### 不改写的内容

| 排除项                   | 说明                                                                        |
| ------------------------ | --------------------------------------------------------------------------- |
| 注释                     | HTML 注释在 template 区域去除；JS 注释由 Babel AST 天然排除                 |
| `console.*()` 调用       | 调试日志中的中文不包裹 `t()`                                                |
| 已包裹的 `t()` 调用      | 识别 `t()`、`this.t()`、`vm.t()`、`$t()` 等所有 `.t()` 成员调用，不重复包裹 |
| 箭头函数 `=>`            | 文本节点正则使用逆序断言 `(?<!=)>` 避免 `=>` 中的 `>` 误匹配                |
| `import` / `export` 语句 | 模块导入导出路径不转换                                                      |
| 对象属性 key             | `{ 中文: value }` 中的 key 不转换                                           |
| Directive                | `"use strict"` 等指令不转换                                                 |

## validate 校验规则

校验 `default.json` 翻译源文件，包含完整性和正确性两层检查。每条翻译问题只产生一个 issue，按优先级判定：

### 完整性检查

| 检查项   | 说明                                             |
| -------- | ------------------------------------------------ |
| 缺失翻译 | 某条文案某个语言没有翻译（空字符串或字段不存在） |

### 正确性检查（按优先级）

| 优先级 | 检查类型                   | 说明                                                                                  |
| ------ | -------------------------- | ------------------------------------------------------------------------------------- |
| 1      | `literal` 字面量未保留     | `${...}` 等业务系统变量必须原样保留，翻译替换为 `{variable}` 会被检出                 |
| 2      | `placeholder` 占位符不一致 | voerkai18n 占位符 `{}` / `{name}` 的数量和名称必须匹配；源为 `{}` 时翻译可用 `{命名}` |
| 3      | `source_leakage` 源文残留  | 非日文翻译不应包含未翻译的中文（排除 `${...}` 内的中文）                              |

### 占位符兼容规则

voerkai18n 运行时在位置参数调用下忽略占位符名称，按顺序填充。因此：

- 源占位符全为 `{}`（位置占位符）时，翻译可使用 `{}` 或 `{命名占位符}`，数量一致即兼容
- 源占位符含命名占位符（如 `{envTypeName}`）时，翻译必须使用相同的命名占位符
- `${#date(0,0,0):yyyyMMdd#}` 等系统变量不是 voerkai18n 占位符，不纳入占位符校验

## audit 审计报告

```bash
npx keendata-i18n-agent audit --project /path/to/repo
```

输出示例：

```
[i18n-agent] 审计报告: /path/to/repo
[i18n-agent] 残留中文: 31 处（npx keendata-i18n-kit scan --project /path/to/repo 查看详情）
[i18n-agent] 基建检查: 13 通过, 0 警告, 1 失败（npx keendata-i18n-kit doctor --project /path/to/repo 查看详情）
[i18n-agent] 翻译: 0 缺失, 6 问题（npx keendata-i18n-kit validate --project /path/to/repo 查看详情）
[i18n-agent] 产物完整: 是（npx keendata-i18n-kit validate --project /path/to/repo 查看详情）
[i18n-agent] 总体: 不合规
```

每行附带对应的 kit 命令，可直接复制执行查看问题清单。

## 配置文件

### i18n-kit.config.json

工具的可选配置覆盖文件。如果项目中不存在此文件，工具会根据项目画像（`package.json` 依赖、语言目录、包管理器等）自动推导默认配置。存在时，用户配置会合并覆盖到默认配置上。

通过 `init --write-config` 写入：

```bash
npx keendata-i18n-agent init --project /path/to/repo --write-config
```

可覆盖的常用配置项：

```json
{
  "hardcodedChinese": {
    "ignoreFilePrefixes": ["src/languages/formatters/"],
    "ignorePatterns": ["from \"@/languages\""]
  },
  "translate": {
    "provider": "glossary",
    "strictPlaceholders": true
  },
  "apply": {
    "templateAttributes": ["placeholder", "title", "label"],
    "specialComponents": ["kd-column-text", "kd-column-filter", "kd-input"]
  }
}
```

### i18n-agent.config.json

agent 流程控制配置，控制 `run` 命令的行为：

```json
{
  "decisionMode": "rule",
  "maxSteps": 20,
  "autoInitConfig": true,
  "autoCreateTranslationFile": true,
  "autoScaffold": true,
  "autoInject": true,
  "llm": {
    "provider": "openai-compatible",
    "apiKeyEnv": "OPENAI_API_KEY",
    "baseUrlEnv": "OPENAI_BASE_URL",
    "modelEnv": "OPENAI_MODEL",
    "defaultModel": "gpt-4.1-mini"
  }
}
```

## 架构

```
keendata-i18n-agent/
├── bin/
│   └── keendata-i18n-agent.js      # CLI 入口
├── src/
│   ├── index.js                     # 模块导出
│   ├── cli.js                       # agent CLI（run / audit）
│   ├── config.js                    # agent 配置
│   ├── policy.js                    # 规则引擎：根据状态决定下一步
│   ├── runner.js                    # agent 编排：串行执行策略链
│   ├── llm.js                       # LLM 决策客户端
│   └── kit/                         # CLI 工具库
│       ├── index.js                 # kit 模块导出
│       ├── cli.js                   # kit CLI 命令解析
│       ├── config.js                # 项目探测与配置生成
│       ├── scaffold.js              # 基础设施文件脚手架
│       ├── inject.js                # AST 代码注入
│       ├── scan.js                  # 硬编码中文扫描
│       ├── apply.js                 # t() 自动改写（Babel AST + 正则）
│       ├── translate.js             # 翻译（LLM / 百度 / glossary）
│       ├── validate.js              # 翻译校验（完整性 + 正确性）
│       ├── doctor.js                # 基建完整性检查
│       ├── files.js                 # 文件遍历工具
│       ├── shell.js                 # Shell 命令执行
│       ├── presets/                 # 项目预设规则
│       │   ├── index.js
│       │   └── keendata-vue2-voerkai.js
│       └── templates/               # 脚手架模板文件（来自 gaea-fe-new）
│           ├── languages/
│           ├── mixins/
│           ├── styles/
│           ├── utils/
│           └── postcss.config.js
└── test/                            # 单元测试（node:test，41 个用例）
    ├── apply.test.js
    ├── inject.test.js
    ├── scaffold.test.js
    ├── scan.test.js
    └── translate.test.js
```

### scaffold 写入的文件清单

| 文件                                        | 说明                        |
| ------------------------------------------- | --------------------------- |
| `src/languages/index.js`                    | VoerkaI18n scope 入口       |
| `src/languages/storage.js`                  | localStorage 存储器         |
| `src/languages/settings.json`               | 语言列表配置                |
| `src/languages/translates/default.json`     | 翻译源文件                  |
| `src/languages/formatters/{zh,en,jp,ar}.js` | 格式化器                    |
| `src/languages/i18n-plugin/i18nMixin.js`    | RTL 方向切换 mixin          |
| `src/mixins/i18n-width-mixin.js`            | 多语言宽度适配              |
| `src/styles/i18n-style.scss`                | RTL 样式覆盖                |
| `src/utils/elementui-utils.js`              | Element UI + KD 组件 locale |
| `postcss.config.js`                         | postcss-rtlcss 配置         |

### inject 注入的改动

| 文件                          | 改动                                               |
| ----------------------------- | -------------------------------------------------- |
| `package.json`                | 注入 @voerkai18n/* 依赖、postcss-rtlcss、i18n 脚本 |
| `src/main.js`                 | 注入 i18nPlugin、i18nWidthMixin、样式引入          |
| `vue.config.js`               | 注入 voerkai18n-loader 规则                        |
| `src/App.vue`                 | 注入 i18nMixin、路由标题逻辑                       |
| `src/utils/interceptors-*.js` | 注入 Accept-Language / X-Timezone header           |

### voerkai18n 命令职责

| 命令                   | 本工具处理方式          |
| ---------------------- | ----------------------- |
| `voerkai18n init`      | scaffold 模块替代       |
| `voerkai18n extract`   | 保留调用（v2 核心能力） |
| `voerkai18n translate` | LLM 翻译替代            |
| `voerkai18n compile`   | 保留调用（v2 核心能力） |

## 本地开发

```bash
# 安装依赖
pnpm install

# 运行测试（41 个用例）
pnpm test

# 查看 agent 帮助
pnpm dev:help

# 直接运行
node bin/keendata-i18n-agent.js run --project /path/to/repo

# 格式化代码
npx prettier --write src/ test/
```

## 工作约定

- 安装依赖统一使用 `pnpm`
- 新增方法必须补充功能注释（JSDoc）
- 代码修改完成后执行格式化（`npx prettier --write`）
- `@voerkai18n/cli` 版本必须锁定 `2.1.13`（v3 不兼容）
