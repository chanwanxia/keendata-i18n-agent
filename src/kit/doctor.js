const fs = require("fs");
const path = require("path");
const { getPresetById } = require("./presets");

/**
 * 按 preset 检查项目 i18n 基建完整性
 * @param {string} projectRoot - 项目根路径
 * @param {object} profile - 项目画像
 * @param {object} config - i18n 配置
 * @returns {object} doctor 报告
 */
function inspectProjectSetup(projectRoot, profile, config) {
  const preset = profile.preset ? getPresetById(profile.preset.id) : null;
  const checks = [];

  if (!preset) {
    checks.push(createCheck("preset", "warn", "未命中内置 preset，无法执行预设级基建检查"));
    return buildDoctorReport(projectRoot, profile, checks);
  }

  checks.push(checkFileExists(projectRoot, config.translationFile, "translation-file", "翻译源文件", {
    suggestion: `创建 ${config.translationFile} 并维护 default.json 词条源`,
  }));

  const bootstrapRules = preset.rules.bootstrap || {};
  const rtlRules = preset.rules.rtl || {};
  const networkRules = preset.rules.network || {};
  const routeTitleRules = preset.rules.routeTitle || {};
  const widthRules = preset.rules.widthAdaptation || {};

  checks.push(checkMainBootstrap(projectRoot, bootstrapRules));
  checks.push(checkWebpackLoader(projectRoot));
  checks.push(checkStyleImports(projectRoot, bootstrapRules));
  checks.push(
    checkFileContains(
      projectRoot,
      rtlRules.mixinFile,
      /document\.documentElement\.(?:dir|setAttribute\(\s*["']dir["'])/,
      "rtl-mixin",
      "RTL mixin 设置了 dir",
    ),
  );
  checks.push(checkFileExists(projectRoot, rtlRules.styleFile, "rtl-style", "RTL 样式文件"));
  checks.push(checkFileContains(projectRoot, widthRules.file, /getI18nWidth/, "width-adaptation", "宽度适配 helper"));
  checks.push(
    checkFileContains(projectRoot, networkRules.file, /Accept-Language/, "accept-language", "请求头 Accept-Language 映射"),
  );
  checks.push(checkFileExists(projectRoot, bootstrapRules.componentLocaleFile, "component-locale", "组件库 locale 适配文件"));
  checks.push(checkRouteTitle(projectRoot, routeTitleRules));
  checks.push(checkDependencies(projectRoot));
  checks.push(checkScripts(projectRoot));
  checks.push(checkGlobalCli());
  checks.push(checkPostcssConfig(projectRoot));

  return buildDoctorReport(projectRoot, profile, checks);
}

/**
 * 检查入口文件 main.js 的 i18n 基建注入情况
 * @param {string} projectRoot - 项目根路径
 * @param {object} bootstrapRules - 基建规则
 * @returns {object} 检查结果
 */
function checkMainBootstrap(projectRoot, bootstrapRules) {
  const mainFile = bootstrapRules.mainFile;
  const filePath = path.join(projectRoot, mainFile || "");
  if (!mainFile || !fs.existsSync(filePath)) {
    return createCheck("bootstrap-main", "warn", `缺少入口文件 ${mainFile || "src/main.js"}`, {
      suggestion: "补齐入口文件，并注入 i18n plugin、scope、width mixin 与样式导入",
    });
  }

  const content = fs.readFileSync(filePath, "utf8");
  const missing = [];

  if (bootstrapRules.scopeImport && !content.includes(bootstrapRules.scopeImport)) missing.push(`import ${bootstrapRules.scopeImport}`);
  if (bootstrapRules.pluginPackage && !content.includes(bootstrapRules.pluginPackage)) missing.push(`import ${bootstrapRules.pluginPackage}`);
  if (bootstrapRules.widthMixinImport && !content.includes(bootstrapRules.widthMixinImport)) {
    missing.push(`import ${bootstrapRules.widthMixinImport}`);
  }
  if (bootstrapRules.pluginSymbol && !content.includes(`Vue.use(${bootstrapRules.pluginSymbol}`)) {
    missing.push(`Vue.use(${bootstrapRules.pluginSymbol}, { ${bootstrapRules.scopeSymbol} })`);
  }
  if (bootstrapRules.widthMixinSymbol && !content.includes(`Vue.mixin(${bootstrapRules.widthMixinSymbol})`)) {
    missing.push(`Vue.mixin(${bootstrapRules.widthMixinSymbol})`);
  }

  if (missing.length > 0) {
    return createCheck("bootstrap-main", "warn", "入口文件缺少部分 i18n 基建", {
      missing,
      suggestion: "按 preset 规则补齐 Vue.use(i18nPlugin)、Vue.mixin(i18nWidthMixin) 和相关 import",
    });
  }

  return createCheck("bootstrap-main", "pass", "入口文件已接入 i18n 基建");
}

/**
 * 检查 vue.config.js 中 voerkai18n-loader 的配置
 * @param {string} projectRoot - 项目根路径
 * @returns {object} 检查结果
 */
function checkWebpackLoader(projectRoot) {
  const vueConfigFile = path.join(projectRoot, "vue.config.js");
  if (!fs.existsSync(vueConfigFile)) {
    return createCheck("webpack-loader", "warn", "未找到 vue.config.js，无法检查 voerkai18n-loader", {
      suggestion: "如果是 Vue CLI 项目，请新增 vue.config.js 并配置 voerkai18n-loader",
    });
  }

  const content = fs.readFileSync(vueConfigFile, "utf8");
  if (!content.includes("voerkai18n-loader")) {
    return createCheck("webpack-loader", "warn", "vue.config.js 未配置 voerkai18n-loader", {
      suggestion: "在 configureWebpack.module.rules 中加入 voerkai18n-loader，并对 src 下 js/vue 生效",
    });
  }

  return createCheck("webpack-loader", "pass", "已检测到 voerkai18n-loader 配置");
}

/**
 * 检查入口文件是否引入了国际化样式
 * @param {string} projectRoot - 项目根路径
 * @param {object} bootstrapRules - 基建规则
 * @returns {object} 检查结果
 */
function checkStyleImports(projectRoot, bootstrapRules) {
  const mainFile = bootstrapRules.mainFile;
  const filePath = path.join(projectRoot, mainFile || "");
  if (!mainFile || !fs.existsSync(filePath)) {
    return createCheck("style-imports", "fail", `缺少入口文件 ${mainFile || "src/main.js"}`, {
      suggestion: "先补齐入口文件，再引入 i18n-style.scss",
    });
  }

  const content = fs.readFileSync(filePath, "utf8");
  const missingImports = (bootstrapRules.styleImports || []).filter((item) => !content.includes(item));
  if (missingImports.length > 0) {
    return createCheck("style-imports", "warn", "入口文件缺少国际化样式引入", {
      missingImports,
      suggestion: "在入口文件中补充 require/import '@/styles/i18n-style.scss'",
    });
  }

  return createCheck("style-imports", "pass", "入口文件已引入国际化样式");
}

/**
 * 检查路由标题国际化处理
 * @param {string} projectRoot - 项目根路径
 * @param {object} routeTitleRules - 路由标题规则
 * @returns {object} 检查结果
 */
function checkRouteTitle(projectRoot, routeTitleRules) {
  if (!routeTitleRules.file) {
    return createCheck("route-title", "warn", "未配置路由标题规则", {
      suggestion: "在 preset 中声明 App.vue 或等价入口中的标题处理规则",
    });
  }

  const filePath = path.join(projectRoot, routeTitleRules.file);
  if (!fs.existsSync(filePath)) {
    return createCheck("route-title", "warn", `未找到路由标题文件 ${routeTitleRules.file}`, {
      suggestion: "确认 App.vue 或路由壳组件路径，并在其中使用 t(route.meta.title)",
    });
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (
    routeTitleRules.translateMetaTitle &&
    /meta\??\.title/.test(content) &&
    /(this\.)?t\(/.test(content) &&
    /document\.title/.test(content)
  ) {
    return createCheck("route-title", "pass", "检测到路由标题国际化处理");
  }

  return createCheck("route-title", "warn", "未检测到明显的路由标题国际化处理", {
    suggestion: "在路由切换处用 t(route.meta.title) 组装 document.title",
  });
}

/**
 * 检查指定文件是否存在
 * @param {string} projectRoot - 项目根路径
 * @param {string} relativePath - 相对路径
 * @param {string} id - 检查项 ID
 * @param {string} label - 检查项标签
 * @param {object} extra - 额外信息
 * @returns {object} 检查结果
 */
function checkFileExists(projectRoot, relativePath, id, label, extra = {}) {
  const exists = relativePath && fs.existsSync(path.join(projectRoot, relativePath));
  if (!exists) {
    return createCheck(id, "fail", `缺少${label}: ${relativePath}`, extra);
  }
  return createCheck(id, "pass", `已找到${label}`);
}

/**
 * 检查指定文件是否包含特定内容
 * @param {string} projectRoot - 项目根路径
 * @param {string} relativePath - 相对路径
 * @param {RegExp} pattern - 匹配模式
 * @param {string} id - 检查项 ID
 * @param {string} label - 检查项标签
 * @returns {object} 检查结果
 */
function checkFileContains(projectRoot, relativePath, pattern, id, label) {
  if (!relativePath) {
    return createCheck(id, "warn", `未配置${label}文件`);
  }

  const filePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    return createCheck(id, "fail", `缺少${label}文件: ${relativePath}`);
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (!pattern.test(content)) {
    return createCheck(id, "warn", `${label}存在，但未检测到关键标记`);
  }

  return createCheck(id, "pass", `${label}检查通过`);
}


/**
 * 检查 package.json 是否包含必要的 i18n 依赖
 * @param {string} projectRoot - 项目根路径
 * @returns {object} 检查结果
 */
function checkDependencies(projectRoot) {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return createCheck("dependencies", "fail", "package.json 不存在");
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const required = ["@voerkai18n/runtime", "@voerkai18n/vue2", "@voerkai18n/cli", "voerkai18n-loader", "postcss-rtlcss"];
  const missing = required.filter((dep) => !allDeps[dep]);
  if (missing.length > 0) {
    return createCheck("dependencies", "warn", `缺少依赖: ${missing.join(", ")}`, {
      suggestion: "执行 inject 或手动安装缺失的依赖",
    });
  }
  return createCheck("dependencies", "pass", "i18n 依赖完整");
}

/**
 * 检查 package.json 是否包含 i18n 脚本
 * @param {string} projectRoot - 项目根路径
 * @returns {object} 检查结果
 */
function checkScripts(projectRoot) {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return createCheck("scripts", "fail", "package.json 不存在");
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const scripts = pkg.scripts || {};
  const missing = [];
  if (!scripts["i18n:extract"]) missing.push("i18n:extract");
  if (!scripts["i18n:compile"]) missing.push("i18n:compile");
  if (missing.length > 0) {
    return createCheck("scripts", "warn", `缺少脚本: ${missing.join(", ")}`);
  }
  return createCheck("scripts", "pass", "i18n 脚本完整");
}

/**
 * 检查全局 voerkai18n CLI 版本
 * @returns {object} 检查结果
 */
function checkGlobalCli() {
  const { spawnSync } = require("child_process");
  const result = spawnSync("voerkai18n", ["--version"], { encoding: "utf8", shell: true, timeout: 10000 });
  const output = result.stdout || "";
  const match = output.match(/installed:\s*(\d+\.\d+\.\d+)/);
  if (!match) {
    return createCheck("global-cli", "fail", "未检测到全局 voerkai18n", {
      suggestion: "执行: pnpm add -g @voerkai18n/cli@2.1.13",
    });
  }
  const version = match[1];
  if (version.startsWith("2.1.")) {
    return createCheck("global-cli", "pass", `voerkai18n v${version}`);
  }
  return createCheck("global-cli", "fail", `voerkai18n v${version} 不兼容`, {
    suggestion: "执行: pnpm add -g @voerkai18n/cli@2.1.13",
  });
}

/**
 * 检查 postcss.config.js 是否包含 postcss-rtlcss
 * @param {string} projectRoot - 项目根路径
 * @returns {object} 检查结果
 */
function checkPostcssConfig(projectRoot) {
  const configPath = path.join(projectRoot, "postcss.config.js");
  if (!fs.existsSync(configPath)) {
    return createCheck("postcss-config", "warn", "缺少 postcss.config.js", {
      suggestion: "执行 scaffold 或手动创建 postcss.config.js 并配置 postcss-rtlcss",
    });
  }
  const content = fs.readFileSync(configPath, "utf8");
  if (!content.includes("postcss-rtlcss")) {
    return createCheck("postcss-config", "warn", "postcss.config.js 未配置 postcss-rtlcss");
  }
  return createCheck("postcss-config", "pass", "postcss-rtlcss 已配置");
}

/**
 * 构建 doctor 检查报告
 * @param {string} projectRoot - 项目根路径
 * @param {object} profile - 项目画像
 * @param {array} checks - 检查项数组
 * @returns {object} 报告对象
 */
function buildDoctorReport(projectRoot, profile, checks) {
  const summary = {
    total: checks.length,
    passCount: checks.filter((item) => item.status === "pass").length,
    warnCount: checks.filter((item) => item.status === "warn").length,
    failCount: checks.filter((item) => item.status === "fail").length,
  };

  return {
    projectRoot,
    preset: profile.preset || null,
    ok: summary.failCount === 0,
    summary,
    checks,
  };
}

/**
 * 创建单个检查项对象
 * @param {string} id - 检查项 ID
 * @param {string} status - 状态 pass/warn/fail
 * @param {string} message - 消息
 * @param {object} extra - 额外字段
 * @returns {object} 检查项对象
 */
function createCheck(id, status, message, extra = {}) {
  return {
    id,
    status,
    message,
    ...extra,
  };
}

module.exports = {
  inspectProjectSetup,
};
