const { loadAgentConfig, resolveProjectRoot } = require("./config");
const { runAgent } = require("./runner");
const kit = require("./kit");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * CLI 入口函数
 * @param {string[]} argv - 命令行参数
 */
async function main(argv) {
  const { command, flags } = parseArgs(argv);
  if (isVersionCommand(command)) {
    printVersion();
    return;
  }
  if (isHelpCommand(command)) {
    printHelp();
    return;
  }

  if (command === "audit") {
    process.exit(await auditCommand(flags));
  }

  const kitCommands = [
    "init",
    "profile",
    "doctor",
    "rules",
    "preset",
    "scan",
    "apply",
    "translate",
    "validate",
    "extract",
    "compile",
    "scaffold",
    "inject",
  ];
  if (kitCommands.includes(command)) {
    kit.main(argv);
    return;
  }

  if (command === "update") {
    await updateCommand(flags);
    return;
  }

  if (command !== "run") {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const projectRoot = resolveProjectRoot(flags.project);
  const agentConfig = loadAgentConfig(projectRoot, flags);

  if (flags.resetKey) {
    const { clearCredentials } = require("./credentials");
    clearCredentials();
    console.log("[i18n-agent] 已清除保存的 API Key，下次运行将重新提示输入。");
  }

  const result = await runAgent(projectRoot, agentConfig, flags);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printResult(result);
  }

  process.exitCode = result.ok ? 0 : 1;
}

/**
 * 解析命令行参数
 * @param {string[]} argv - 命令行参数
 * @returns {object} { command, flags }
 */
function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const flags = {};
  const valueFlags = [
    "--project",
    "--provider",
    "--appid-env",
    "--appkey-env",
    "--decision-mode",
    "--max-steps",
    "--max-tool-calls",
  ];

  /** 将 --kebab-case 转为 camelCase */
  const toCamel = (s) =>
    s.replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  /** 需要解析为数字的 flag */
  const numericFlags = new Set(["--max-steps", "--max-tool-calls"]);

  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];

    if (item === "--json") flags.json = true;
    if (item === "--no-auto-init-config") flags.autoInitConfig = false;
    if (item === "--no-auto-create-translation-file")
      flags.autoCreateTranslationFile = false;
    if (item === "--no-auto-scaffold") flags.autoScaffold = false;
    if (item === "--no-auto-inject") flags.autoInject = false;
    if (item === "--no-resume") flags.resume = false;
    if (item === "--reset-key") flags.resetKey = true;
    if (item === "--force") flags.force = true;
    if (item === "--check") flags.check = true;

    if (valueFlags.includes(item)) {
      const key = toCamel(item);
      const value = rest[i + 1];
      flags[key] = numericFlags.has(item) ? Number(value) : value;
      i += 1;
    }
  }

  return { command, flags };
}

/**
 * 执行审计命令
 * @param {object} flags - 命令行标志
 * @returns {number} 退出码
 */
async function auditCommand(flags) {
  const projectRoot = resolveProjectRoot(flags.project);
  const profile = kit.detectProjectProfile(projectRoot);
  const config = kit.loadProjectConfig(projectRoot);

  const report = {
    projectRoot,
    scan: kit.scanHardcodedChinese(projectRoot, config),
    doctor: kit.inspectProjectSetup(projectRoot, profile, config),
    validate: kit.validateTranslations(projectRoot, config),
    generated: kit.inspectGeneratedFiles(projectRoot, config),
  };

  report.ok =
    report.scan.summary.candidateCount === 0 &&
    report.doctor.ok &&
    report.validate.ok &&
    report.generated.ok;

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`[i18n-agent] 审计报告: ${projectRoot}`);
    console.log(
      `[i18n-agent] 未编译中文[scan] : ${report.scan.summary.candidateCount} 处`,
    );
    console.log(
      `[i18n-agent] 基建检查[doctor]: ${report.doctor.summary.passCount} 通过, ${report.doctor.summary.warnCount} 警告, ${report.doctor.summary.failCount} 失败`,
    );
    console.log(
      `[i18n-agent] 翻译检查[validate]: ${report.validate.summary.missingLanguageCount} 语言缺失, ${report.validate.summary.issueCount} 翻译问题`,
    );
    console.log(`[i18n-agent] 产物完整: ${report.generated.ok ? "是" : "否"}`);
    console.log(`[i18n-agent] 总体: ${report.ok ? "合规" : "不合规"}`);
  }

  return report.ok ? 0 : 1;
}

/**
 * 打印执行结果
 * @param {object} result - 执行结果
 */
function printResult(result) {
  console.log(`[i18n-agent] 目标项目: ${result.projectRoot}`);
  console.log(`[i18n-agent] 步骤数: ${result.stepCount}`);
  console.log(`[i18n-agent] 结果: ${result.ok ? "成功" : "失败"}`);
  console.log(`[i18n-agent] 说明: ${result.message}`);
}

/**
 * 打印帮助信息
 */
