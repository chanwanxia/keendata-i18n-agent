const fs = require("fs");
const path = require("path");
const kit = require("../kit");
const { runShellCommandCaptured } = require("../kit/shell");

/** scan 候选列表截断阈值，避免超出 context window */
const SCAN_CANDIDATE_LIMIT = 50;
/** validate 问题列表截断阈值 */
const VALIDATE_ISSUE_LIMIT = 30;

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
      description: "读取目标项目中指定相对路径的文件内容。返回文件全文字符串。",
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
        const content = fs.readFileSync(filePath, "utf8");
        return { relativePath: args.relativePath, content };
      },
    },
    {
      name: "write_file",
      description:
        "写入或覆盖目标项目中指定相对路径的文件。如果目录不存在会自动创建。",
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
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, args.content, "utf8");
        return {
          relativePath: args.relativePath,
          written: true,
          bytes: args.content.length,
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
        "写入 i18n 基础设施文件（languages 目录、mixin、样式等）。返回创建和跳过的文件数。force=true 时覆盖已存在的文件（用于修复内容不完整的情况）。",
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
       const report = kit.scaffold(projectRoot, profile, config, { force: Boolean(args.force) });
        return {
          ok: true,
          summary: report.summary,
          created: report.created,
        };
      },
    },
  {
    name: "inject",
    description:
        "向 main.js / vue.config.js / App.vue / interceptors / layout-header 注入 i18n 代码。注入后自动执行 eslint --fix 修复格式。返回各文件注入状态。重复执行是幂等的：已注入的代码不会被重复注入。force=true 时强制重新注入（用于修复内容不完整的情况）。",
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
       const report = kit.inject(projectRoot, profile, config, { force: Boolean(args.force) });
        return {
          ok: true,
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
        "对目标项目执行 i18n 自动改写：中文文案包裹为 t()、.meta.title 包裹、el-form label-width 转为 auto、isRtl 内联样式转换。即使 scan 结果为 0 也必须执行（label-width 和 isRtl 转换不依赖中文扫描）。基于 AST 操作，安全可靠。写入后自动执行 eslint --fix。dryRun=true 时仅预览。幂等：重复执行不产生重复包裹或转换。",
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
     name: "cleanup_i18n",
     description:
       "清理已国际化代码中的常见问题：展开嵌套 t(t(...)) 为单层、移除重复 import、修复格式。用于重复 run 时的自动修复。",
     parameters: { type: "object", properties: {} },
     execute() {
       const report = kit.cleanupI18n(projectRoot, config);
       return {
         ok: report.ok,
         summary: report.summary,
         cleanedFiles: report.cleanedFiles.slice(0, 20),
       };
     },
   },
    {
    name: "extract_entries",
      description:
        "执行词条提取命令（voerkai18n extract）。捕获 stdout 和 stderr 返回。",
      parameters: { type: "object", properties: {} },
      execute() {
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
        };
      },
    },
    {
    name: "translate_entries",
      description:
        "自动补齐翻译源文件中缺失或无效的翻译（增量模式，不破坏已有有效翻译）。provider 可选 glossary/llm/baidu/command。自动检测空翻译和占位式无效翻译（如 Text 1），只重新翻译这些条目。force=true 会清空所有翻译重新翻译，代价极大，极慎用。",
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            description:
              "翻译 provider：glossary（术语表）、llm（大模型翻译）、baidu（百度翻译）、command（自定义命令）",
          },
          force: {
            type: "boolean",
            description:
              "是否强制清空所有翻译重新翻译。代价极大（所有词条 × 所有语言），仅在增量翻译多次失败后使用。默认 false。",
          },
        },
      },
      async execute(args) {
        const report = await kit.translateTranslations(projectRoot, config, {
          provider: args.provider,
          force: Boolean(args.force),
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
        const result = runShellCommandCaptured(
          config.compileCommand,
          projectRoot,
          "agent 执行语言包编译",
        );
        // compile 后自动修复 idMap.js 中未加引号的中文 key
        if (result.status === 0) {
          const fixResult = kit.fixIdMapKeys(projectRoot);
          return {
            ok: true,
            command: config.compileCommand,
            stdout: result.stdout.slice(0, 2000),
            stderr: result.stderr.slice(0, 2000),
            idMapFixed: fixResult.fixed,
          };
        }
        return {
          ok: result.status === 0,
          command: config.compileCommand,
          stdout: result.stdout.slice(0, 2000),
          stderr: result.stderr.slice(0, 2000),
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
    {
      name: "run_shell",
      description:
        "在目标项目目录执行任意 shell 命令。捕获 stdout 和 stderr。用于运行项目脚本或检查文件。",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "要执行的 shell 命令",
          },
        },
        required: ["command"],
      },
      execute(args) {
        const result = runShellCommandCaptured(
          args.command,
          projectRoot,
          "agent shell",
        );
        return {
          ok: result.status === 0,
          stdout: result.stdout.slice(0, 2000),
          stderr: result.stderr.slice(0, 2000),
        };
      },
    },
  ];
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
