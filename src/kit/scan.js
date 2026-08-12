const fs = require("fs");
const { collectTargetFiles, toRelative } = require("./files");

/**
 * 扫描项目源码中未被 t() 包裹的硬编码中文
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} config - i18n 配置
 * @returns {object} 扫描报告
 */
function scanHardcodedChinese(projectRoot, config) {
  const files = collectTargetFiles(projectRoot, config);
  const candidates = [];

  files.forEach((filePath) => {
    const relativePath = toRelative(projectRoot, filePath);
    if (shouldIgnoreFile(relativePath, config)) return;

    const content = fs.readFileSync(filePath, "utf8");

    // 去除多行块注释（/* ... */ 和 <!-- ... -->），保留换行以维持行号
    const strippedContent = stripMultiLineComments(content);

    // 从整个文件中收集已被 t() / this.t() / $t() 包裹的中文文案（支持跨行调用）
    const wrappedTexts = collectWrappedTexts(strippedContent);

    // 收集 console.*() 调用中的中文字符串（调试日志，不纳入国际化范围）
    const consoleTexts = collectConsoleTexts(strippedContent);

    const excludedTexts = [...wrappedTexts, ...consoleTexts];

    const lines = strippedContent.split(/\r?\n/);
    lines.forEach((line, index) => {
      const detectableLine = stripConsoleCalls(stripInlineComments(line));
      if (!containsChinese(detectableLine)) return;
      if (shouldIgnoreLine(detectableLine, config)) return;

      const unescapedChinese = findUnwrappedChinese(
        detectableLine,
        excludedTexts,
      );
      if (unescapedChinese.length === 0) return;

      candidates.push({
        file: relativePath,
        line: index + 1,
        text: detectableLine.trim().slice(0, 200),
      });
    });
  });

  return {
    summary: {
      fileCount: files.length,
      candidateCount: candidates.length,
    },
    candidates,
  };
}

/**
 * 判断一行是否应该被忽略
 * @param {string} line - 行内容
 * @param {object} config - i18n 配置
 * @returns {boolean} 是否忽略
 */
function shouldIgnoreLine(line, config) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^(\/\/|\/\*|\*|<!--)/.test(trimmed)) return true;
  return config.hardcodedChinese.ignorePatterns.some((pattern) =>
    line.includes(pattern),
  );
}

/**
 * 判断文件是否应该被忽略
 * @param {string} relativePath - 相对路径
 * @param {object} config - i18n 配置
 * @returns {boolean} 是否忽略
 */
function shouldIgnoreFile(relativePath, config) {
  const prefixes = config.hardcodedChinese.ignoreFilePrefixes || [];
  return prefixes.some((prefix) => relativePath.startsWith(prefix));
}

/**
 * 检测文本中是否包含中文
 * @param {string} text - 文本
 * @returns {boolean} 是否包含中文
 */
function containsChinese(text) {
  return /[\u3400-\u9fff]/.test(text);
}

/**
 * 去除多行块注释（块注释和 HTML 注释），将注释内容替换为空格，保留换行符以维持行号
 * @param {string} content - 文件内容
 * @returns {string} 去除块注释后的内容
 */
function stripMultiLineComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * 去除行内注释（// 开头的单行注释）
 * @param {string} line - 行内容
 * @returns {string} 去除注释后的内容
 */
function stripInlineComments(line) {
  return line.replace(/\/\/.*$/g, "");
}

/**
 * 从文件内容中收集所有已被 t() / this.t() / $t() 包裹的中文字符串
 * 支持跨行调用（如 this.t( 和字符串在不同行的情况）
 * @param {string} content - 文件内容
 * @returns {string[]} 已包裹的中文文案数组
 */
function collectWrappedTexts(content) {
  const wrappedTexts = [];
  const tCallRegex =
    /(?:this\.|\$)?\bt\s*\(\s*["'`]([^"'`]*[\u3400-\u9fff][^"'`]*)["'`]/g;
  let match;
  while ((match = tCallRegex.exec(content)) !== null) {
    wrappedTexts.push(match[1]);
  }
  return wrappedTexts;
}

/**
 * 在一行中查找未被 t() 或 this.t() 包裹的中文字符串
 * @param {string} line - 行内容
 * @param {string[]} excludedTexts - 整个文件中已被 t() 包裹或位于 console 调用中的文案
 * @returns {string[]} 未被包裹的中文片段
 */
function findUnwrappedChinese(line, excludedTexts = []) {
  const chineseRegex =
    /[\u3400-\u9fff]+[^\u3400-\u9fff\u0000-\u0027\u003b\u0040\u005b\u005d\u007b\u007d]*/g;

  const results = [];
  while ((match = chineseRegex.exec(line)) !== null) {
    const chineseText = match[0];
    const isExcluded = excludedTexts.some((excluded) =>
      excluded.includes(chineseText.trim()),
    );
    if (!isExcluded) {
      results.push(chineseText);
    }
  }

  return results;
}

/**
 * 从文件内容中收集所有 console.*() 调用中的中文字符串
 * console 调用属于调试日志，不纳入国际化范围；支持跨行调用
 * @param {string} content - 文件内容
 * @returns {string[]} console 调用中的中文文案数组
 */
function collectConsoleTexts(content) {
  const consoleTexts = [];
  const consoleCallRegex = /console\.\w+\s*\(([\s\S]*?)\)/g;
  let match;
  while ((match = consoleCallRegex.exec(content)) !== null) {
    const stringRegex = /["'`]([^"'`]*[\u3400-\u9fff][^"'`]*)["'`]/g;
    let strMatch;
    while ((strMatch = stringRegex.exec(match[1])) !== null) {
      consoleTexts.push(strMatch[1]);
    }
  }
  return consoleTexts;
}

/**
 * 去除单行 console.*() 调用，避免调试日志中的中文被误报
 * @param {string} line - 行内容
 * @returns {string} 去除 console 调用后的内容
 */
function stripConsoleCalls(line) {
  return line.replace(/console\.\w+\s*\([^)]*\)/g, "");
}

module.exports = {
  scanHardcodedChinese,
};
