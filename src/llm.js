/**
 * LLM 客户端工厂模块
 * 旧的决策确认器已废弃，agent 决策由 src/agent/ 模块接管。
 * 本模块保留为 translate.js 等 kit 内部模块提供 LLM 客户端创建能力。
 */

const { OpenAI } = require("openai");

/** LLM SDK 自动重试默认次数，低于 openai SDK 默认值以减少 429 放大 */
const DEFAULT_LLM_MAX_RETRIES = 1;

/**
 * 解析非负整数配置，非法值回退到默认值。
 * @param {string|number|undefined} value - 待解析的配置值
 * @param {number} fallback - 默认值
 * @returns {number} 非负整数配置
 */
function parseNonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

/**
 * 解析 LLM SDK 自动重试次数，支持 LLM_MAX_RETRIES 或 llm.maxRetries 覆盖。
 * @param {object} llmConfig - LLM 配置
 * @returns {number} SDK 自动重试次数
 */
function resolveLlmMaxRetries(llmConfig = {}) {
  const maxRetriesEnv = llmConfig.maxRetriesEnv || "LLM_MAX_RETRIES";
  return parseNonNegativeInteger(
    process.env[maxRetriesEnv] ?? llmConfig.maxRetries,
    DEFAULT_LLM_MAX_RETRIES,
  );
}

/**
 * 创建 OpenAI 兼容的 LLM 客户端（指向公司模型路由）
 * @param {object} agentConfig - agent 配置，含 llm 字段
 * @returns {object|null} LLM 客户端或 null（未配置 API Key 时）
 */
function createLlmClient(agentConfig) {
  const llmConfig = agentConfig.llm || {};
  const apiKeyEnv = llmConfig.apiKeyEnv || "LLM_API_KEY";
  const baseUrlEnv = llmConfig.baseUrlEnv || "LLM_BASE_URL";
  const modelEnv = llmConfig.modelEnv || "LLM_MODEL";

  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) return null;

  const baseURL =
    process.env[baseUrlEnv] || llmConfig.defaultBaseUrl || "http://router.keendata.net:5343/v1";
  const model =
    process.env[modelEnv] || llmConfig.defaultModel || "gpt-5.5";

  const client = new OpenAI({
    baseURL,
    apiKey,
    maxRetries: resolveLlmMaxRetries(llmConfig),
  });

  return {
    client,
    model,
    /**
     * 调用 chat completions 接口
     * @param {object} options - { messages, tools, temperature, responseFormat }
     * @returns {object} API 响应
     */
    async chat(options) {
      return client.chat.completions.create({
        model,
        temperature: options.temperature ?? 0,
        messages: options.messages,
        ...(options.tools ? { tools: options.tools } : {}),
        ...(options.responseFormat
          ? { response_format: options.responseFormat }
          : {}),
      });
    },
  };
}

module.exports = {
  createLlmClient,
  resolveLlmMaxRetries,
};
