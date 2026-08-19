# @kd/i18n

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

## 安装

```bash
# npm 全局安装
npm install -g @kd/i18n

# 或 pnpm 全局安装
pnpm add -g @kd/i18n
```

安装后可直接使用 `kd-i18n` 命令。

### 版本查看与更新

全局安装后可以通过以下命令管理版本：

```bash
# 查看当前安装版本
kd-i18n -v

# 检查 npm 上是否有新版本（不执行更新）
kd-i18n update --check

# 更新到最新版本（自动检测包管理器 npm/pnpm/yarn）
kd-i18n update
```

## 快速开始

### 在目标项目中一键执行

```bash
# 进入目标项目目录（默认对当前目录执行）
cd /path/to/your-project

# 设置 LLM API Key（默认使用公司内部模型路由）
export LLM_API_KEY=sk-xxx

# 执行全流程（LLM 驱动，默认模式）
kd-i18n run
```

也可以通过 `--project` 指定其他项目路径：

```bash
kd-i18n run --project /path/to/your-project
```

### LLM 配置

默认使用公司内部模型路由（`http://router.keendata.net:5343/v1`），无需额外配置端点。API Key 支持三种方式提供，按优先级依次尝试：

1. **环境变量（优先级最高）** — 设置 `LLM_API_KEY` 环境变量，适用于 CI / 脚本场景：

```bash
export LLM_API_KEY=sk-xxx
kd-i18n run
```

2. **本地存储（推荐，首次使用）** — 首次运行时交互式输入，自动保存到 `~/.kd-i18n/credentials.json`（权限 0600），后续运行自动读取，无需重复输入：

```bash
kd-i18n run
# 首次运行会提示：
# 请输入 API Key: sk-xxx
# API 端点（回车使用默认 ...）:
# 模型名（回车使用默认 ...）:
# → 凭证已保存，下次运行将自动读取
```

3. **重置已保存的凭证** — 如果需要更换 API Key：

```bash
kd-i18n run --reset-key
# → 已清除保存的 API Key，下次运行将重新提示输入
```

> **注意**：agent 启动时会将解析到的凭证同步写入 `process.env`，确保子进程（如 `voerkai18n extract`）和 LLM 翻译模块都能读取到 `LLM_API_KEY`，即使 Key 来自本地存储或交互式输入而非环境变量。

环境变量参考（通常无需手动设置，交互式输入时已自动填充默认值）：

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `LLM_API_KEY` | LLM API 密钥（必需） | 无 |
| `LLM_BASE_URL` | API 端点 | `http://router.keendata.net:5343/v1` |
| `LLM_MODEL` | 模型名称 | `gpt-5.5` |
| `LLM_MAX_RETRIES` | SDK 自动重试次数，降低 429 请求放大 | `1` |
| `LLM_BATCH_CONCURRENCY` | LLM 翻译批次并发数 | `1` |

### 审计项目国际化合规性

```bash
kd-i18n audit
kd-i18n audit --json
```

### 回退到规则模式（不需要 LLM）

```bash
kd-i18n run --decision-mode rule
```

## 断点续传

agent 支持断点续传：每步执行后自动保存 checkpoint 到 `~/.kd-i18n/checkpoints/` 目录（按项目路径 hash 命名），不污染目标项目。中断后重新 `kd-i18n run` 会从上次中断处继续，不会从头开始。

- 任务正常完成后 checkpoint 自动清除
- LLM 调用失败时也会保存 checkpoint，异常中断也能恢复
- 如需从头开始，加 `--no-resume` 参数（会自动清除旧 checkpoint）：

```bash
kd-i18n run --no-resume
```

## 分步操作

如果只想执行某个环节，可以使用 kit 子命令：

```bash
# 探测项目画像
kd-i18n profile

# 检查 i18n 基建
kd-i18n doctor

# 扫描疑似未国际化中文
kd-i18n scan

# 预览自动改写结果（不写入文件）
kd-i18n apply --dry-run

# 执行自动改写
kd-i18n apply

# 自动补齐缺失翻译
kd-i18n translate --provider llm

# 校验翻译完整性与正确性
kd-i18n validate

# 写入基础设施文件
kd-i18n scaffold

# 注入 i18n 代码
kd-i18n inject

# 执行词条提取
kd-i18n extract

# 执行语言包编译
kd-i18n compile
```

