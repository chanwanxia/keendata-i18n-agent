const fs = require("fs");
const path = require("path");
const { getPresetById } = require("./presets");
const { runShellCommand } = require("./shell");
const {
  validateTranslationObject,
  extractPlaceholders,
} = require("./validate");
const { OpenAI } = require("openai");

// voerkai18n 运行时占位符正则，与 validate.js 保持一致
const VOERKAI18N_PLACEHOLDER_REGEX =
  /\{\s*\w*\s*(?:\|\s*\w*\s*(?:\([^)]*\))?\s*)*\}/g;

/**
 * 执行翻译流程：provider 翻译 + glossary 补齐 + 后处理校正
 * @param {string} projectRoot - 项目根路径
 * @param {object} config - i18n 配置
 * @param {object} options - { provider, appidEnv, appkeyEnv }
 * @returns {object} 翻译报告
 */
async function translateTranslations(projectRoot, config, options = {}) {
  const translationPath = path.join(projectRoot, config.translationFile);
  if (!fs.existsSync(translationPath)) {
    return {
      ok: false,
      summary: {
        filledCount: 0,
        missingFile: config.translationFile,
      },
      provider: {
        used: "none",
        executed: false,
      },
      filledItems: [],
    };
  }

  const providerReport = await runTranslateProvider(
    projectRoot,
    config,
    options,
  );
  if (!providerReport.ok) {
    return {
      ok: false,
      summary: {
        filledCount: 0,
        translationFile: config.translationFile,
      },
      provider: providerReport,
      filledItems: [],
    };
  }

  const preset = config.preset ? getPresetById(config.preset) : null;
  const glossary =
    (preset && preset.rules.translation && preset.rules.translation.glossary) ||
    {};
  const translations = JSON.parse(fs.readFileSync(translationPath, "utf8"));
  const filledItems = [];
  const correctedItems = [];
  const useGlossaryFallback =
    !config.translate || config.translate.useGlossaryFallback !== false;
  const useGlossaryPostProcess =
    !config.translate || config.translate.useGlossaryPostProcess !== false;

  Object.entries(translations).forEach(([sourceText, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;

    config.languages
      .filter((lang) => lang !== "zh")
      .forEach((lang) => {
        if (typeof item[lang] === "string" && item[lang].trim() !== "") return;
        if (!useGlossaryFallback) return;

        const translated = translateText(sourceText, lang, glossary);
        if (!translated) return;

        item[lang] = translated;
        filledItems.push({
          key: sourceText,
          language: lang,
          value: translated,
        });
      });
  });

  if (useGlossaryPostProcess) {
    Object.entries(translations).forEach(([sourceText, item]) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;

      config.languages
        .filter((lang) => lang !== "zh")
        .forEach((lang) => {
          if (typeof item[lang] !== "string" || item[lang].trim() === "")
            return;
          const corrected = applyGlossaryPostProcess(
            sourceText,
            item[lang],
            lang,
            glossary,
          );
          if (corrected === item[lang]) return;
          item[lang] = corrected;
          correctedItems.push({
            key: sourceText,
            language: lang,
            value: corrected,
          });
        });
    });
  }

  const validation = validateTranslationObject(translations, config);
  const strictPlaceholders =
    !config.translate || config.translate.strictPlaceholders !== false;

  if (filledItems.length > 0 || correctedItems.length > 0) {
    fs.writeFileSync(
      translationPath,
      `${JSON.stringify(translations, null, 2)}\n`,
      "utf8",
    );
  }

  return {
    ok: strictPlaceholders ? validation.issues.length === 0 : true,
    summary: {
      filledCount: filledItems.length,
      correctedCount: correctedItems.length,
      translationFile: config.translationFile,
      issueCount: validation.issues.length,
    },
    provider: providerReport,
    filledItems,
    correctedItems,
    issues: validation.issues,
  };
}

/**
 * 根据 provider 类型执行对应翻译
 * @param {string} projectRoot - 项目根路径
 * @param {object} config - i18n 配置
 * @param {object} options - 选项
 * @returns {object} provider 报告
 */
async function runTranslateProvider(projectRoot, config, options) {
  const translateConfig = config.translate || {};
  const provider = options.provider || translateConfig.provider || "glossary";

  if (provider === "glossary" || provider === "none") {
    return {
      ok: true,
      used: provider,
      executed: false,
    };
  }

  if (provider === "llm") {
    return runLlmTranslate(projectRoot, config, options);
  }

  if (provider === "baidu") {
    return runBaiduTranslate(projectRoot, config, options);
  }

  if (provider === "command") {
    return runCustomTranslateCommand(projectRoot, config);
  }

  return {
    ok: false,
    used: provider,
    executed: false,
    message: `不支持的翻译 provider: ${provider}`,
  };
}

/**
 * 执行百度翻译
 * @param {string} projectRoot - 项目根路径
 * @param {object} config - i18n 配置
 * @param {object} options - 选项
 * @returns {object} 翻译结果报告
 */
