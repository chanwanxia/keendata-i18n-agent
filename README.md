# keendata-i18n-agent

One-command i18n automation for KeenData Vue2 projects. Scaffolds infrastructure, injects code, scans hardcoded Chinese, applies `t()` wrappers, translates via LLM, and compiles language packs — all driven by a tool-calling agent that can read/write source files, recover from errors, and retry until the full i18n pipeline passes.

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

## 快速开始

### 在目标项目中一键执行

```bash
# 进入目标项目目录
cd /path/to/your-project

# 设置 LLM API Key（默认使用公司内部模型路由）
export LLM_API_KEY=sk-xxx

# 执行全流程（LLM 驱动，默认模式）
npx keendata-i18n-agent run

# 或指定项目路径
npx keendata-i18n-agent run --project /path/to/your-project
```

### LLM 配置

默认使用公司内部模型路由（`http://router.keendata.net:5343/v1`），无需额外配置端点。API Key 支持三种方式提供，按优先级依次尝试：

1. **环境变量（优先级最高）** — 设置 `LLM_API_KEY` 环境变量，适用于 CI / 脚本场景：

```bash
export LLM_API_KEY=sk-xxx
npx keendata-i18n-agent run --project /path/to/your-project
```

2. **本地存储（推荐，首次使用）** — 首次运行时交互式输入，自动保存到 `~/.keendata-i18n-agent/credentials.json`（权限 0600），后续运行自动读取，无需重复输入：

```bash
npx keendata-i18n-agent run --project /path/to/your-project
# 首次运行会提示：
# 请输入 API Key: sk-xxx
# API 端点（回车使用默认 ...）:
# 模型名（回车使用默认 ...）:
# → 凭证已保存，下次运行将自动读取
```

3. **重置已保存的凭证** — 如果需要更换 API Key：

```bash
npx keendata-i18n-agent run --reset-key --project /path/to/your-project
# → 已清除保存的 API Key，下次运行将重新提示输入
```

> **注意**：agent 启动时会将解析到的凭证同步写入 `process.env`，确保子进程（如 `voerkai18n extract`）和 LLM 翻译模块都能读取到 `LLM_API_KEY`，即使 Key 来自本地存储或交互式输入而非环境变量。

环境变量参考（通常无需手动设置，交互式输入时已自动填充默认值）：

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `LLM_API_KEY` | LLM API 密钥（必需） | 无 |
| `LLM_BASE_URL` | API 端点 | `http://router.keendata.net:5343/v1` |
| `LLM_MODEL` | 模型名称 | `gpt-5.5` |

```bash
# CI / 脚本场景下通过环境变量提供
export LLM_API_KEY=sk-xxx
npx keendata-i18n-agent run --project /path/to/your-project
```

### 审计项目国际化合规性

```bash
npx keendata-i18n-agent audit --project /path/to/your-project
npx keendata-i18n-agent audit --project /path/to/your-project --json
```

### 回退到规则模式（不需要 LLM）

```bash
npx keendata-i18n-agent run --decision-mode rule --project /path/to/your-project
```

## 分步操作

如果只想执行某个环节，可以使用 kit 子命令：

```bash
# 探测项目画像
npx keendata-i18n-agent profile --project /path/to/repo

# 检查 i18n 基建
npx keendata-i18n-agent doctor --project /path/to/repo

# 扫描疑似未国际化中文
npx keendata-i18n-agent scan --project /path/to/repo

# 预览自动改写结果（不写入文件）
npx keendata-i18n-agent apply --project /path/to/repo --dry-run

# 执行自动改写
npx keendata-i18n-agent apply --project /path/to/repo

# 自动补齐缺失翻译
npx keendata-i18n-agent translate --project /path/to/repo --provider llm

# 校验翻译完整性与正确性
npx keendata-i18n-agent validate --project /path/to/repo

# 写入基础设施文件
npx keendata-i18n-agent scaffold --project /path/to/repo

# 注入 i18n 代码
npx keendata-i18n-agent inject --project /path/to/repo

# 执行词条提取
npx keendata-i18n-agent extract --project /path/to/repo

# 执行语言包编译
npx keendata-i18n-agent compile --project /path/to/repo
```

## Agent 工作流程

`npx keendata-i18n-agent run`（默认 LLM 模式）启动一个 tool-calling agent，LLM 自主决策并调用以下工具完成全流程：