以上命令均支持 `--project PATH` 指定目标项目路径。

## Agent 工作流程

`kd-i18n run`（默认 LLM 模式）启动一个 tool-calling agent，LLM 自主决策并调用以下工具完成全流程：

1. **cleanup_i18n** — 清理之前 run 可能遗留的问题（嵌套 t()、重复 import、格式问题）
2. **scaffold** — 写入 i18n 基础设施文件（languages 目录、mixin、样式等）
3. **inject** — 向 main.js / vue.config.js / App.vue / interceptors 注入 i18n 代码
4. **doctor** — 检查基建完整性
5. **scan_chinese** — 扫描未被 t() 包裹的中文
6. **apply_i18n** — 自动将中文包裹为 t() 调用（基于 AST）
7. **extract_entries** — 执行 `voerkai18n extract` 提取词条
8. **translate_entries** — LLM 翻译填充 default.json
9. **validate_translations** — 校验翻译完整性和正确性
10. **compile_languages** — 执行 `voerkai18n compile` 生成运行时语言包
11. **check_generated_files** — 验证运行时产物是否齐全

Agent 还拥有以下能力用于错误恢复和手动修复：

- **read_file** — 读取目标项目任意文件内容
- **write_file** — 写入/覆盖文件（如手动包裹 apply 覆盖不到的中文）
- **list_files** — 列出目录下的文件
- **run_shell** — 执行任意 shell 命令

Agent 遇到工具返回错误时，会读取错误信息、分析问题、采取纠正措施并重试，而不是直接停止。成功标准：doctor 无 fail、scan 候选数为 0、validate 无缺失无问题、compile 成功、generated 文件齐全。

### 运行日志

agent 执行时输出友好的进度日志，格式为 `[step 当前/预估总数] 工具名 → 结果摘要 (耗时)`：

```
[i18n-agent] 自动步数模式（预估 ~71 步），将持续执行直到完成
[i18n-agent] [1/~71] cleanup_i18n → 清理 3 个文件 (0.5s)
[i18n-agent] [2/~71] scaffold → 创建 13 个文件, 跳过 0 个 (0.1s)
[i18n-agent] [3/~71] inject → 注入完成 (5 个文件) (0.3s)
[i18n-agent] [4/~71] doctor → 10 通过, 0 警告, 0 失败 (0.2s)
[i18n-agent] [5/~71] scan_chinese → 发现 42 处待国际化文案 (253 个文件) (1.2s)
[i18n-agent] [6/~71] apply_i18n → 改写 15 个文件, 87 处替换 (3.5s)
...
[i18n-agent] 流程完成，共 12 步，耗时 45.3s
```

恢复执行时会显示：

```
[i18n-agent] 从第 8 步恢复执行（共 7 条历史记录）
```

## CLI 参数

### agent 命令

```bash
kd-i18n run [flags]      # 全流程（默认 LLM 驱动）
kd-i18n audit [flags]    # 审计
```

### 常用参数

| 参数 | 说明 |
|---|---|
| `--project PATH` | 目标项目路径（默认当前目录） |
| `--json` | 输出 JSON，便于 CI 集成 |
| `--decision-mode MODE` | 决策模式：`llm`（默认，LLM 驱动）/ `rule`（旧规则引擎回退） |
| `--max-steps N` | 最大决策步数（0=自动模式，不限步数直到完成，默认） |
| `--max-tool-calls N` | 最大工具调用次数（`--max-steps` 的别名） |
| `--no-resume` | 不从 checkpoint 恢复，从头开始执行（自动清除旧 checkpoint） |
| `--reset-key` | 清除保存的 LLM API Key，下次运行重新输入 |
| `--provider NAME` | 翻译 provider：`llm` / `glossary` / `baidu` / `command` |
| `--dry-run` | apply 模式仅预览不写入 |
| `--force` | 强制清空所有翻译重新翻译（用于修复占位式无效翻译） |
| `--no-auto-init-config` | 禁止自动写入 i18n-kit.config.json |
| `--no-auto-create-translation-file` | 禁止自动创建翻译源文件 |
| `--no-auto-scaffold` | 禁止自动 scaffold 基础设施文件 |
| `--no-auto-inject` | 禁止自动注入 main.js / vue.config.js / App.vue |