function printHelp() {
  console.log(`
@kd/i18n

用法:
  kd-i18n run [flags]
  kd-i18n audit [flags]
  kd-i18n -v
  kd-i18n update [--check]

命令:
  run        执行 i18n agent 全流程（cleanup → scaffold → inject → doctor → scan → apply → extract → translate → validate → compile）
  audit      审计项目国际化合规性
  scaffold   写入 i18n 基础设施文件（languages 目录、mixin、样式等）
  inject     向 main.js / vue.config.js / App.vue / interceptors 注入 i18n 代码
  scan       扫描疑似未国际化中文
  apply      自动改写可安全处理的文案（--dry-run 预览不写入）
  doctor     按 preset 检查 i18n 基建
  translate  自动补齐 default.json 中缺失的翻译
  validate   校验翻译完整性与正确性
  extract    执行词条提取命令
  compile    执行语言包编译命令
  profile    探测目标项目的 i18n 接入画像
  init       输出或写入配置模板（--write-config 写入）
  -v         查看当前安装版本
  update     检查并更新到 npm 上的最新版本（--check 仅检查不更新）

常用参数:
  --project PATH                        指定目标项目路径（默认当前目录）
  --json                                输出 JSON，便于 CI 或外层 agent 解析
  --dry-run                             apply 模式仅预览不写入文件
  --provider NAME                       翻译 provider，可选 llm / glossary / baidu / command
  --appid-env ENV                       百度翻译 appid 的环境变量名
  --appkey-env ENV                      百度翻译 appkey 的环境变量名
  --decision-mode MODE                  决策模式，可选 llm（默认，LLM 驱动）/ rule（旧规则引擎回退）
  --max-steps N                         最大决策步数（0=自动模式，不限步数直到完成，默认）
  --no-resume                           不从 checkpoint 恢复，从头开始执行（自动清除旧 checkpoint）
  --max-tool-calls N                    最大工具调用次数（--max-steps 的别名）
  --force                               强制清空所有翻译重新翻译（用于修复占位式无效翻译）
  --reset-key                           清除保存的 LLM API Key，下次运行重新输入
  --no-auto-init-config                 禁止自动写入 i18n-kit.config.json
  --no-auto-create-translation-file     禁止自动创建翻译源文件
  --no-auto-scaffold                    禁止自动 scaffold 基础设施文件
  --no-auto-inject                      禁止自动注入 main.js / vue.config.js / App.vue

示例:
  kd-i18n run
  kd-i18n run --no-resume
  LLM_API_KEY=xxx kd-i18n run
  kd-i18n audit
  kd-i18n audit --json
  kd-i18n update
`);
}

/**
 * 判断是否为帮助命令
 * @param {string} command - 命令名称
 * @returns {boolean} 是否为帮助命令
 */
function isHelpCommand(command) {
  return ["help", "--help", "-h"].includes(command);
}

/**
 * 判断是否为版本查看命令
 * @param {string} command - 命令名称
 * @returns {boolean} 是否为版本查看命令
 */
function isVersionCommand(command) {
  return ["-v", "--version", "-V"].includes(command);
}

/**
 * 读取当前安装的包版本号
 * @returns {string} 版本号
 */
function getPackageVersion() {
  const pkgPath = path.join(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.version;
}

/**
 * 打印当前版本信息
 */
function printVersion() {
  const version = getPackageVersion();
  console.log(`@kd/i18n v${version}`);
}

/**
 * 从 npm registry 查询最新发布版本
 * @returns {string|null} 最新版本号，查询失败返回 null
 */
function getLatestVersion() {
  try {
    const output = execSync("npm view @kd/i18n version", {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

/**
 * 比较两个语义化版本号
 * @param {string} current - 当前版本
 * @param {string} latest - 最新版本
 * @returns {boolean} latest 是否大于 current
 */
function isNewerVersion(current, latest) {
  const parse = (v) => v.split(".").map(Number);
  const [a1, a2, a3] = parse(current);
  const [b1, b2, b3] = parse(latest);
  if (b1 !== a1) return b1 > a1;
  if (b2 !== a2) return b2 > a2;
  return b3 > a3;
}

/**
 * 检测当前全局安装使用的包管理器
 * @returns {string} 包管理器命令（npm / pnpm / yarn）
 */
function detectPackageManager() {
  const execPath = process.env.npm_execpath || "";
  if (execPath.includes("pnpm")) {
    return "pnpm";
  }
  if (execPath.includes("yarn")) {
    return "yarn";
  }
  return "npm";
}

/**
 * 执行更新命令：检查 npm registry 是否有新版本，若有则全局安装最新版
 * @param {object} flags - 命令行标志
 */
async function updateCommand(flags) {
  const current = getPackageVersion();
  console.log(`[i18n-agent] 当前版本: ${current}`);

  if (flags.check) {
    const latest = getLatestVersion();
    if (!latest) {
      console.log("[i18n-agent] 无法查询最新版本，请检查网络连接后重试。");
      process.exitCode = 1;
      return;
    }
    if (isNewerVersion(current, latest)) {
      console.log(`[i18n-agent] 发现新版本: ${latest}（当前 ${current}）`);
      console.log("[i18n-agent] 运行 kd-i18n update 进行更新。");
    } else {
      console.log(`[i18n-agent] 已是最新版本: ${current}`);
    }
    return;
  }

  const latest = getLatestVersion();
  if (!latest) {
    console.log("[i18n-agent] 无法查询最新版本，请检查网络连接后重试。");
    process.exitCode = 1;
    return;
  }

  if (!isNewerVersion(current, latest)) {
    console.log(`[i18n-agent] 已是最新版本: ${current}`);
    return;
  }

  console.log(`[i18n-agent] 发现新版本: ${latest}（当前 ${current}）`);
  const pm = detectPackageManager();
  const installCmd =
    pm === "pnpm"
      ? "pnpm add -g @kd/i18n@latest"
      : pm === "yarn"
        ? "yarn global add @kd/i18n@latest"
        : "npm install -g @kd/i18n@latest";

  console.log(`[i18n-agent] 正在通过 ${pm} 更新...`);
  try {
    execSync(installCmd, { stdio: "inherit" });
    console.log(`[i18n-agent] 更新完成: ${current} → ${latest}`);
  } catch {
    console.log("[i18n-agent] 更新失败，请手动执行以下命令：");
    console.log(`  ${installCmd}`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
};