1. **scaffold** — 写入 i18n 基础设施文件（languages 目录、mixin、样式等）
2. **inject** — 向 main.js / vue.config.js / App.vue / interceptors 注入 i18n 代码
3. **doctor** — 检查基建完整性
4. **scan_chinese** — 扫描未被 t() 包裹的中文
5. **apply_i18n** — 自动将中文包裹为 t() 调用（基于 AST）
6. **extract_entries** — 执行 `voerkai18n extract` 提取词条
7. **translate_entries** — LLM 翻译填充 default.json
8. **validate_translations** — 校验翻译完整性和正确性
9. **compile_languages** — 执行 `voerkai18n compile` 生成运行时语言包
10. **check_generated_files** — 验证运行时产物是否齐全

Agent 还拥有以下能力用于错误恢复和手动修复：

- **read_file** — 读取目标项目任意文件内容
- **write_file** — 写入/覆盖文件（如手动包裹 apply 覆盖不到的中文）
- **list_files** — 列出目录下的文件
- **run_shell** — 执行任意 shell 命令

Agent 遇到工具返回错误时，会读取错误信息、分析问题、采取纠正措施并重试，而不是直接停止。成功标准：doctor 无 fail、scan 候选数为 0、validate 无缺失无问题、compile 成功、generated 文件齐全。

## CLI 参数

### agent 命令

```bash
npx keendata-i18n-agent run [flags]      # 全流程（默认 LLM 驱动）
npx keendata-i18n-agent audit [flags]    # 审计
```

### 常用参数

| 参数 | 说明 |
|---|---|
| `--project PATH` | 目标项目路径（默认当前目录） |
| `--json` | 输出 JSON，便于 CI 集成 |
| `--decision-mode MODE` | 决策模式：`llm`（默认，LLM 驱动）/ `rule`（旧规则引擎回退） |
| `--max-steps N` | 最大决策步数（默认 50，大项目自动扩展，见下文） |
| `--max-tool-calls N` | 最大工具调用次数（`--max-steps` 的别名） |
| `--reset-key` | 清除保存的 LLM API Key，下次运行重新输入 |
| `--provider NAME` | 翻译 provider：`llm` / `glossary` / `baidu` / `command` |
| `--dry-run` | apply 模式仅预览不写入 |
| `--force` | 覆盖已有文件 |
| `--strict` | scan 发现疑似问题时返回非 0 |
| `--write-config` | init 模式下写入 i18n-kit.config.json |
| `--no-auto-init-config` | 禁止自动写入 i18n-kit.config.json |
| `--no-auto-scaffold` | 禁止自动 scaffold 基础设施文件 |
| `--no-auto-inject` | 禁止自动注入 main.js / vue.config.js / App.vue |

## 配置文件

### i18n-kit.config.json

工具的可选配置覆盖文件。不存在时自动推导默认配置。通过 `init --write-config` 写入：

```bash
npx keendata-i18n-agent init --project /path/to/repo --write-config
```

常用配置项：

```json
{
  "hardcodedChinese": {
    "ignoreFilePrefixes": ["src/languages/formatters/"],
    "ignorePatterns": ["from \"@/languages\""]
  },
  "translate": {
    "provider": "llm",
    "strictPlaceholders": true
  },
  "apply": {
    "templateAttributes": ["placeholder", "title", "label"],
    "specialComponents": ["kd-column-text", "kd-column-filter"]
  }
}
```

### i18n-agent.config.json

agent 流程控制配置，控制 `run` 命令的行为：

```json
{
  "decisionMode": "llm",
  "maxSteps": 50,
  "autoInitConfig": true,
  "autoCreateTranslationFile": true,
  "autoScaffold": true,
  "autoInject": true,
  "llm": {
    "apiKeyEnv": "LLM_API_KEY",
    "baseUrlEnv": "LLM_BASE_URL",
    "modelEnv": "LLM_MODEL",
    "defaultBaseUrl": "http://router.keendata.net:5343/v1",
    "defaultModel": "gpt-5.5"
  }
}
```

### maxSteps 动态计算

`--max-steps` 的默认值为 50，但大项目文件数多、改写量大，固定步数可能不够。agent 启动时会统计 `src/` 下的源码文件数量（`.js` / `.vue` / `.ts` / `.jsx` / `.tsx`），按以下公式动态调整：