## 配置文件

### i18n-kit.config.json

工具的可选配置覆盖文件。不存在时自动推导默认配置。通过 `init --write-config` 写入：

```bash
kd-i18n init --write-config
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
  "maxSteps": 0,
  "autoInitConfig": true,
  "autoCreateTranslationFile": true,
  "autoScaffold": true,
  "autoInject": true,
  "llm": {
    "apiKeyEnv": "LLM_API_KEY",
    "baseUrlEnv": "LLM_BASE_URL",
    "modelEnv": "LLM_MODEL",
    "maxRetriesEnv": "LLM_MAX_RETRIES",
    "defaultBaseUrl": "http://router.keendata.net:5343/v1",
    "defaultModel": "gpt-5.5",
    "maxRetries": 1
  }
}
```

### 步数策略

`maxSteps` 默认为 `0`（自动模式）：不设固定步数上限，agent 持续执行直到完成。安全机制：

- **安全上限**：自动模式下最多 2000 步，防止极端情况下的无限循环
- **循环检测**：连续 5 次完全相同的工具调用自动停止，避免死循环
- **上下文裁剪**：从第 15 步起每 10 步自动截断较早的 tool 结果，保持 LLM 调用速度不随对话增长而退化
- **步数预估**：日志中显示的 `~N` 为预估值（基础 20 + 每 5 个源码文件 1 步），仅用于进度参考，非硬性限制

如果需要设定硬性步数上限，通过 `--max-steps N` 或 `i18n-agent.config.json` 设置：

```bash
# 设定 100 步上限
kd-i18n run --max-steps 100
```

| 模式 | maxSteps | 行为 |
|---|---|---|
| 自动模式（默认） | 0 | 不限步数，安全上限 2000 + 循环检测 |
| 手动上限 | N (>0) | 达到 N 步后停止，checkpoint 已保存可续传 |

## 架构

