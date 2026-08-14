const fs = require("fs");
const path = require("path");

const TEMPLATE_DIR = path.join(__dirname, "templates");

/**
 * 模板文件映射表：模板相对路径 -> 目标相对路径
 */
const TEMPLATE_FILES = [
  { template: "languages/index.js", target: "src/languages/index.js", transform: true },
  { template: "languages/storage.js", target: "src/languages/storage.js" },
  { template: "languages/settings.json", target: "src/languages/settings.json" },
  { template: "languages/translates/default.json", target: "src/languages/translates/default.json", noOverwrite: true },
  // noOverwrite: true 表示即使 force=true 也不覆盖（保护用户数据和提取结果）
  { template: "languages/i18n-plugin/i18nMixin.js", target: "src/languages/i18n-plugin/i18nMixin.js" },
  { template: "languages/formatters/zh.js", target: "src/languages/formatters/zh.js" },
  { template: "languages/formatters/en.js", target: "src/languages/formatters/en.js" },
  { template: "languages/formatters/jp.js", target: "src/languages/formatters/jp.js" },
  { template: "languages/formatters/ar.js", target: "src/languages/formatters/ar.js" },
  { template: "mixins/i18n-width-mixin.js", target: "src/mixins/i18n-width-mixin.js" },
  { template: "styles/i18n-style.scss", target: "src/styles/i18n-style.scss" },
  { template: "utils/elementui-utils.js", target: "src/utils/elementui-utils.js" },
];

/**
 * 将 gaea-fe-new 的基础设施文件作为模板写入目标项目
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} profile - 项目画像
 * @param {object} config - i18n 配置
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} scaffold 报告
 */
function scaffold(projectRoot, profile, config, options = {}) {
  const created = [];
  const skipped = [];
  const packageName = profile.packageName || path.basename(projectRoot);

  TEMPLATE_FILES.forEach((entry) => {
    const targetPath = path.join(projectRoot, entry.target);

    if (fs.existsSync(targetPath) && !options.force) {
      skipped.push(entry.target);
      return;
    }
    // noOverwrite 标记的文件（如 default.json）即使 force=true 也不覆盖，
    // 因为它们包含提取的翻译数据，覆盖会清空已有翻译
    if (fs.existsSync(targetPath) && entry.noOverwrite) {
      skipped.push(entry.target);
      return;
    }

    const templatePath = path.join(TEMPLATE_DIR, entry.template);
    let content = fs.readFileSync(templatePath, "utf8");

    if (entry.transform) {
      content = content.replace(/\{\{packageName\}\}/g, packageName);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");
    created.push(entry.target);
  });

  const postcssResult = ensurePostcssConfig(projectRoot, options);

  return {
    ok: true,
    summary: {
      createdCount: created.length,
      skippedCount: skipped.length,
      postcssUpdated: postcssResult.updated,
    },
    created,
    skipped,
    postcss: postcssResult,
  };
}

/**
 * 确保目标项目存在 postcss.config.js 且包含 postcss-rtlcss 配置
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 处理结果
 */
function ensurePostcssConfig(projectRoot, options = {}) {
  const configPath = path.join(projectRoot, "postcss.config.js");

  if (!fs.existsSync(configPath)) {
    const templatePath = path.join(TEMPLATE_DIR, "postcss.config.js");
    const content = fs.readFileSync(templatePath, "utf8");
    fs.writeFileSync(configPath, content, "utf8");
    return { updated: true, action: "created" };
  }

  const content = fs.readFileSync(configPath, "utf8");
  if (content.includes("postcss-rtlcss") && !options.force) {
    return { updated: false, action: "exists" };
  }

  const injected = injectPostcssRtlcss(content);
  fs.writeFileSync(configPath, injected, "utf8");
  return { updated: true, action: "injected" };
}

/**
 * 在已有 postcss.config.js 中注入 postcss-rtlcss 插件配置
 * 若已存在 postcss-rtlcss 配置块，先移除旧块再注入，避免重复 key
 * @param {string} content - 原始文件内容
 * @returns {string} 注入后的内容
 */
function injectPostcssRtlcss(content) {
  const rtlcssConfig = '    "postcss-rtlcss": {\n      enabled: true,\n      autoRename: true,\n      ignoreImportant: true,\n      processRoot: true,\n      processKeyFrames: false,\n      processUrls: false,\n    },';

  // 移除已存在的 postcss-rtlcss 配置块（支持单行和多行，含或不含引号的 key）
  let cleaned = content.replace(
    /,?\s*["']?postcss-rtlcss["']?\s*:\s*\{[^}]*\}\s*,?\n?/g,
    "\n",
  );
  // 清理因移除产生的多余空行和逗号
  cleaned = cleaned.replace(/,\s*\n\s*\n+/g, ",\n");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/\{\s*\n\s*\n+/g, "{\n");

  if (cleaned.includes("plugins:")) {
    return cleaned.replace(/(plugins:\s*\{)/, "$1\n" + rtlcssConfig);
  }

  return 'module.exports = {\n  plugins: {\n' + rtlcssConfig + "\n  },\n};\n";
}

module.exports = {
  scaffold,
  ensurePostcssConfig,
  TEMPLATE_FILES,
};