```
动态步数 = 30 + ceil(源码文件数 / 20)
最终步数 = min(max(配置值, 动态步数), 200)
```

| 项目规模 | 源码文件数 | 动态步数 |
|---|---|---|
| 小项目 | ~100 | 35 |
| 中等项目 | ~500 | 55 |
| 大项目 | ~1000 | 80 |
| 超大项目 | ~2000+ | 130~200（上限） |

用户通过 `--max-steps` 或 `i18n-agent.config.json` 设置的值会作为下限：如果配置值大于动态计算值，则使用配置值。

## 架构

```
keendata-i18n-agent/
├── bin/
│   └── keendata-i18n-agent.js       # CLI 入口
├── src/
│   ├── index.js                      # 模块导出
│   ├── cli.js                        # agent CLI（run / audit）
│   ├── config.js                     # agent 配置
│   ├── runner.js                     # agent 编排（LLM 模式 / rule 模式分支）
│   ├── llm.js                        # LLM 客户端工厂（openai SDK）
│   ├── credentials.js                # 凭证管理（环境变量 > 本地存储 > 交互式输入）
│   ├── policy.js                     # 规则引擎（rule 模式回退用）
│   ├── agent/                        # LLM 驱动的 agent 核心
│   │   ├── index.js                  # agent 入口：创建 client + 启动 loop
│   │   ├── tools.js                  # 14 个工具定义（文件操作 + kit 封装 + shell）
│   │   ├── prompt.js                 # system prompt 构建
│   │   └── loop.js                   # tool-calling 循环（约 80 行）
│   └── kit/                          # CLI 工具库
│       ├── index.js                  # kit 模块导出
│       ├── cli.js                    # kit CLI 命令解析
│       ├── config.js                 # 项目探测与配置生成
│       ├── scaffold.js               # 基础设施文件脚手架
│       ├── inject.js                 # AST 代码注入
│       ├── scan.js                   # 硬编码中文扫描
│       ├── apply.js                  # t() 自动改写（Babel AST + 正则）
│       ├── translate.js              # 翻译（LLM / 百度 / glossary）
│       ├── validate.js               # 翻译校验（完整性 + 正确性）
│       ├── doctor.js                 # 基建完整性检查
│       ├── files.js                  # 文件遍历工具
│       ├── shell.js                  # Shell 命令执行（inherit + captured）
│       ├── presets/                  # 项目预设规则
│       │   ├── index.js
│       │   └── keendata-vue2-voerkai.js
│       └── templates/                # 脚手架模板文件
│           ├── languages/
│           ├── mixins/
│           ├── styles/
│           ├── utils/
│           └── postcss.config.js
└── test/                             # 单元测试（node:test，75 个用例）
    ├── apply.test.js
    ├── inject.test.js
    ├── scaffold.test.js
    ├── scan.test.js
    ├── translate.test.js
    ├── agent-tools.test.js
    ├── agent-loop.test.js
    ├── agent-integration.test.js
    ├── credentials.test.js
    └── shell-captured.test.js
```

### Agent 核心模块

| 模块 | 职责 |
|---|---|
| `src/agent/index.js` | 创建 OpenAI 兼容 client、凭证同步到 `process.env`、动态计算 maxSteps、加载 config、构建工具和 prompt、启动 loop |
| `src/agent/tools.js` | 14 个工具：read_file / write_file / list_files / scaffold / inject / doctor / scan_chinese / apply_i18n / extract_entries / translate_entries / validate_translations / compile_languages / check_generated_files / run_shell |
| `src/agent/prompt.js` | 构建 system prompt：角色定义、工作流程、错误恢复指令、文件编辑指令、成功标准 |
| `src/agent/loop.js` | tool-calling 循环：调 LLM → 检查 tool_calls → 执行工具 → 喂回结果 → 再调，直到完成或超 maxSteps |

### scaffold 写入的文件清单

| 文件 | 说明 |
|---|---|
| `src/languages/index.js` | VoerkaI18n scope 入口 |
| `src/languages/storage.js` | localStorage 存储器 |
| `src/languages/settings.json` | 语言列表配置 |
| `src/languages/translates/default.json` | 翻译源文件 |
| `src/languages/formatters/{zh,en,jp,ar}.js` | 格式化器 |
| `src/languages/i18n-plugin/i18nMixin.js` | RTL 方向切换 mixin |
| `src/mixins/i18n-width-mixin.js` | 多语言宽度适配 |
| `src/styles/i18n-style.scss` | RTL 样式覆盖 |
| `src/utils/elementui-utils.js` | Element UI + KD 组件 locale |
| `postcss.config.js` | postcss-rtlcss 配置 |

