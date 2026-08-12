const { OpenAI } = require("openai");
const fs = require("fs");
const path = require("path");
const kit = require("../kit");
const { createTools } = require("./tools");
const { buildSystemPrompt } = require("./prompt");
const { runAgentLoop } = require("./loop");
const { resolveCredentials } = require("../credentials");

/** 大项目步数上限，防止无限循环 */
const MAX_STEPS_CAP = 200;
/** 动态步数的文件计数缩放因子（每 N 个文件加 1 步） */
const FILE_SCALE_FACTOR = 20;

/**
 * 统计项目 src 目录下的源码文件数量（.js/.vue/.ts/.jsx/.tsx）
 * @param {string} projectRoot - 项目根路径
 * @returns {number} 源码文件数量
 */
function countSourceFiles(projectRoot) {
  const srcDir = path.join(projectRoot, "src");
  if (!fs.existsSync(srcDir)) return 0;

  const validExts = [".js", ".vue", ".ts", ".jsx", ".tsx"];
  const skipDirs = ["node_modules", "dist", ".git", "languages"];
  let count = 0;

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skipDirs.includes(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (validExts.includes(path.extname(entry.name))) {
        count += 1;
      }
    }
  }

  walk(srcDir);
  return count;
}

/**
 * 根据项目源码文件数量动态计算最大步数
 * 基础步数 30 + 每 20 个文件 1 步，取配置值与计算值的较大者，上限 200
 * @param {number|undefined} configuredMax - 用户配置的最大步数
 * @param {string} projectRoot - 项目根路径
 * @returns {number} 最大步数
 */
function resolveMaxSteps(configuredMax, projectRoot) {
  const configured = configuredMax || 50;
  const fileCount = countSourceFiles(projectRoot);
  const scaled = 30 + Math.ceil(fileCount / FILE_SCALE_FACTOR);
  return Math.min(Math.max(configured, scaled), MAX_STEPS_CAP);
}

/**
 * 执行 LLM 驱动的 agent 全流程
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} agentConfig - agent 配置（含 llm 字段和 maxSteps）
 * @param {object} flags - 命令行标志
 * @returns {object} 执行结果 { ok, message, projectRoot, stepCount, timeline, results }
 */
async function runAgent(projectRoot, agentConfig, flags = {}) {
  const credentials = await resolveCredentials(agentConfig);
  if (!credentials) {
    return {
      ok: false,
      message:
        "缺少 LLM API Key。可通过以下方式提供：\n" +
        "  1. 环境变量 LLM_API_KEY=sk-xxx\n" +
        "  2. 运行时交互式输入（首次会提示，自动保存到 ~/.keendata-i18n-agent/credentials.json）\n" +
        "  3. 使用 --decision-mode rule 走规则模式（不需要 LLM）",
      projectRoot,
      stepCount: 0,
      timeline: [],
      results: {},
    };
  }

  const client = new OpenAI({
    baseURL: credentials.baseUrl,
    apiKey: credentials.apiKey,
  });
  const model = credentials.model;

  // 将凭证同步到 process.env，使子进程（如 voerkai18n extract/translate）也能读取
  process.env["LLM_API_KEY"] = credentials.apiKey;
  process.env["LLM_BASE_URL"] = credentials.baseUrl;
  process.env["LLM_MODEL"] = credentials.model;

  const config = kit.loadProjectConfig(projectRoot);
  const tools = createTools(projectRoot, config);
  const systemPrompt = buildSystemPrompt(projectRoot, config);

  // 根据项目源码文件数量动态调整最大步数，避免大项目步数不足
  const maxSteps = resolveMaxSteps(agentConfig.maxSteps, projectRoot);

  const result = await runAgentLoop(client, model, systemPrompt, tools, maxSteps);

  return {
    ok: result.ok,
    message: result.message,
    projectRoot,
    stepCount: result.stepCount,
    timeline: result.timeline,
    bootstrap: {
      configReady: true,
      translationFileReady: true,
    },
    repairs: {},
    results: {},
  };
}

module.exports = {
  runAgent,
};