function runBaiduTranslate(projectRoot, config, options) {
  const translateConfig = config.translate || {};
  const baiduConfig = translateConfig.baidu || {};
  const appidEnvName =
    options.appidEnv || baiduConfig.appidEnv || "BAIDU_APPID";
  const appkeyEnvName =
    options.appkeyEnv || baiduConfig.appkeyEnv || "BAIDU_APPKEY";
  const appid = process.env[appidEnvName];
  const appkey = process.env[appkeyEnvName];

  if (!appid || !appkey) {
    return {
      ok: false,
      used: "baidu",
      executed: false,
      message: `缺少百度翻译环境变量: ${!appid ? appidEnvName : ""}${!appid && !appkey ? " / " : ""}${!appkey ? appkeyEnvName : ""}`,
    };
  }

  const baseCommand =
    translateConfig.command || "pnpm exec voerkai18n translate";
  const command = `${baseCommand} --appid "$${appidEnvName}" --appkey "$${appkeyEnvName}"`;
  const status = runShellCommand(command, projectRoot, "执行百度翻译", {
    env: {
      [appidEnvName]: appid,
      [appkeyEnvName]: appkey,
    },
  });

  return {
    ok: status === 0,
    used: "baidu",
    executed: true,
    command,
    credentialEnv: {
      appidEnv: appidEnvName,
      appkeyEnv: appkeyEnvName,
    },
    message: status === 0 ? "百度翻译执行完成" : "百度翻译执行失败",
  };
}

/**
 * 执行自定义翻译命令
 * @param {string} projectRoot - 项目根路径
 * @param {object} config - i18n 配置
 * @returns {object} 翻译结果报告
 */
function runCustomTranslateCommand(projectRoot, config) {
  const translateConfig = config.translate || {};
  if (!translateConfig.command) {
    return {
      ok: false,
      used: "command",
      executed: false,
      message: "未配置 translate.command",
    };
  }

  const status = runShellCommand(
    translateConfig.command,
    projectRoot,
    "执行自定义翻译命令",
  );
  return {
    ok: status === 0,
    used: "command",
    executed: true,
    command: translateConfig.command,
    message: status === 0 ? "自定义翻译命令执行完成" : "自定义翻译命令执行失败",
  };
}

/**
 * 使用 glossary 翻译单条文本
 * @param {string} sourceText - 源文本
 * @param {string} language - 目标语言
 * @param {object} glossary - 术语表
 * @returns {string} 翻译结果
 */
function translateText(sourceText, language, glossary) {
  if (glossary[sourceText] && glossary[sourceText][language]) {
    return preserveSpecialTokens(sourceText, glossary[sourceText][language]);
  }

  let translated = sourceText;
  const glossaryTerms = Object.keys(glossary).sort(
    (a, b) => b.length - a.length,
  );
  glossaryTerms.forEach((term) => {
    const value = glossary[term];
    if (!value[language]) return;
    translated = translated.split(term).join(value[language]);
  });

  translated =
    translated === sourceText
      ? buildFallbackTranslation(sourceText, language)
      : translated;
  return preserveSpecialTokens(sourceText, translated);
}

/**
 * 对翻译结果执行 glossary 二次校正
 * @param {string} sourceText - 源文本
 * @param {string} translatedText - 翻译文本
 * @param {string} language - 目标语言
 * @param {object} glossary - 术语表
 * @returns {string} 校正后的文本
 */
function applyGlossaryPostProcess(
  sourceText,
  translatedText,
  language,
  glossary,
) {
  if (glossary[sourceText] && glossary[sourceText][language]) {
    return preserveSpecialTokens(sourceText, glossary[sourceText][language]);
  }

  let corrected = translatedText;
  const glossaryTerms = Object.keys(glossary).sort(
    (a, b) => b.length - a.length,
  );
  glossaryTerms.forEach((term) => {
    if (!sourceText.includes(term)) return;
    if (!glossary[term][language]) return;
    if (!corrected.includes(term)) return;
    corrected = corrected.split(term).join(glossary[term][language]);
  });

  const sourcePlaceholders = extractPlaceholders(sourceText);
  if (sourcePlaceholders.length > 0) {
    corrected = normalizePlaceholderTokens(corrected, sourcePlaceholders);
  }

  return corrected;
}

/**
 * 使用 LLM (OpenAI 兼容 API) 批量翻译 default.json 中缺失的翻译
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} config - i18n 配置
 * @param {object} options - 选项
 * @returns {object} 翻译结果报告
 */
