const fs = require("fs");
const path = require("path");

const AGENT_CONFIG_FILE = "i18n-agent.config.json";

const DEFAULT_AGENT_CONFIG = {
  decisionMode: "rule",
  maxSteps: 20,
  autoInitConfig: true,
  autoCreateTranslationFile: true,
  autoScaffold: true,
  autoInject: true,
  llm: {
    provider: "openai-compatible",
    apiKeyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-4.1-mini",
  },
};

/**
 * 解析目标项目根路径，默认使用当前工作目录
 * @param {string} projectArg - 项目路径参数
 * @returns {string} 项目根路径
 */
function resolveProjectRoot(projectArg) {
  const projectRoot = projectArg ? path.resolve(projectArg) : process.cwd();
  const packagePath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    throw new Error(`目标项目不存在 package.json: ${projectRoot}`);
  }

  return projectRoot;
}

/**
 * 加载 agent 配置，合并文件配置和命令行标志
 * @param {string} projectRoot - 项目根路径
 * @param {object} flags - 命令行标志
 * @returns {object} 合并后的配置
 */
function loadAgentConfig(projectRoot, flags = {}) {
  const configPath = path.join(projectRoot, AGENT_CONFIG_FILE);
  const fileConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
  const merged = {
    ...DEFAULT_AGENT_CONFIG,
    ...fileConfig,
    llm: {
      ...DEFAULT_AGENT_CONFIG.llm,
      ...(fileConfig.llm || {}),
    },
  };

  if (flags.decisionMode) merged.decisionMode = flags.decisionMode;
  if (typeof flags.maxSteps === "number") merged.maxSteps = flags.maxSteps;
  if (typeof flags.autoInitConfig === "boolean") merged.autoInitConfig = flags.autoInitConfig;
  if (typeof flags.autoCreateTranslationFile === "boolean") merged.autoCreateTranslationFile = flags.autoCreateTranslationFile;
  if (typeof flags.autoScaffold === "boolean") merged.autoScaffold = flags.autoScaffold;
  if (typeof flags.autoInject === "boolean") merged.autoInject = flags.autoInject;

  return merged;
}

module.exports = {
  AGENT_CONFIG_FILE,
  DEFAULT_AGENT_CONFIG,
  loadAgentConfig,
  resolveProjectRoot,
};