### inject 注入的改动

| 文件 | 改动 |
|---|---|
| `package.json` | 注入 @voerkai18n/* 依赖、postcss-rtlcss、i18n 脚本（跨 section 去重，已在 devDependencies 中的不会重复加到 dependencies） |
| `src/main.js` | 注入 i18nPlugin、i18nWidthMixin、样式引入 |
| `vue.config.js` | 注入 voerkai18n-loader 规则 |
| `src/App.vue` | 注入 i18nMixin、路由标题逻辑 |
| `src/utils/interceptors-*.js` | 注入 Accept-Language / X-Timezone header（注入到请求成功回调，非错误回调） |

## scan 扫描规则

扫描源码中未被 `t()` / `this.t()` / `$t()` / `vm.t()` 等翻译函数包裹的中文，以下内容会被排除：

- 注释（`//`、`/* */`、`<!-- -->`）
- `console.*()` 调用中的中文
- 已包裹的 `t()` 调用（支持跨行）
- `import` / `from` 语句
- 配置忽略的文件前缀（默认忽略 `src/languages/formatters/`）

## apply 改写规则

| 场景 | 改写方式 |
|---|---|
| Vue template 文本节点 | `中文` → `{{ t("中文") }}` |
| Vue template 属性 | `placeholder="中文"` → `:placeholder="t('中文')"` |
| kd-column-* p-l 属性 | `p-l="field,中文"` → `:p-l="\`field,${t('中文')}\`"` |
| Vue script 中文字符串 | `"中文"` → `this.t("中文")` |
| 独立 JS 中文字符串 | `"中文"` → `t("中文")` + `import { t }` |
| 字符串拼接 | `"你好" + name` → `this.t("你好{}", name)` |
| 模板字面量 | `` `你好${name}` `` → `this.t("你好{}", name)` |

不改写的内容：注释、console 调用、已包裹的 t() 调用、import/export 语句、对象属性 key、Directive。

## validate 校验规则

校验 `default.json` 翻译源文件，每条翻译问题只产生一个 issue，按优先级判定：

1. **literal 字面量未保留** — `${...}` 系统变量必须原样保留
2. **placeholder 占位符不一致** — `{}` / `{name}` 占位符的数量和名称必须匹配
3. **source_leakage 源文残留** — 非日文翻译不应包含未翻译的中文

## 本地开发

```bash
# 安装依赖
pnpm install

# 运行测试（75 个用例）
pnpm test

# 查看 agent 帮助
pnpm dev:help

# 直接运行
LLM_API_KEY=sk-xxx node bin/keendata-i18n-agent.js run --project /path/to/repo
```

## 常见问题

### doctor 报告 global-cli fail

`voerkai18n --version` 的输出包含 ANSI 颜色码（如 `\x1b[32m2.1.13\x1b[39m`），导致版本号正则匹配失败。已修复：解析前先剥离 ANSI 颜色码。如果仍遇到此问题，确认全局安装的 `@voerkai18n/cli` 版本为 2.1.13：

```bash
voerkai18n --version
# 输出中 installed: 后应为 2.1.13
```

### translate 阶段回退到 glossary 模式

如果 LLM_API_KEY 通过本地存储或交互式输入提供（而非环境变量），早期版本中翻译模块直接读 `process.env["LLM_API_KEY"]` 会拿不到值。已修复：agent 启动时将凭证同步写入 `process.env`。

### inject 后 package.json 出现重复依赖

早期版本中 `injectPackageJson` 只在当前 section 内查重，如果 `@voerkai18n/vue2` 已在 `devDependencies` 中，仍会被重复添加到 `dependencies`。已修复：写入前检查另一个 section 是否已存在同一依赖。

## 工作约定

- 安装依赖统一使用 `pnpm`
- 新增方法必须补充功能注释（JSDoc）
- 代码修改完成后执行 Lint 自动修复（`pnpm lint fix`）
- `@voerkai18n/cli` 版本必须锁定 `2.1.13`（v3 不兼容）