async function runLlmTranslate(projectRoot, config, options) {
  const apiKey = process.env["LLM_API_KEY"];
  if (!apiKey) {
    console.warn("[i18n-kit] LLM_API_KEY 未设置，回退到 glossary 模式");
    return { ok: true, used: "glossary", executed: false };
  }

  const baseUrl = process.env["LLM_BASE_URL"] || "http://router.keendata.net:5343/v1";
  const model = process.env["LLM_MODEL"] || "gpt-5.5";
  const translationPath = path.join(projectRoot, config.translationFile);

  if (!fs.existsSync(translationPath)) {
    return {
      ok: false,
      used: "llm",
      executed: false,
      message: "翻译源文件不存在",
    };
  }

  const translations = JSON.parse(fs.readFileSync(translationPath, "utf8"));
  const targetLanguages = config.languages.filter((lang) => lang !== "zh");
  const preset = config.preset ? getPresetById(config.preset) : null;
  const glossary =
    (preset && preset.rules.translation && preset.rules.translation.glossary) ||
    {};

  const missingEntries = [];
  Object.entries(translations).forEach(([sourceText, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    targetLanguages.forEach((lang) => {
      if (typeof item[lang] !== "string" || item[lang].trim() === "") {
        missingEntries.push({ sourceText, language: lang });
      }
    });
  });

  if (missingEntries.length === 0) {
    return { ok: true, used: "llm", executed: true, message: "无缺失翻译" };
  }

  const batchSize = 50;
  const sourceTexts = [...new Set(missingEntries.map((e) => e.sourceText))];
  let translatedCount = 0;

  for (let i = 0; i < sourceTexts.length; i += batchSize) {
    const batch = sourceTexts.slice(i, i + batchSize);
    try {
      const results = await callLlmTranslate(
        batch,
        targetLanguages,
        glossary,
        apiKey,
        baseUrl,
        model,
      );
      results.forEach((result) => {
        const item = translations[result.source];
        if (!item || typeof item !== "object") return;
        targetLanguages.forEach((lang) => {
          if (result[lang] && typeof result[lang] === "string") {
            item[lang] = result[lang];
            translatedCount += 1;
          }
        });
      });
    } catch (error) {
      console.warn(
        `[i18n-kit] LLM 翻译批次 ${i / batchSize + 1} 失败: ${error.message}`,
      );
    }
  }

  if (translatedCount > 0) {
    fs.writeFileSync(
      translationPath,
      JSON.stringify(translations, null, 2) + "\n",
      "utf8",
    );
  }

  return {
    ok: true,
    used: "llm",
    executed: true,
    translatedCount,
    remainingCount: missingEntries.length - translatedCount,
    message: `LLM 翻译完成: ${translatedCount} 条已翻译, ${missingEntries.length - translatedCount} 条未翻译`,
  };
}

/**
 * 调用 LLM API 批量翻译
 * @param {string[]} sourceTexts - 待翻译的中文文本数组
 * @param {string[]} targetLanguages - 目标语言数组
 * @param {object} glossary - 术语表
 * @param {string} apiKey - API Key
 * @param {string} baseUrl - API Base URL
 * @param {string} model - 模型名称
 * @returns {Promise<object[]>} 翻译结果数组
 */
async function callLlmTranslate(
  sourceTexts,
  targetLanguages,
  glossary,
  apiKey,
  baseUrl,
  model,
) {
  const client = new OpenAI({ baseURL: baseUrl, apiKey });
  const systemMessage =
    "你是翻译引擎。将中文翻译为指定语言，保持 {} 占位符不变，遵循术语表。只返回 JSON。";
  const userMessage = JSON.stringify({
    glossary: glossary,
    targetLanguages: targetLanguages,
    texts: sourceTexts,
    format:
      '返回 JSON: { "translations": [{ "source": "中文", "en": "English", "jp": "日本語", "ar": "العربية" }] }',
  });

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
    ],
  });

  const content = response.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  return parsed.translations || [];
}

/**
 * 生成回退翻译（返回空字符串让 validate 检测到缺失）
 * @param {string} sourceText - 源文本
 * @param {string} language - 目标语言
 * @returns {string} 空字符串
 */
function buildFallbackTranslation(sourceText, language) {
  return "";
}

/**
 * 保持翻译后的占位符与源文本一致
 * @param {string} sourceText - 源文本
 * @param {string} translatedText - 翻译文本
 * @returns {string} 修正占位符后的文本
 */
function preserveSpecialTokens(sourceText, translatedText) {
  const tokens = sourceText.match(VOERKAI18N_PLACEHOLDER_REGEX) || [];
  if (tokens.length === 0) return translatedText;

  return normalizePlaceholderTokens(translatedText, tokens);
}

/**
 * 按顺序将翻译文本中的占位符替换为源占位符
 * @param {string} translatedText - 翻译文本
 * @param {array} tokens - 源占位符数组
 * @returns {string} 修正后的文本
 */
function normalizePlaceholderTokens(translatedText, tokens) {
  let index = 0;
  return translatedText.replace(VOERKAI18N_PLACEHOLDER_REGEX, () => {
    const token = tokens[index] || "{}";
    index += 1;
    return token;
  });
}

module.exports = {
  translateTranslations,
};
