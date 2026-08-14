const fs = require("fs");
const path = require("path");

// voerkai18n 运行时占位符正则：匹配 {}, {name}, { name }, {name|formatter} 等
// 不匹配 {#...#} 等非 voerkai18n 语法的花括号内容，与运行时 interpolate 行为一致
const VOERKAI18N_PLACEHOLDER_REGEX =
  /\{\s*\w*\s*(?:\|\s*\w*\s*(?:\([^)]*\))?\s*)*\}/g;

// 占位式无效翻译正则：匹配 "Text 1"、"テキスト 1"、"نص 1" 等 LLM 返回的占位符结果
const PLACEHOLDER_TRANSLATION_REGEX = /^(Text|テキスト|نص|Texto|Texte)\s*\d+/i;

/**
 * 校验翻译源文件的完整性（缺失翻译、占位符）和正确性（字面量保留、源文残留）
 * @param {string} projectRoot - 项目根路径
 * @param {object} config - i18n 配置
 * @returns {object} 校验报告
 */
function validateTranslations(projectRoot, config) {
  const translationPath = path.join(projectRoot, config.translationFile);
  if (!fs.existsSync(translationPath)) {
    return {
      ok: false,
      summary: {
        entryCount: 0,
        missingLanguageCount: 0,
        issueCount: 0,
      },
      missingFile: config.translationFile,
      missingLanguages: [],
      issues: [],
    };
  }

  const translations = JSON.parse(fs.readFileSync(translationPath, "utf8"));
  return validateTranslationObject(translations, config);
}

/**
 * 校验翻译对象的完整性（缺失翻译）和正确性（占位符、字面量、源文残留）
 * 每条翻译问题只产生一个 issue，按优先级判定：字面量 > 占位符 > 源文残留
 * @param {object} translations - 翻译对象
 * @param {object} config - i18n 配置
 * @returns {object} 校验报告
 */
function validateTranslationObject(translations, config) {
  const missingLanguages = [];
  const issues = [];
  const requiredLanguages = config.languages.filter((lang) => lang !== "zh");
  const strictPlaceholders = Boolean(
    (config.translate && config.translate.strictPlaceholders) ||
    (config.validation && config.validation.placeholderStrictForNamedTokens),
  );

  Object.entries(translations).forEach(([sourceText, target]) => {
    if (!target || typeof target !== "object" || Array.isArray(target)) return;

    const sourcePlaceholders = extractPlaceholders(sourceText);
    const sourceLiterals = extractLiterals(sourceText);
    requiredLanguages.forEach((lang) => {
      const translatedText = target[lang];

      if (typeof translatedText !== "string" || translatedText.trim() === "") {
        missingLanguages.push({
          key: sourceText,
          language: lang,
        });
        return;
      }

      // 0. 占位式翻译检查（如 "Text 1"、"テキスト 1" 等 LLM 无效结果）
      if (isPlaceholderTranslation(translatedText)) {
        issues.push({
          type: "placeholder_translation",
          key: sourceText,
          language: lang,
          translatedText,
        });
        return;
      }

      // 1. 字面量保留检查（${...} 系统变量必须原样保留）
      // 优先级最高：如果翻译替换了系统变量，不再重复检查占位符
      const missingLiterals = checkLiteralPreservation(
        sourceLiterals,
        translatedText,
      );
      if (missingLiterals.length > 0) {
        issues.push({
          type: "literal",
          key: sourceText,
          language: lang,
          missingLiterals,
        });
        return;
      }

      // 2. 占位符一致性检查
      const translatedPlaceholders = extractPlaceholders(translatedText);
      if (
        !isPlaceholderCompatible(sourcePlaceholders, translatedPlaceholders, {
          strictPlaceholders,
        })
      ) {
        issues.push({
          type: "placeholder",
          key: sourceText,
          language: lang,
          sourcePlaceholders,
          translatedPlaceholders,
        });
        return;
      }

      // 3. 源文残留检查（非日文翻译不应包含中文）
      const leakedText = checkSourceTextLeakage(translatedText, lang);
      if (leakedText) {
        issues.push({
          type: "source_leakage",
          key: sourceText,
          language: lang,
          leakedText,
        });
      }
    });
  });

  return {
    ok: missingLanguages.length === 0 && issues.length === 0,
    summary: {
      entryCount: Object.keys(translations).length,
      missingLanguageCount: missingLanguages.length,
      issueCount: issues.length,
    },
    missingLanguages,
    issues,
  };
}

/**
 * 检查运行时语言包产物是否存在
 * @param {string} projectRoot - 项目根路径
 * @param {object} config - i18n 配置
 * @returns {object} { ok, missingFiles }
 */
function inspectGeneratedFiles(projectRoot, config) {
  const missingFiles = config.generatedFiles.filter(
    (file) => !fs.existsSync(path.join(projectRoot, file)),
  );
  return {
    ok: missingFiles.length === 0,
    missingFiles,
  };
}

/**
 * 从文本中提取 voerkai18n 占位符
 * 匹配 {}, {name}, { name }, {name|formatter} 等，不匹配 {#...#} 等系统变量
 * @param {string} text - 文本
 * @returns {array} 占位符数组
 */
function extractPlaceholders(text) {
  return (text.match(VOERKAI18N_PLACEHOLDER_REGEX) || []).map(
    normalizePlaceholder,
  );
}

/**
 * 从文本中提取需要原样保留的字面量（${...} 等系统变量）
 * 这些不是 voerkai18n 占位符，而是业务系统变量，翻译时必须原样保留
 * @param {string} text - 文本
 * @returns {string[]} 字面量数组
 */
function extractLiterals(text) {
  return text.match(/\$\{[^}]*\}/g) || [];
}

