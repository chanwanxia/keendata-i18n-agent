const fs = require("fs");
const path = require("path");
const { getPresetById } = require("./presets");
const { runShellCommand } = require("./shell");
const {
  validateTranslationObject,
  extractPlaceholders,
  isPlaceholderTranslation,
} = require("./validate");
const { resolveLlmMaxRetries } = require("../llm");
const { OpenAI } = require("openai");

// voerkai18n 运行时占位符正则，与 validate.js 保持一致
const VOERKAI18N_PLACEHOLDER_REGEX =
  /\{\s*\w*\s*(?:\|\s*\w*\s*(?:\([^)]*\))?\s*)*\}/g;

/**
 * 执行翻译流程：provider 翻译 + glossary 补齐 + 后处理校正
 * @param {string} projectRoot - 项目根路径
 * @param {object} config - i18n 配置
 * @param {object} options - { provider, appidEnv, appkeyEnv, force }
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

  const llmTranslatedCount =
    providerReport && typeof providerReport.translatedCount === "number"
      ? providerReport.translatedCount
      : 0;

  return {
    ok: strictPlaceholders ? validation.issues.length === 0 : true,
    summary: {
      filledCount: filledItems.length,
      translatedCount: llmTranslatedCount,
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
 * @param {object} options - 选项 { provider, force, appidEnv, appkeyEnv }
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
 * 使用 LLM (OpenAI 兼容 API) 批量翻译 default.json 中缺失或无效的翻译
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} config - i18n 配置
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 翻译结果报告
 */
/** LLM 翻译默认并发批次数，默认串行以降低触发 429 的概率 */
const DEFAULT_LLM_BATCH_CONCURRENCY = 1;

/**
 * 解析 LLM 翻译批次并发数，支持 LLM_BATCH_CONCURRENCY 覆盖。
 * @returns {number} 至少为 1 的批次并发数
 */
function resolveLlmBatchConcurrency() {
  const parsed = Number(process.env.LLM_BATCH_CONCURRENCY);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_LLM_BATCH_CONCURRENCY;
  }
  return parsed;
}

/**
 * 格式化 LLM 翻译批次进度，串行时避免显示 1-1 这类冗余范围。
 * @param {number} startBatch - 当前批次起点（从 1 开始）
 * @param {number} endBatch - 当前批次终点（从 1 开始，包含）
 * @param {number} totalBatches - 总批次数
 * @returns {string} 批次进度文本
 */
function formatBatchProgressLabel(startBatch, endBatch, totalBatches) {
  if (startBatch === endBatch) {
    return `${startBatch}/${totalBatches}`;
  }
  return `${startBatch}-${endBatch}/${totalBatches}`;
}

/**
 * 使用 LLM (OpenAI 兼容 API) 批量翻译 default.json 中缺失或无效的翻译。
 *
 * 设计要点：
 * - 增量检测：只翻译空翻译和占位式无效翻译，已有有效翻译保持不变
 * - 批次并发：默认串行处理，可通过 LLM_BATCH_CONCURRENCY 调高并发
 * - 逐批写入：每完成一组并发批次就写入文件，中断后重新 run 只丢失当前组
 * - 幂等恢复：中断后重新 run 时，已写入的翻译会被跳过，不会重复翻译
 *
 * @param {string} projectRoot - 项目根路径
 * @param {object} config - i18n 配置
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 翻译结果报告
 */