```
@kd/i18n/
├── bin/
│   └── kd-i18n.js       # CLI 入口
├── src/
│   ├── index.js                      # 模块导出
│   ├── cli.js                        # agent CLI（run / audit）
│   ├── config.js                     # agent 配置
│   ├── runner.js                     # agent 编排（LLM 模式 / rule 模式分支）
│   ├── llm.js                        # LLM 客户端工厂（openai SDK）
│   ├── credentials.js                # 凭证管理（环境变量 > 本地存储 > 交互式输入）
│   ├── policy.js                     # 规则引擎（rule 模式回退用）
│   ├── agent/                        # LLM 驱动的 agent 核心
│   │   ├── index.js                  # agent 入口：创建 client + 估算步数 + 启动 loop
│   │   ├── tools.js                  # 14 个工具定义（文件操作 + kit 封装 + shell）
│   │   ├── prompt.js                 # system prompt 构建
│   │   └── loop.js                   # tool-calling 循环（断点续传 + 上下文裁剪 + 循环检测 + 友好日志）
│   └── kit/                          # CLI 工具库
│       ├── index.js                  # kit 模块导出
│       ├── cli.js                    # kit CLI 命令解析
│       ├── config.js                 # 项目探测与配置生成
│       ├── scaffold.js               # 基础设施文件脚手架
│       ├── inject.js                 # AST 代码注入
│       ├── scan.js                   # 硬编码中文扫描
│       ├── apply.js                  # t() 自动改写（Babel AST + 正则）
│       ├── display-name.js           # "中文名称"接入变换（displayNameLabel/displayNameConfig）
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
└── test/                             # 单元测试（node:test，87 个用例）
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
| `src/agent/index.js` | 创建 OpenAI 兼容 client、凭证同步到 `process.env`、估算步数、加载 config、构建工具和 prompt、启动 loop |
| `src/agent/tools.js` | 14 个工具：read_file / write_file / list_files / scaffold / inject / doctor / scan_chinese / apply_i18n / cleanup_i18n / extract_entries / translate_entries / validate_translations / compile_languages / check_generated_files / run_shell |
| `src/agent/prompt.js` | 构建 system prompt：角色定义、工作流程、错误恢复指令、文件编辑指令、成功标准 |
| `src/agent/loop.js` | tool-calling 循环：调 LLM → 检查 tool_calls → 执行工具 → 喂回结果 → 再调，直到完成。支持断点续传、上下文裁剪、循环检测、友好日志 |

### scaffold 写入的文件清单

| 文件 | 说明 |
|---|---|
| `src/languages/index.js` | VoerkaI18n scope 入口 |
| `src/languages/storage.js` | localStorage 存储器 |
| `src/languages/settings.json` | 语言列表配置 |
| `src/languages/translates/default.json` | 翻译源文件 |
| `src/languages/formatters/{zh,en,jp,ar}.js` | 格式化器 |
| `src/mixins/i18n-mixin.js` | RTL + 宽度适配 + displayName mixin |
| `src/utils/i18n.js` | 非组件场景 displayNameLabel helper |
| `src/styles/i18n-style.scss` | RTL 样式覆盖 |
| `src/utils/elementui-utils.js` | Element UI + KD 组件 locale |
| `postcss.config.js` | postcss-rtlcss 配置 |

### inject 注入的改动

| 文件 | 改动 |
|---|---|
| `package.json` | 注入 @voerkai18n/* 依赖、postcss-rtlcss、i18n 脚本（跨 section 去重，已在 devDependencies 中的不会重复加到 dependencies） |
| `src/main.js` | 注入 i18nPlugin、i18nMixin、样式引入 |
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
| el-date-picker type="datetime" | `<el-date-picker type="datetime">` → `<kd-date-picker type="datetime">` |
| Date.now() | `Date.now()` → `this.tzDateNow()` |
| new Date() | `new Date()` → `this.tzNewDate()`（仅无参，带参数不处理） |
| parseTime() | `parseTime()` → `parseTime(this.tzNewDate())`（仅无参） |
| dayjs() | `dayjs()` → `this.$i18nNow()`（仅无参） |
| 中文名称接入 | t('中文名') → `displayNameLabel('中文名')`；t('标签中文名称') → `displayNameLabel('标签中文名称', t('标签显示名称'))` |
| el-form-item label | 含中文名的 label → `displayNameConfig` 模式（自动注入 data/created 配置） |

不改写的内容：注释、console 调用、已包裹的 t() 调用、import/export 语句、对象属性 key、Directive、`new Date("xxx")` 等带参数调用。

## validate 校验规则

校验 `default.json` 翻译源文件，每条翻译问题只产生一个 issue，按优先级判定：

1. **literal 字面量未保留** — `${...}` 系统变量必须原样保留
2. **placeholder 占位符不一致** — `{}` / `{name}` 占位符的数量和名称必须匹配
3. **source_leakage 源文残留** — 非日文翻译不应包含未翻译的中文

## 本地开发

```bash
# 安装依赖
pnpm install

# 运行测试（87 个用例）
pnpm test

# 查看 agent 帮助
pnpm dev:help

# 直接运行
LLM_API_KEY=sk-xxx node bin/kd-i18n.js run
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

### agent 执行中途停止

自动模式下 agent 会持续执行直到完成，不会因固定步数上限中断。如果遇到以下情况停止：

- **LLM 调用失败** — 检查网络连接和 API Key 有效性，checkpoint 已保存，重新 `kd-i18n run` 可继续
- **循环检测触发** — 连续 5 次相同调用，可能是 LLM 陷入重复决策，重新 `kd-i18n run` 可继续（LLM 会尝试不同策略）
- **达到安全上限 2000 步** — 极端情况，checkpoint 已保存，重新 `kd-i18n run` 可继续

## 工作约定

- 安装依赖统一使用 `pnpm`
- 新增方法必须补充功能注释（JSDoc）
- 代码修改完成后执行 Lint 自动修复（`pnpm lint:fix`）
- `@voerkai18n/cli` 版本必须锁定 `2.1.13`（v3 不兼容）
