const fs = require("fs");
const path = require("path");

const PRETTIER_CONFIG_FILES = [
  ".prettierrc.js",
  ".prettierrc.cjs",
  "prettier.config.js",
  "prettier.config.cjs",
  ".prettierrc",
  ".prettierrc.json",
];

/**
 * 修复会阻断生成语言文件格式化的旧版 Prettier 配置。
 * @param {string} projectRoot - 目标项目根路径
 * @returns {{updated: boolean, files: string[]}} 修复报告
 */
function repairPrettierConfig(projectRoot) {
  const updatedFiles = [];

  PRETTIER_CONFIG_FILES.forEach((relativePath) => {
    const configPath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(configPath)) return;

    const original = fs.readFileSync(configPath, "utf8");
    const repaired = isJsonConfig(relativePath)
      ? repairJsonConfig(original)
      : repairJavaScriptConfig(original);

    if (repaired !== original) {
      fs.writeFileSync(configPath, repaired, "utf8");
      updatedFiles.push(relativePath);
    }
  });

  return {
    updated: updatedFiles.length > 0,
    files: updatedFiles,
  };
}

/**
 * 判断 Prettier 配置是否采用 JSON 格式。
 * @param {string} relativePath - 配置相对路径
 * @returns {boolean} 是否为 JSON 配置
 */
function isJsonConfig(relativePath) {
  return relativePath === ".prettierrc" || relativePath.endsWith(".json");
}

/**
 * 修复 JSON 格式的 Prettier 配置。
 * @param {string} content - 原始配置内容
 * @returns {string} 修复后的配置内容
 */
function repairJsonConfig(content) {
  let config;
  try {
    config = JSON.parse(content);
  } catch {
    return content;
  }

  let changed = false;
  if (config.rangeEnd === null) {
    delete config.rangeEnd;
    changed = true;
  }
  if (
    config.jsxBracketSameLine !== undefined &&
    config.bracketSameLine === undefined
  ) {
    config.bracketSameLine = config.jsxBracketSameLine;
    delete config.jsxBracketSameLine;
    changed = true;
  }

  return changed ? `${JSON.stringify(config, null, 2)}\n` : content;
}

/**
 * 修复 JavaScript 格式的 Prettier 配置。
 * @param {string} content - 原始配置内容
 * @returns {string} 修复后的配置内容
 */
function repairJavaScriptConfig(content) {
  let repaired = content;
  const hasModernBracketOption = /\bbracketSameLine\s*:/.test(repaired);

  repaired = repaired.replace(
    /^\s*rangeEnd\s*:\s*null\s*,?\s*(?:\/\/[^\n]*)?\r?\n?/gm,
    "",
  );

  if (hasModernBracketOption) {
    repaired = repaired.replace(
      /^\s*jsxBracketSameLine\s*:\s*[^,\n]+,?\s*(?:\/\/[^\n]*)?\r?\n?/gm,
      "",
    );
  } else {
    repaired = repaired.replace(/\bjsxBracketSameLine\s*:/g, "bracketSameLine:");
  }

  return repaired;
}

module.exports = {
  repairPrettierConfig,
};