/**
 * 检查翻译是否保留了源文本中的所有字面量
 * @param {string[]} sourceLiterals - 源文本中的字面量
 * @param {string} translatedText - 翻译文本
 * @returns {string[]} 未被保留的字面量
 */
function checkLiteralPreservation(sourceLiterals, translatedText) {
  return sourceLiterals.filter((literal) => !translatedText.includes(literal));
}

/**
 * 检查翻译中是否残留了源中文（非日文语言）
 * 日文使用汉字，不检查；排除 ${...} 系统变量内的中文
 * @param {string} translatedText - 翻译文本
 * @param {string} language - 目标语言
 * @returns {string|null} 残留的中文片段，无残留时返回 null
 */
function checkSourceTextLeakage(translatedText, language) {
  // 日文使用汉字，不检查源文残留
  if (language === "jp") return null;

  // 移除翻译文本中的 ${...} 系统变量，避免误报
  const cleanText = translatedText.replace(/\$\{[^}]*\}/g, "");

  const chineseMatches = cleanText.match(/[\u3400-\u9fff]+/g);
  if (!chineseMatches) return null;

  return chineseMatches.join(" ");
}

/**
 * 标准化占位符格式
 * @param {string} token - 占位符 token
 * @returns {string} 标准化后的占位符
 */
function normalizePlaceholder(token) {
  const innerText = token.slice(1, -1).trim();
  return innerText ? `{${innerText}}` : "{}";
}

/**
 * 判断源占位符和翻译占位符是否兼容
 * @param {array} sourcePlaceholders - 源占位符
 * @param {array} translatedPlaceholders - 翻译占位符
 * @param {object} options - { strictPlaceholders }
 * @returns {boolean} 是否兼容
 */
function isPlaceholderCompatible(
  sourcePlaceholders,
  translatedPlaceholders,
  options = {},
) {
  if (sourcePlaceholders.length !== translatedPlaceholders.length) return false;
  // 源占位符全部为位置占位符 {} 时，翻译可以使用 {} 或 {命名} ，两者在 voerkai18n 位置参数调用下行为一致
  if (sourcePlaceholders.every((item) => item === "{}")) return true;
  // 源占位符包含命名占位符时，翻译必须使用相同的命名占位符（strictPlaceholders 模式下严格匹配）
  if (!options.strictPlaceholders) {
    return sourcePlaceholders.every(
      (item, index) => item === "{}" || item === translatedPlaceholders[index],
    );
  }
  return sourcePlaceholders.every(
    (item, index) => item === translatedPlaceholders[index],
  );
}

/**
 * 检测翻译结果是否为占位式无效翻译
 * 匹配 "Text 123"、"テキスト 123"、"نص 123" 等模式
 * @param {string} value - 翻译结果
 * @returns {boolean} 是否为占位式翻译
 */
function isPlaceholderTranslation(value) {
  return PLACEHOLDER_TRANSLATION_REGEX.test(value.trim());
}

/**
 * 修复 idMap.js 中未加引号的中文 key，确保 voerkai18n-loader 能正确 require/JSON.parse
 * voerkai18n compile 生成的 idMap.js 可能出现 { 已授权: 1 } 而非 { "已授权": 1 }，
 * 导致 require() 失败（ESM）且 JSON.parse 回退也失败，报错 "idMap.ts文件不存在"
 * @param {string} projectRoot - 项目根路径
 * @returns {object} { ok, fixed, file }
 */
function fixIdMapKeys(projectRoot) {
  const idMapPath = path.join(projectRoot, "src/languages/idMap.js");
  if (!fs.existsSync(idMapPath)) {
    return { ok: false, fixed: false, message: "idMap.js 不存在" };
  }

  let content = fs.readFileSync(idMapPath, "utf8");

  // 修复：1. 引号包裹未加引号的 key  2. 移除尾部分号  3. 移除尾部逗号
  const original = content;

  // 引号包裹未加引号的 key（中文、英文标识符等紧跟冒号的情况）
  // 匹配换行/文件首 + 缩进 + key + 冒号，保留原有缩进和换行结构
  // 不使用 (^|,) 前缀，因为 \s* 会吞掉换行符导致多行被合并为一行
  content = content.replace(
    /(^|\n)([ \t]*)([\u3400-\u9fff\w]+)(\s*):/g,
    (match, newline, indent, key, trailingSpace) => {
      // 如果 key 已经被引号包裹则跳过
      if (key.startsWith('"') || key.startsWith("'")) return match;
      // 引号包裹 key，转义内部双引号，保留缩进和换行
      const escapedKey = key.replace(/"/g, '\\"');
      return `${newline}${indent}"${escapedKey}"${trailingSpace}:`;
    },
  );

  // 注意：不对引号内 key 的空格做 trim 处理
  // default.json 中的 key 可能合法地包含空格（如 "只读 " 和 "只读" 是两个不同的 key）
  // trim 空格会导致 idMap.js 中产生重复 key，与 default.json 不一致

  // 移除尾部分号（}; → }）
  content = content.replace(/}\s*;?\s*$/, "}");

  // 移除对象末尾的逗号（,} → }）
  content = content.replace(/,\s*}/g, "}");

  if (content !== original) {
    fs.writeFileSync(idMapPath, content, "utf8");
    return { ok: true, fixed: true, file: "src/languages/idMap.js" };
  }

  return { ok: true, fixed: false, file: "src/languages/idMap.js" };
}

module.exports = {
  inspectGeneratedFiles,
  extractPlaceholders,
  extractLiterals,
  checkLiteralPreservation,
  checkSourceTextLeakage,
  isPlaceholderCompatible,
  isPlaceholderTranslation,
  validateTranslations,
  validateTranslationObject,
  fixIdMapKeys,
};
