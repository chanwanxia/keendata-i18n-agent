const fs = require("fs");
const path = require("path");
const kit = require("../kit");
const { runShellCommandCaptured } = require("../kit/shell");

/** scan 候选列表截断阈值，避免超出 context window */
const SCAN_CANDIDATE_LIMIT = 50;
/** validate 问题列表截断阈值 */
const VALIDATE_ISSUE_LIMIT = 30;
/** read_file 返回内容截断阈值，避免大文件挤占 agent 上下文 */
const READ_FILE_MAX_CHARS = 50000;

/**
 * 构建 agent 工具集，通过闭包绑定 projectRoot 和 config
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} config - i18n-kit 配置
 * @returns {object[]} 工具数组，每个工具含 { name, description, parameters, execute }
 */
function createTools(projectRoot, config) {
  return [
    {
      name: "read_file",
      description:
        "读取目标项目中指定相对路径的已存在业务文件内容。翻译资源和超大文件不会返回全文，应使用专用工具处理。",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "相对于项目根目录的文件路径，如 src/views/Home.vue",
          },
        },
        required: ["relativePath"],
      },
      execute(args) {
        const filePath = path.join(projectRoot, args.relativePath);
        if (!fs.existsSync(filePath)) {
          return { error: `文件不存在: ${args.relativePath}` };
        }
        if (isManagedTranslationResource(args.relativePath, config)) {
          return {
            relativePath: args.relativePath,
            skipped: true,
            reason:
              "翻译资源由 translate_entries / validate_translations 专用工具管理，不读取全文",
            content: "",
          };
        }
        const content = fs.readFileSync(filePath, "utf8");
        if (content.length > READ_FILE_MAX_CHARS) {
          return {
            relativePath: args.relativePath,
            content: content.slice(0, READ_FILE_MAX_CHARS),
            truncated: true,
            originalLength: content.length,
          };
        }
        return { relativePath: args.relativePath, content };
      },
    },
    {
      name: "write_file",
      description:
        "覆盖目标项目中指定相对路径的已存在业务文件；写入后自动执行完整 eslint --fix；不得用来创建 layout/header 备选接入文件。",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "相对于项目根目录的文件路径",
          },
          content: {
            type: "string",
            description: "要写入的完整文件内容",
          },
        },
        required: ["relativePath", "content"],
      },
      execute(args) {
        const filePath = path.join(projectRoot, args.relativePath);
        if (!fs.existsSync(filePath)) {
          const reason = isLayoutFallbackPath(args.relativePath)
            ? "layout-header 注入只处理固定模板路径，不匹配时应跳过"
            : "write_file 只允许覆盖已存在文件，新增文件应由 scaffold/apply/inject 等确定性工具生成";
          return { error: `禁止创建文件: ${args.relativePath}。${reason}。` };
        }
        // 还原 LLM 可能输出的 \uXXXX 转义序列为实际中文字符
        const content = kit.deescapeUnicode
          ? kit.deescapeUnicode(args.content)
          : args.content;
        fs.writeFileSync(filePath, content, "utf8");
        let lint = { ok: true, fixedCount: 0, errors: [], warnings: [] };
        try {
          lint = kit.runEslintFix
            ? kit.runEslintFix(projectRoot, [args.relativePath], { full: true })
            : lint;
        } catch (error) {
          lint = {
            ok: false,
            fixedCount: 0,
            errors: [
              `eslint 自动修复异常: ${
                error && error.message ? error.message : String(error)
              }`,
            ],
            warnings: [],
          };
        }
        const finalContent = fs.readFileSync(filePath, "utf8");
        return {
          relativePath: args.relativePath,
          written: true,
          bytes: finalContent.length,
          lint,
        };
      },
    },
    {
      name: "list_files",
      description: "列出目标项目指定目录下的文件（递归）。可按扩展名过滤。",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description: "相对于项目根目录的目录路径，如 src/views",
          },
          extension: {
            type: "string",
            description: "可选的扩展名过滤，如 .vue",
          },
        },
        required: ["directory"],
      },
      execute(args) {
        const dirPath = path.join(projectRoot, args.directory);
        if (!fs.existsSync(dirPath)) {
          return { error: `目录不存在: ${args.directory}` };
        }
        const files = [];
        collectFiles(dirPath, projectRoot, args.extension, files);
        return { directory: args.directory, fileCount: files.length, files };
      },
    },
    {
      name: "scaffold",
      description:
        "写入 i18n 基础设施文件（languages 目录、mixin、样式等）。返回创建和跳过的文件数。force=true 时覆盖已存在的文件（用于修复内容不完整的情况）。注意：default.json 包含提取的翻译数据，即使 force=true 也不会被覆盖。",
      parameters: {
        type: "object",
        properties: {
          force: {
            type: "boolean",
            description: "是否强制覆盖已存在文件，用于 doctor 检测到文件内容不完整时修复。默认 false。",
          },
        },
      },
      execute(args) {
        const profile = kit.detectProjectProfile(projectRoot);
        const report = kit.scaffold(projectRoot, profile, config, {
          force: Boolean(args.force),
        });
        const cleanupReport = kit.cleanupI18n(projectRoot, config);
        return {
          ok: true,
          summary: report.summary,
          cleanupSummary: cleanupReport.summary,
          created: report.created,
        };
      },
    },
    {
      name: "inject",
      description:
        "向 main.js / vue.config.js / App.vue / interceptors 注入 i18n 代码；layout-header 只处理固定模板路径，不匹配则跳过。注入后自动执行 eslint --fix 修复格式。返回各文件注入状态。重复执行是幂等的：已注入的代码不会被重复注入。force=true 时强制重新注入（用于修复内容不完整的情况）。",
      parameters: {
        type: "object",
        properties: {
          force: {
            type: "boolean",
            description: "是否强制重新注入，用于 doctor 检测到问题时覆盖修复。默认 false。",
          },
        },
      },
      execute(args) {
        const profile = kit.detectProjectProfile(projectRoot);
        const report = kit.inject(projectRoot, profile, config, {
          force: Boolean(args.force),
        });
        const installResult = report.details.kdComponentsInstall || {};
        return {
          ok: report.ok,
          message: report.ok ? undefined : installResult.message || "依赖注入失败",
          details: report.details,
        };
      },
    },
    {
      name: "doctor",
      description:
        "按 preset 检查项目 i18n 基建完整性。返回所有检查项的 pass/warn/fail 状态。",
      parameters: { type: "object", properties: {} },
      execute() {
        const profile = kit.detectProjectProfile(projectRoot);
        const report = kit.inspectProjectSetup(projectRoot, profile, config);
        return report;
      },
    },
    {
      name: "scan_chinese",
      description:
        "扫描项目源码中未被 t() 包裹的硬编码中文。返回候选列表（截断到前 50 条）和总数。",
      parameters: { type: "object", properties: {} },
      execute() {
        const report = kit.scanHardcodedChinese(projectRoot, config);
        return {
          summary: report.summary,
          candidates: report.candidates.slice(0, SCAN_CANDIDATE_LIMIT),
          truncated: report.candidates.length > SCAN_CANDIDATE_LIMIT,
          totalCandidates: report.candidates.length,
        };
      },
    },
    {
      name: "apply_i18n",
      description:
        "对目标项目执行 i18n 自动改写：中文文案包裹为 t()、.meta.title 包裹、el-form label-width 转为 auto、isRtl 内联样式转换、src/components/svg-icon/index.vue 已有 computed.margin 的 RTL 适配。正式执行前自动清理历史遗留问题（嵌套 t()、重复 import、beforeRouteEnter/props 中的 this.t 误用）。即使 scan 结果为 0 也必须执行（label-width、isRtl 和 SVG 图标 margin 转换不依赖中文扫描）。基于 AST 定点修改，按原有缩进生成并保持幂等。写入后自动执行 eslint --fix。dryRun=true 时仅预览不清理。",
      parameters: {
        type: "object",
        properties: {
          dryRun: {
            type: "boolean",
            description: "是否仅预览不写入文件，默认 false",
          },
        },
      },
      execute(args) {
        const report = kit.applyI18n(projectRoot, config, {
          dryRun: Boolean(args.dryRun),
        });
        return {
          ok: report.ok,
          summary: report.summary,
          changedFiles: report.changedFiles.slice(0, 20),
          totalChangedFiles: report.changedFiles.length,
        };
      },
    },
    {
      name: "extract_entries",
      description:
        "执行词条提取命令（voerkai18n extract）。捕获 stdout 和 stderr 返回。",
      parameters: { type: "object", properties: {} },
      execute() {
        const prettierFix = kit.repairPrettierConfig(projectRoot);
        const result = runShellCommandCaptured(
          config.extractCommand,
          projectRoot,
          "agent 执行词条提取",
        );
        return {
          ok: result.status === 0,
          command: config.extractCommand,
          stdout: result.stdout.slice(0, 2000),
          stderr: result.stderr.slice(0, 2000),
          prettierConfigFixed: prettierFix.updated,
        };
      },
    },
    {
      name: "translate_entries",
      description:
        "使用 LLM 自动补齐翻译源文件中缺失或无效的翻译（增量模式，不破坏已有有效翻译）。agent 流程固定使用 llm provider，不切换 baidu/command/glossary，也不允许 force 清空重翻。自动检测空翻译和占位式无效翻译（如 Text 1），只重新翻译这些条目。provider.ok=true 但返回 ok=false 时表示仍有缺失或质量问题，必须继续调用 validate_translations 并按报告增量重试。",
      parameters: { type: "object", properties: {} },
      async execute() {
        const report = await kit.translateTranslations(projectRoot, config, {
          provider: "llm",
          force: false,
        });
        return {
          ok: report.ok,
          summary: report.summary,
          provider: report.provider,
          filledItems: (report.filledItems || []).slice(0, 20),
          issues: (report.issues || []).slice(0, VALIDATE_ISSUE_LIMIT),
        };
      },
    },
    {
      name: "validate_translations",
      description:
        "校验翻译源文件的完整性（缺失翻译）和正确性（占位符、字面量、源文残留、占位式无效翻译）。返回问题列表（截断到前 30 条）。",
      parameters: { type: "object", properties: {} },
      execute() {
        const report = kit.validateTranslations(projectRoot, config);
        return {
          ok: report.ok,
          summary: report.summary,
          missingLanguages: (report.missingLanguages || []).slice(
            0,
            VALIDATE_ISSUE_LIMIT,
          ),
          issues: (report.issues || []).slice(0, VALIDATE_ISSUE_LIMIT),
          totalIssues: (report.issues || []).length,
        };
      },
    },
    {
    name: "compile_languages",
      description:
        "执行语言包编译命令（voerkai18n compile）。捕获 stdout 和 stderr 返回。",
      parameters: { type: "object", properties: {} },
      execute() {
        const prettierFix = kit.repairPrettierConfig(projectRoot);
        const result = runShellCommandCaptured(
          config.compileCommand,
          projectRoot,
          "agent 执行语言包编译",
        );
        if (result.status === 0) {
          // compile 后统一修复：idMap.js 引号修复 + .prettierignore + eslint --fix
          const fixResult = kit.postCompileFix(projectRoot, config);
          return {
            ok: true,
            command: config.compileCommand,
            stdout: result.stdout.slice(0, 2000),
            stderr: result.stderr.slice(0, 2000),
            idMapFixed: fixResult.idMapFixed,
            eslintFixedCount: fixResult.eslintFixedCount,
            prettierConfigFixed: prettierFix.updated,
          };
        }
        return {
          ok: result.status === 0,
          command: config.compileCommand,
          stdout: result.stdout.slice(0, 2000),
          stderr: result.stderr.slice(0, 2000),
          prettierConfigFixed: prettierFix.updated,
        };
      },
    },
    {
      name: "check_generated_files",
      description: "检查运行时语言包产物是否存在。返回缺失文件列表。",
      parameters: { type: "object", properties: {} },
      execute() {
        const report = kit.inspectGeneratedFiles(projectRoot, config);
        return report;
      },
    },
  ];
}

