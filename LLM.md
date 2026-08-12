# 将 keendata-i18n-agent 改造为真正的 LLM 驱动 Agent

## Summary

将当前的伪 agent（线性 if-else 状态机 + 装饰性 LLM）改造为真正的 tool-calling agent。LLM 成为默认决策核心，能自主调用 scan/apply/translate/validate 等工具，能读写目标项目源码文件做针对性修复，能从错误中恢复并重试，直到 i18n 流程完整通过。现有 kit 函数（scan、apply、translate 等）保持不变，作为 agent 的工具层。`--decision-mode rule` 保留为回退模式。

使用 `openai` SDK 作为 HTTP 客户端，通过 `baseURL` 指向公司模型路由。自建约 100 行 tool-calling loop，不引入额外 agent 框架。

## LLM 配置设计

### 环境变量

统一使用模型无关的环境变量名：

- `LLM_API_KEY` — API 密钥（必需）
- `LLM_BASE_URL` — API 端点（默认 `http://router.keendata.net:5343/v1`）
- `LLM_MODEL` — 模型名（默认 `gpt-5.5`）

### config 中的字段

`i18n-agent.config.json` 的 `llm` 字段改为：

```json
{
  "llm": {
    "apiKeyEnv": "LLM_API_KEY",
    "baseUrlEnv": "LLM_BASE_URL",
    "modelEnv": "LLM_MODEL",
    "defaultBaseUrl": "http://router.keendata.net:5343/v1",
    "defaultModel": "gpt-5.5"
  }
}
```

### 凭证管理

API Key 支持三种方式提供，按优先级依次尝试：

1. **交互式输入（首次使用）** — 检测到未配置时提示输入，保存到 `~/.keendata-i18n-agent/credentials.json`（权限 0600），后续自动读取。
2. **环境变量（CI / 脚本）** — `LLM_API_KEY=sk-xxx`，优先级高于本地存储。
3. **`--reset-key`** — 清除已保存的凭证，下次运行重新提示输入。

非 TTY 环境自动跳过交互式输入，避免卡住。

## 依赖变更

- 新增 `openai`（SDK v7+，CJS 兼容，提供 tool-calling 支持）
- 现有 Babel 依赖不变
- 不引入构建步骤，不迁移 TypeScript

## 实现变更

### 1. 新建 `src/agent/` 模块

**`src/agent/tools.js`** — 定义 agent 可调用的工具集，每个工具是一个 `{ name, description, parameters, execute }` 对象，参数 schema 用 JSON Schema 描述。

工具分三类：

- **文件操作（新增能力）**
    - `read_file(relativePath)` — 读取目标项目文件内容，返回字符串
    - `write_file(relativePath, content)` — 写入/覆盖文件，返回成功状态
    - `list_files(directory, extension)` — 列出目录下文件，返回路径数组

- **Kit 工具（封装现有函数）**
    - `scaffold()` — 调用 `kit.scaffold`，返回创建/跳过文件数
    - `inject()` — 调用 `kit.inject`，返回注入结果
    - `doctor()` — 调用 `kit.inspectProjectSetup`，返回完整检查报告
    - `scan_chinese()` — 调用 `kit.scanHardcodedChinese`，返回候选列表（截断到前 50 条 + 总数）
    - `apply_i18n(dryRun)` — 调用 `kit.applyI18n`，返回改写文件数和替换数
    - `extract_entries()` — 执行 `config.extractCommand`，捕获 stdout/stderr 返回
    - `translate_entries(provider)` — 调用 `kit.translateTranslations`，返回翻译报告
    - `validate_translations()` — 调用 `kit.validateTranslations`，返回校验报告
    - `compile_languages()` — 执行 `config.compileCommand`，捕获 stdout/stderr 返回
    - `check_generated_files()` — 调用 `kit.inspectGeneratedFiles`，返回缺失文件列表

- **Shell**
    - `run_shell(command)` — 在目标项目目录执行任意命令，捕获 stdout/stderr 和退出码

所有工具的 `execute` 函数接收 `{ projectRoot, config }` 上下文（通过闭包绑定），返回 JSON 可序列化对象。大结果（如 scan 候选列表）做截断处理，避免超出 context window。

**`src/agent/prompt.js`** — 导出 `buildSystemPrompt(projectRoot, config)` 函数，生成 agent 的 system prompt。内容包含：

