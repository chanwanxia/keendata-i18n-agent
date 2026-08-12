const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

/**
 * 获取凭证存储目录路径（延迟计算，支持 HOME 环境变量变更）
 * @returns {string} 凭证目录路径
 */
function getCredentialsDir() {
  return path.join(os.homedir(), ".keendata-i18n-agent");
}

/**
 * 获取凭证文件路径（延迟计算）
 * @returns {string} 凭证文件路径
 */
function getCredentialsFile() {
  return path.join(getCredentialsDir(), "credentials.json");
}

/**
 * 读取本地存储的凭证
 * @returns {object|null} 凭证对象 { apiKey, baseUrl, model } 或 null
 */
function loadCredentials() {
  const filePath = getCredentialsFile();
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 保存凭证到本地文件
 * @param {object} credentials - { apiKey, baseUrl, model }
 */
function saveCredentials(credentials) {
  const dir = getCredentialsDir();
  const filePath = getCredentialsFile();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(credentials, null, 2) + "\n",
    "utf8",
  );
  fs.chmodSync(filePath, 0o600);
}

/**
 * 清除本地存储的凭证
 */
function clearCredentials() {
  const filePath = getCredentialsFile();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * 通过交互式终端提示用户输入 API Key
 * @param {string} defaultBaseUrl - 默认 API 端点
 * @param {string} defaultModel - 默认模型名
 * @returns {Promise<object|null>} 凭证对象或 null（用户取消）
 */
function promptForCredentials(defaultBaseUrl, defaultModel) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("\n[keendata-i18n-agent] 首次使用，需要配置 LLM API Key。");
    console.log(`[keendata-i18n-agent] API 端点: ${defaultBaseUrl}`);
    console.log(`[keendata-i18n-agent] 模型: ${defaultModel}`);
    console.log(
      "[keendata-i18n-agent] 输入后将保存到 ~/.keendata-i18n-agent/credentials.json，下次自动读取。",
    );
    console.log(
      "[keendata-i18n-agent] 按 Ctrl+C 取消，或使用 --decision-mode rule 走规则模式。\n",
    );

    rl.question("请输入 API Key: ", (apiKey) => {
      apiKey = (apiKey || "").trim();
      if (!apiKey) {
        rl.close();
        resolve(null);
        return;
      }

      rl.question(
        `API 端点（回车使用默认 ${defaultBaseUrl}）: `,
        (baseUrl) => {
          baseUrl = (baseUrl || "").trim() || defaultBaseUrl;

          rl.question(
            `模型名（回车使用默认 ${defaultModel}）: `,
            (model) => {
              model = (model || "").trim() || defaultModel;
              rl.close();
              resolve({ apiKey, baseUrl, model });
            },
          );
        },
      );
    });
  });
}

/**
 * 解析 LLM 凭证，优先级：环境变量 > 本地文件 > 交互式输入
 * @param {object} agentConfig - agent 配置
 * @returns {Promise<object|null>} { apiKey, baseUrl, model } 或 null
 */
async function resolveCredentials(agentConfig) {
  const llmConfig = agentConfig.llm || {};
  const apiKeyEnv = llmConfig.apiKeyEnv || "LLM_API_KEY";
  const baseUrlEnv = llmConfig.baseUrlEnv || "LLM_BASE_URL";
  const modelEnv = llmConfig.modelEnv || "LLM_MODEL";
  const defaultBaseUrl =
    llmConfig.defaultBaseUrl || "http://router.keendata.net:5343/v1";
  const defaultModel = llmConfig.defaultModel || "gpt-5.5";

  // 1. 环境变量优先
  const envApiKey = process.env[apiKeyEnv];
  if (envApiKey) {
    return {
      apiKey: envApiKey,
      baseUrl: process.env[baseUrlEnv] || defaultBaseUrl,
      model: process.env[modelEnv] || defaultModel,
    };
  }

  // 2. 本地存储的凭证
  const stored = loadCredentials();
  if (stored && stored.apiKey) {
    return {
      apiKey: stored.apiKey,
      baseUrl: stored.baseUrl || defaultBaseUrl,
      model: stored.model || defaultModel,
    };
  }

  // 3. 交互式输入（仅在终端环境可用时）
  if (!process.stdin.isTTY) {
    return null;
  }

  const input = await promptForCredentials(defaultBaseUrl, defaultModel);
  if (!input) return null;

  saveCredentials(input);
  console.log(
    "[keendata-i18n-agent] 凭证已保存，下次运行将自动读取。\n",
  );
  return input;
}

module.exports = {
  getCredentialsFile,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  promptForCredentials,
  resolveCredentials,
};