async function runLlmTranslate(projectRoot, config, options = {}) {
  const apiKey = process.env["LLM_API_KEY"];
  if (!apiKey) {
    console.warn("[i18n-kit] LLM_API_KEY 未设置，回退到 glossary 模式");
    return { ok: true, used: "glossary", executed: false };
  }

  const baseUrl =
    process.env["LLM_BASE_URL"] || "http://router.keendata.net:5343/v1";
  const model = process.env["LLM_MODEL"] || "gpt-5.5";
  const client =
    options.client ||
    new OpenAI({
      baseURL: baseUrl,
      apiKey,
      maxRetries: resolveLlmMaxRetries(),
    });
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

  // force 模式：清空所有翻译，强制重新翻译
  if (options.force) {
    Object.entries(translations).forEach(([, item]) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      targetLanguages.forEach((lang) => {
        if (typeof item[lang] === "string" && item[lang].trim() !== "") {
          item[lang] = "";
        }
      });
    });
  }

  // 检测需要翻译的条目：空翻译 + 占位式无效翻译（如 "Text 1"）
  const missingEntries = [];
  Object.entries(translations).forEach(([sourceText, item]) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    targetLanguages.forEach((lang) => {
      const value = item[lang];
      if (typeof value !== "string" || value.trim() === "") {
        missingEntries.push({ sourceText, language: lang });
      } else if (isPlaceholderTranslation(value)) {
        // 占位式无效翻译，清空并标记为需要重新翻译
        item[lang] = "";
        missingEntries.push({ sourceText, language: lang });
      }
    });
  });

  if (missingEntries.length === 0) {
    return { ok: true, used: "llm", executed: true, translatedCount: 0, message: "无缺失翻译" };
  }

  const batchSize = 50;
  const sourceTexts = [...new Set(missingEntries.map((e) => e.sourceText))];
  const missingKeySet = new Set(
    missingEntries.map((entry) => `${entry.sourceText}\u0000${entry.language}`),
  );
  const savedKeySet = new Set();
  const totalBatches = Math.ceil(sourceTexts.length / batchSize);
  const batchConcurrency = resolveLlmBatchConcurrency();
  let translatedCount = 0;
  let completedBatches = 0;

  // 按并发数分组处理批次，每组完成后写入文件
  for (let gi = 0; gi < totalBatches; gi += batchConcurrency) {
    const groupEnd = Math.min(gi + batchConcurrency, totalBatches);

    const batchProgress = formatBatchProgressLabel(
      gi + 1,
      groupEnd,
      totalBatches,
    );
    console.log(
      `[i18n-kit] LLM 翻译进度: 批次 ${batchProgress} (${sourceTexts.length} 条源文，${missingEntries.length} 个缺失翻译)`,
    );

    // 按配置并发发送当前组的所有批次
    const batchPromises = [];
    for (let bi = gi; bi < groupEnd; bi += 1) {
      const start = bi * batchSize;
      const batch = sourceTexts.slice(start, start + batchSize);
      batchPromises.push(
        callLlmTranslate(client, batch, targetLanguages, glossary, model)
          .then((results) => ({ results, batchNum: bi + 1, ok: true }))
          .catch((error) => {
            console.warn(`[i18n-kit] LLM 翻译批次 ${bi + 1} 失败: ${error.message}`);
            return { results: [], batchNum: bi + 1, ok: false };
          }),
      );
    }

    const settled = await Promise.all(batchPromises);

    // 同步应用翻译结果到 translations 对象
    let groupTranslated = 0;
    let groupTranslatedSourceCount = 0;
    const groupTranslatedSources = new Set();
    settled.forEach(({ results }) => {
      results.forEach((result) => {
        const item = translations[result.source];
        if (!item || typeof item !== "object") return;
        targetLanguages.forEach((lang) => {
          const missingKey = `${result.source}\u0000${lang}`;
          if (!missingKeySet.has(missingKey) || savedKeySet.has(missingKey)) {
            return;
          }
          if (result[lang] && typeof result[lang] === "string") {
            item[lang] = result[lang];
            savedKeySet.add(missingKey);
            groupTranslatedSources.add(result.source);
            groupTranslated += 1;
            translatedCount += 1;
          }
        });
      });
      completedBatches += 1;
    });
    groupTranslatedSourceCount = groupTranslatedSources.size;

    // 每组完成后立即写入文件，中断后只丢失当前组
    if (groupTranslated > 0) {
      fs.writeFileSync(
        translationPath,
        JSON.stringify(translations, null, 2) + "\n",
        "utf8",
      );
      console.log(
        `[i18n-kit] LLM 翻译: 已保存 ${translatedCount}/${missingEntries.length} 个缺失翻译，本批覆盖 ${groupTranslatedSourceCount} 条源文 (${completedBatches}/${totalBatches} 批次完成)`,
      );
    }
  }

  return {
    ok: true,
    used: "llm",
    executed: true,
    translatedCount,
    remainingCount: missingEntries.length - translatedCount,
    sourceTextCount: sourceTexts.length,
    missingEntryCount: missingEntries.length,
    message: `LLM 翻译完成: ${translatedCount}/${missingEntries.length} 个缺失翻译已保存`,
  };
}

/**
 * 调用 LLM API 批量翻译
 * @param {object} client - OpenAI SDK 客户端实例
 * @param {string[]} sourceTexts - 待翻译的中文文本数组
 * @param {string[]} targetLanguages - 目标语言数组
 * @param {object} glossary - 术语表
 * @param {string} model - 模型名称
 * @returns {Promise<object[]>} 翻译结果数组
 */
async function callLlmTranslate(
  client,
  sourceTexts,
  targetLanguages,
  glossary,
  model,
) {
  const systemMessage = [
    "你是一个专业的软件国际化翻译引擎。",
    "你的任务：将给定的中文文本数组翻译为指定的目标语言。",
    "",
    "## 规则",
    "1. 必须翻译 texts 数组中的每一条文本，不得遗漏任何一条。",
    '2. 翻译必须基于中文原文的实际含义，不得使用 "Text"、"文本"、"نص" 等占位词加编号的形式。',
    "3. 保持原文中的 {} 占位符不变（位置和数量必须一致）。",
    "4. 遵循术语表（glossary）中的指定翻译。",
    "5. 只返回 JSON，不要包含任何解释或额外文本。",
    "",
    "## 输出格式",
    '返回 JSON: { "translations": [{ "source": "原始中文", "en": "English translation", "jp": "日本語訳", "ar": "الترجمة العربية" }] }',
    "translations 数组的长度必须与输入 texts 数组相同，且 source 字段必须与原始中文完全一致。",
  ].join("\n");

  const userMessage = JSON.stringify({
    glossary: glossary,
    targetLanguages: targetLanguages,
    texts: sourceTexts,
    instruction:
      "请翻译 texts 数组中的每一条中文文本到所有目标语言。source 字段必须与原文完全一致。",
    format:
      '返回 JSON: { "translations": [{ "source": "中文原文", "en": "English", "jp": "日本語", "ar": "العربية" }] }',
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
  const translations = parsed.translations || [];

  // 过滤掉占位式无效翻译（如 "Text 144"、"テキスト 144"、"نص 144"）
  const validTranslations = translations.filter((result) => {
    if (!result || !result.source) return false;
    return targetLanguages.every((lang) => {
      const value = result[lang];
      if (typeof value !== "string" || value.trim() === "") return false;
      if (isPlaceholderTranslation(value)) return false;
      return true;
    });
  });

  return validTranslations;
}

/**
 * 生成回退翻译（返回空字符串让 validate 检测到缺失）
 * @param {string} _sourceText - 源文本
 * @param {string} _language - 目标语言
 * @returns {string} 空字符串
 */
function buildFallbackTranslation(_sourceText, _language) {
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
  formatBatchProgressLabel,
  resolveLlmBatchConcurrency,
  translateTranslations,
};