- 角色定义：你是 KeenData Vue2 项目的 i18n 自动化 agent，使用 voerkai18n 运行时
- 工作流程：scaffold → inject → doctor → scan → apply → extract → translate → validate → compile（但 agent 可自主调整顺序和重试）
- 错误恢复指令：工具返回错误时，阅读错误信息，理解问题，采取纠正措施（读文件、改文件、重试工具），不要直接停止
- 文件编辑指令：apply 工具基于 AST 自动改写，覆盖不到的中文文案可以用 read_file + write_file 手动包裹 `t()` 调用
- 成功标准：doctor 无 fail、scan 候选数为 0、validate 无缺失无问题、compile 成功、generated 文件齐全
- 约束：只修改项目内文件，不碰 node_modules/dist/.git；保持代码功能不变；翻译时保持 `{}` 占位符和 `${}` 系统变量不变
- 语言列表和 preset 信息从 config 注入

**`src/agent/loop.js`** — 导出 `runAgentLoop(client, systemPrompt, tools, maxSteps)` 函数。核心逻辑：

```js
const messages = [
  { role: "system", content: systemPrompt },
  { role: "user", content: "请开始执行国际化流程。" },
];
const timeline = [];

for (let step = 0; step < maxSteps; step += 1) {
  let response;
  try {
    response = await client.chat.completions.create({
      model, messages, tools: toolDefinitions, temperature: 0,
    });
  } catch (err) {
    return { ok: false, message: `LLM 调用失败: ${err.message}`, stepCount: step, timeline };
  }
  const message = response.choices[0].message;
  messages.push(message);

  if (!message.tool_calls || message.tool_calls.length === 0) {
    return { ok: true, message: message.content, stepCount: step + 1, timeline };
  }

  for (const toolCall of message.tool_calls) {
    const tool = tools.find(t => t.name === toolCall.function.name);
    const args = JSON.parse(toolCall.function.arguments);
    let result;
    try {
      result = await tool.execute(args);
    } catch (err) {
      result = { error: err.message };
    }
    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(result),
    });
    timeline.push({
      step: step + 1,
      action: toolCall.function.name,
      reason: JSON.stringify(args).slice(0, 200),
      result: JSON.stringify(result).slice(0, 500),
    });
  }
}
return { ok: false, message: "超过最大步数", stepCount: maxSteps, timeline };
```

- 使用 `openai` SDK 的 `chat.completions.create` 传 `tools` 参数，SDK 自动处理 tool call 格式
- `client` 由调用方创建并传入，指向公司模型路由
- LLM 调用包裹 try-catch，连接失败返回明确错误而非崩溃
- 初始 messages 包含 system + user message（公司路由要求至少一条 user message）
- 工具执行出错时不抛异常，返回 `{ error: "..." }` 让 agent 决定如何处理
- timeline 记录每步的 action、参数摘要、结果摘要

**`src/agent/index.js`** — 导出 `runAgent(projectRoot, agentConfig, flags)`，串联上述模块：
1. 通过 `resolveCredentials` 获取 API Key（环境变量 > 本地存储 > 交互式输入）
2. 创建 `openai` client（`new OpenAI({ baseURL, apiKey })`）
3. 加载项目 config
4. 构建工具集（闭包绑定 projectRoot + config）
5. 构建 system prompt
6. 调用 `runAgentLoop`
7. 返回与现有 `finalizeState` 格式兼容的结果对象

### 2. 新建 `src/credentials.js`

凭证管理模块：

- `loadCredentials()` — 读取 `~/.keendata-i18n-agent/credentials.json`
- `saveCredentials(credentials)` — 保存凭证，文件权限 0600
- `clearCredentials()` — 删除凭证文件
- `promptForCredentials(defaultBaseUrl, defaultModel)` — 交互式提示输入 API Key / 端点 / 模型
- `resolveCredentials(agentConfig)` — 按优先级解析凭证：环境变量 > 本地存储 > 交互式输入（非 TTY 跳过）

### 3. 改造 `src/runner.js`

- `runAgent` 函数改为调用 `require("./agent").runAgent`
- 保留 `--decision-mode rule` 分支：走旧的 `policy.js` + `executeAction` 逻辑
- LLM 模式下不再调用 `policy.js`，完全由 agent loop 驱动
- 结果对象格式保持兼容（`ok`、`message`、`stepCount`、`timeline`、`results`）

### 4. 改造 `src/config.js`