/**
 * 判断 write_file 是否正在创建 layout/header 备选接入路径。
 * @param {string} relativePath - 相对项目根目录的文件路径
 * @returns {boolean} 是否属于 layout/header 备选路径
 */
function isLayoutFallbackPath(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  return (
    /^src\/layouts?\//.test(normalized) ||
    /^src\/layout-header\//.test(normalized)
  );
}

/**
 * 判断路径是否属于由翻译工具管理的资源文件。
 * @param {string} relativePath - 相对项目根目录的文件路径
 * @param {object} config - i18n-kit 配置
 * @returns {boolean} 是否为翻译资源
 */
function isManagedTranslationResource(relativePath, config) {
  const normalized = normalizeToolPath(relativePath);
  const translationFile = normalizeToolPath(config && config.translationFile);
  return (
    normalized === translationFile ||
    /^src\/languages\/translates\/[^/]+\.json$/.test(normalized)
  );
}

/**
 * 归一化工具入参路径，统一使用 POSIX 分隔符。
 * @param {string} relativePath - 相对项目根目录的文件路径
 * @returns {string} 归一化后的路径
 */
function normalizeToolPath(relativePath) {
  return String(relativePath || "").replace(/\\/g, "/");
}

/**
 * 递归收集目录下的文件
 * @param {string} currentPath - 当前路径
 * @param {string} projectRoot - 项目根路径
 * @param {string} extension - 可选扩展名过滤
 * @param {string[]} files - 累积的文件数组（相对路径）
 */
function collectFiles(currentPath, projectRoot, extension, files) {
  const stats = fs.statSync(currentPath);

  if (stats.isDirectory()) {
    const dirName = path.basename(currentPath);
    if (["node_modules", "dist", ".git", ".idea"].includes(dirName)) return;
    fs.readdirSync(currentPath).forEach((name) => {
      collectFiles(path.join(currentPath, name), projectRoot, extension, files);
    });
    return;
  }
  if (extension && path.extname(currentPath) !== extension) return;
  const relative = path
    .relative(projectRoot, currentPath)
    .split(path.sep)
    .join("/");
  files.push(relative);
}

/**
 * 从工具数组提取 OpenAI tool 定义（不含 execute 函数）
 * @param {object[]} tools - 工具数组
 * @returns {object[]} OpenAI 格式的 tool 定义
 */
function toToolDefinitions(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

module.exports = {
  createTools,
  toToolDefinitions,
};
