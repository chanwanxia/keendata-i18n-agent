const fs = require("fs");
const path = require("path");

const TEMPLATE_DIR = path.join(__dirname, "templates");
const ACTION_COLUMN_WIDTH_HELPERS = `
    // 根据操作栏按钮文案自动计算 kd-column-action 宽度
    getActionColumnWidth(btnList = []) {
      const buttons = Array.isArray(btnList) ? btnList : [];
      const font = "12px PingFang SC, Microsoft YaHei, Arial, sans-serif";
      const buttonGap = 8;
      const cellPadding = 32;
      const dropdownIconWidth = 24;
      const fallbackLabelWidth = 48;
      const safetyWidth = 12;
      let contentWidth = 0;
      let visibleCount = 0;
      let hasDropdown = false;

      buttons.forEach((item) => {
        if (!item || item.show === false) return;
        if (item.dropdown) {
          hasDropdown = true;
          return;
        }
        contentWidth += this.measureActionColumnTextWidth(
          this.getActionColumnLabel(item),
          font,
          fallbackLabelWidth,
        );
        visibleCount += 1;
      });

      if (hasDropdown) {
        contentWidth += dropdownIconWidth;
        visibleCount += 1;
      }

      const gapWidth = Math.max(visibleCount - 1, 0) * buttonGap;
      const width = Math.ceil(contentWidth + gapWidth + cellPadding + safetyWidth);
      return \`\${ width }px\`;
    },

    // 获取操作栏按钮用于宽度测量的文案，函数型 label 无法安全取值时使用兜底宽度
    getActionColumnLabel(item) {
      if (item.autoWidthLabel) return item.autoWidthLabel;
      if (typeof item.label !== "function") return item.label || "";
      try {
        return item.label(null, item) || "";
      } catch (error) {
        return "";
      }
    },

    // 使用 canvas 测量操作栏按钮文案宽度，非浏览器环境或空文案使用兜底宽度
    measureActionColumnTextWidth(label, font, fallbackWidth) {
      const text = String(label || "");
      if (!text) return fallbackWidth;
      if (typeof document === "undefined") return text.length * 12;
      if (!this.__actionColumnMeasureCanvas) {
        this.__actionColumnMeasureCanvas = document.createElement("canvas");
      }
      const context = this.__actionColumnMeasureCanvas.getContext("2d");
      if (!context) return fallbackWidth;
      context.font = font;
      return Math.ceil(context.measureText(text).width);
    },
`;

/**
 * 模板文件映射表：模板相对路径 -> 目标相对路径
 */
const TEMPLATE_FILES = [
  { template: "languages/index.js", target: "src/languages/index.js", transform: true },
  { template: "languages/storage.js", target: "src/languages/storage.js" },
  { template: "languages/settings.json", target: "src/languages/settings.json" },
  { template: "languages/translates/default.json", target: "src/languages/translates/default.json", noOverwrite: true },
  // noOverwrite: true 表示即使 force=true 也不覆盖（保护用户数据和提取结果）
  { template: "languages/formatters/zh.js", target: "src/languages/formatters/zh.js" },
  { template: "languages/formatters/en.js", target: "src/languages/formatters/en.js" },
  { template: "languages/formatters/jp.js", target: "src/languages/formatters/jp.js" },
  { template: "languages/formatters/ar.js", target: "src/languages/formatters/ar.js" },
  { template: "mixins/i18n-mixin.js", target: "src/mixins/i18n-mixin.js" },
  { template: "utils/i18n.js", target: "src/utils/i18n.js" },
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
  const cleanupResult = cleanupLegacyFiles(projectRoot);
  const actionColumnWidthResult = ensureActionColumnWidthHelper(projectRoot);

 return {
   ok: true,
   summary: {
     createdCount: created.length,
     skippedCount: skipped.length,
     postcssUpdated: postcssResult.updated,
     legacyCleaned: cleanupResult.cleaned,
     actionColumnWidthUpdated: actionColumnWidthResult.updated,
   },
   created,
   skipped,
   postcss: postcssResult,
   cleanup: cleanupResult,
   actionColumnWidth: actionColumnWidthResult,
 };
}

/**
 * 确保既有 i18n-mixin.js 也包含 kd-column-action 自动宽度 helper
 * @param {string} projectRoot - 目标项目根路径
 * @returns {object} 更新结果 { updated: boolean, message?: string }
 */
function ensureActionColumnWidthHelper(projectRoot) {
  const mixinPath = path.join(projectRoot, "src/mixins/i18n-mixin.js");
  if (!fs.existsSync(mixinPath)) {
    return { updated: false, message: "src/mixins/i18n-mixin.js 不存在" };
  }

  const content = fs.readFileSync(mixinPath, "utf8");
  if (content.includes("getActionColumnWidth")) {
    return { updated: false, message: "操作栏宽度 helper 已存在" };
  }

  const displayNameMarker = '\n\n    // "中文名称"接入配置';
  const methodsEndMarker = "\n  },\n};";
  let updatedContent = "";
  if (content.includes(displayNameMarker)) {
    updatedContent = content.replace(
      displayNameMarker,
      `${ACTION_COLUMN_WIDTH_HELPERS}${displayNameMarker}`,
    );
  } else if (content.includes(methodsEndMarker)) {
    updatedContent = content.replace(
      methodsEndMarker,
      `${ACTION_COLUMN_WIDTH_HELPERS}${methodsEndMarker}`,
    );
  } else {
    return { updated: false, message: "未找到可插入 helper 的 methods 位置" };
  }

  fs.writeFileSync(mixinPath, updatedContent, "utf8");
  return { updated: true };
}

/**
 * 清理旧版遗留文件：languages/i18n-plugin 目录和 mixins/i18n-width-mixin.js
 * 这些文件已合并为 mixins/i18n-mixin.js，不再需要单独存在
 * @param {string} projectRoot - 目标项目根路径
 * @returns {object} 清理结果 { cleaned: string[] }
 */
function cleanupLegacyFiles(projectRoot) {
  const cleaned = [];

  // 删除旧的 i18n-plugin 目录
  const i18nPluginDir = path.join(projectRoot, "src/languages/i18n-plugin");
  if (fs.existsSync(i18nPluginDir)) {
    fs.rmSync(i18nPluginDir, { recursive: true, force: true });
    cleaned.push("src/languages/i18n-plugin/");
  }

  // 删除旧的 i18n-width-mixin.js
  const widthMixinPath = path.join(projectRoot, "src/mixins/i18n-width-mixin.js");
  if (fs.existsSync(widthMixinPath)) {
    fs.unlinkSync(widthMixinPath);
    cleaned.push("src/mixins/i18n-width-mixin.js");
  }

  return { cleaned };
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
  ensureActionColumnWidthHelper,
  cleanupLegacyFiles,
  TEMPLATE_FILES,
};