- `DEFAULT_AGENT_CONFIG.decisionMode` 默认值从 `"rule"` 改为 `"llm"`
- `DEFAULT_AGENT_CONFIG.maxSteps` 从 `20` 改为 `50`（tool-calling 需要更多步数）
- `DEFAULT_AGENT_CONFIG.llm` 字段更新：
    - `apiKeyEnv` 改为 `"LLM_API_KEY"`
    - `baseUrlEnv` 改为 `"LLM_BASE_URL"`
    - `modelEnv` 改为 `"LLM_MODEL"`
    - `defaultBaseUrl` 改为 `"http://router.keendata.net:5343/v1"`
    - `defaultModel` 改为 `"gpt-5.5"`
    - 删除 `provider: "openai-compatible"` 字段（SDK 本身就是通用的）

### 5. 改造 `src/llm.js` 和 `src/kit/translate.js`

- 删除旧的 `createLlmClient`（决策确认器）和 `buildDecisionPrompt`
- `src/llm.js` 重写为使用 `openai` SDK 创建客户端，保留给 translate.js 等 kit 内部使用
- translate.js 中的 `runLlmTranslate` 和 `callLlmTranslate` 从 raw `fetch` 改为 `openai` SDK，环境变量同步更新，保持接口不变

### 6. 新增 `src/kit/shell.js` 的捕获模式

- 新增 `runShellCommandCaptured(command, cwd, label, options)` 函数
- 与 `runShellCommand` 相同参数，但 `stdio` 改为 `pipe`，返回 `{ status, stdout, stderr }`
- `runShellCommand` 保持不变（独立 CLI 命令仍用 inherit 模式）
- agent 的 `extract_entries`、`compile_languages`、`run_shell` 工具使用捕获模式

### 7. 改造 `src/cli.js`

- `run` 命令默认 LLM 模式
- 新增 `--reset-key` 参数：清除保存的 LLM API Key，下次运行重新输入
- help 文本更新：`--decision-mode` 说明改为"rule = 旧规则引擎（回退），llm = LLM 驱动（默认）"
- 新增 `--max-tool-calls N` 参数（别名映射到 maxSteps）
- flag 解析修复：kebab-case 转 camelCase，数值型 flag 正确解析
- 独立 CLI 命令（scan、apply、translate 等）不受影响

## 测试计划

- **工具单元测试**（`test/agent-tools.test.js`）：创建临时项目，逐个验证工具的 execute 函数返回正确格式（read_file、write_file、scan_chinese、apply_i18n、validate_translations、check_generated_files）
- **Shell 捕获测试**（`test/shell-captured.test.js`）：验证 `runShellCommandCaptured` 正确捕获 stdout/stderr 和退出码
- **Agent loop 测试**（`test/agent-loop.test.js`）：注入 mock openai client（预设 tool_calls 响应序列），验证 loop 正确执行工具、传递结果、在无 tool_calls 时终止
- **凭证管理测试**（`test/credentials.test.js`）：验证凭证的保存、读取、清除、覆盖更新、损坏文件处理
- **现有测试不变**：scan、apply、translate、inject、scaffold 测试保持通过（kit 层未改动）
- **集成测试**（`test/agent-integration.test.js`）：创建临时 Vue2 项目（含硬编码中文），用 mock LLM 预设固定的 tool call 序列（scaffold → inject → scan → apply → validate → finish），验证最终项目文件被正确改写

## 假设与默认选择

- **框架选择**：使用 `openai` SDK + 薄 loop。SDK 是 HTTP 客户端协议库，通过 `baseURL` 指向公司模型路由。公司路由完整支持 `tools` 参数（function calling）。
- **默认模型**：`gpt-5.5`，通过公司模型路由 `http://router.keendata.net:5343/v1` 访问。
- **LLM 默认开启**：`run` 命令默认 LLM 模式，API key 缺失时交互式提示输入。`--decision-mode rule` 保留为回退。
- **单 Agent**：一个 agent 负责全流程，通过 tool-calling 自主编排。不拆分多 agent。
- **工具结果截断**：scan 候选列表截断到前 50 条 + 总数，validate 问题列表截断到前 30 条，避免 context 溢出。agent 可通过 `read_file` 获取完整内容。
- **translate.js 的 LLM 翻译**：改为使用 `openai` SDK，但保持 `runLlmTranslate` 的对外接口不变，现有 translate 测试继续通过。
- **现有 CLI 命令不受影响**：scan、apply、translate、validate 等独立命令保持原有行为，不依赖 LLM。
- **未来迁移路径**：如需多 agent 协作，tools 和 prompt 已解耦，迁移到 Mastra/LangGraph 只需替换调度层。
