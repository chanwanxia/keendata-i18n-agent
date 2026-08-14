const fs = require("fs");
const path = require("path");
const { getPresetById, getDefaultPreset } = require("./presets");

/**
 * 检查项目 i18n 基建完整性，未命中 preset 时回退到默认 preset 规则
 * @param {string} projectRoot - 项目根路径
 * @param {object} profile - 项目画像
 * @param {object} config - i18n 配置
 * @returns {object} doctor 报告
 */
function inspectProjectSetup(projectRoot, profile, config) {
  const matchedPreset = profile.preset ? getPresetById(profile.preset.id) : null;
  const preset = matchedPreset || getDefaultPreset();
  const checks = [];

  if (!matchedPreset) {
    checks.push(createCheck("preset", "warn", "未命中内置 preset，已回退到默认规则继续检查"));
  } else {
    checks.push(createCheck("preset", "pass", `命中 preset: ${matchedPreset.id}`));
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
  checkAcceptLanguage(projectRoot, networkRules),
);
checks.push(checkComponentLocale(projectRoot, bootstrapRules));
checks.push(checkRouteTitle(projectRoot, routeTitleRules));
 checks.push(checkDependencies(projectRoot));
 checks.push(checkScripts(projectRoot));
 checks.push(checkGlobalCli());
 checks.push(checkPostcssConfig(projectRoot));

 checks.push(checkKdComponentsVersion(projectRoot));
 checks.push(checkLayoutHeaderLanguageSwitcher(projectRoot));
 checks.push(checkElementuiUtils(projectRoot, bootstrapRules));

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
    return createCheck("bootstrap-main", "fail", `缺少入口文件 ${mainFile || "src/main.js"}`, {
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
    return createCheck("bootstrap-main", "fail", "入口文件缺少部分 i18n 基建", {
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
    return createCheck("webpack-loader", "fail", "未找到 vue.config.js，无法检查 voerkai18n-loader", {
      suggestion: "如果是 Vue CLI 项目，请新增 vue.config.js 并配置 voerkai18n-loader",
    });
  }

  const content = fs.readFileSync(vueConfigFile, "utf8");
  if (!content.includes("voerkai18n-loader")) {
    return createCheck("webpack-loader", "fail", "vue.config.js 未配置 voerkai18n-loader", {
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
    return createCheck("style-imports", "fail", "入口文件缺少国际化样式引入", {
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
    return createCheck("route-title", "fail", "未配置路由标题规则", {
      suggestion: "在 preset 中声明 App.vue 或等价入口中的标题处理规则",
    });
  }

  const filePath = path.join(projectRoot, routeTitleRules.file);
  if (!fs.existsSync(filePath)) {
    return createCheck("route-title", "fail", `未找到路由标题文件 ${routeTitleRules.file}`, {
      suggestion: "确认 App.vue 或路由壳组件路径，并在其中使用 t(route.meta.title)",
    });
  }

 const content = fs.readFileSync(filePath, "utf8");
 if (
   routeTitleRules.translateMetaTitle &&
    /document\.title/.test(content) &&
    /\bt\(\s*[^)]*meta\??\.title/.test(content)
 ) {
   return createCheck("route-title", "pass", "检测到路由标题国际化处理");
 }

  return createCheck("route-title", "fail", "未检测到明显的路由标题国际化处理", {
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
    return createCheck(id, "fail", `未配置${label}文件`);
  }

  const filePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    return createCheck(id, "fail", `缺少${label}文件: ${relativePath}`);
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (!pattern.test(content)) {
    return createCheck(id, "fail", `${label}存在，但未检测到关键标记`);
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
   return createCheck("dependencies", "fail", `缺少依赖: ${missing.join(", ")}`, {
     suggestion: "执行 inject 或手动安装缺失的依赖",
   });
 }
 // @kd/components 版本检查
 if (!allDeps["@kd/components"]) {
   return createCheck("dependencies", "fail", "缺少 @kd/components 依赖", {
     suggestion: "安装 @kd/components v5+: pnpm add @kd/components@^5",
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
    return createCheck("scripts", "fail", `缺少脚本: ${missing.join(", ")}`);
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
  // voerkai18n --version 输出含 ANSI 颜色码，需先剥离再匹配版本号
  const rawOutput = result.stdout || "";
  const output = rawOutput.replace(/\x1b\[[0-9;]*m/g, "");
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
/**
 * 检查 Accept-Language 请求头注入，先检查 preset 配置的文件，再搜索 src/utils/ 下所有 .js 文件
 * @param {string} projectRoot - 项目根路径
 * @param {object} networkRules - 网络规则
 * @returns {object} 检查结果
 */
function checkAcceptLanguage(projectRoot, networkRules) {
  // 先检查 preset 配置的文件
  if (networkRules.file) {
    const filePath = path.join(projectRoot, networkRules.file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      if (/Accept-Language/.test(content) && hasI18nScopeRef(content)) {
        return createCheck("accept-language", "pass", "请求头 Accept-Language 映射检查通过");
      }
    }
  }
  // 搜索 src/utils/ 下所有 .js 文件
  const utilsDir = path.join(projectRoot, "src/utils");
  if (fs.existsSync(utilsDir)) {
    const files = fs.readdirSync(utilsDir).filter((f) => f.endsWith(".js"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(utilsDir, file), "utf8");
      if (/Accept-Language/.test(content) && hasI18nScopeRef(content)) {
        return createCheck("accept-language", "pass", `请求头 Accept-Language 映射检查通过 (在 ${file} 中检测到)`);
      }
    }
  }
  return createCheck("accept-language", "fail", "未检测到 Accept-Language 请求头注入", {
    suggestion: "执行 inject 或手动在请求拦截器中注入 Accept-Language header",
  });
}

/**
 * 判断文件内容是否引用了 i18n scope 或语言状态，确认 Accept-Language 来自 i18n 注入而非模板自带
 * @param {string} content - 文件内容
 * @returns {boolean} 是否引用了 i18n scope
 */
function hasI18nScopeRef(content) {
  return /@\/languages|i18nScope|activeLanguage|getLanguage|\.language\b/.test(content);
}

/**
 * 检查组件库 locale 适配文件是否存在且包含 locale 引入
 * @param {string} projectRoot - 项目根路径
 * @param {object} bootstrapRules - 基建规则
 * @returns {object} 检查结果
 */
function checkComponentLocale(projectRoot, bootstrapRules) {
  const relativePath = bootstrapRules.componentLocaleFile;
  if (!relativePath) {
    return createCheck("component-locale", "fail", "未配置组件库 locale 适配文件");
  }
  const filePath = path.join(projectRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    return createCheck("component-locale", "fail", `缺少组件库 locale 适配文件: ${relativePath}`, {
      suggestion: `执行 scaffold 或手动创建 ${relativePath}`,
    });
  }
  const content = fs.readFileSync(filePath, "utf8");
  if (!/locale|lang/i.test(content)) {
    return createCheck("component-locale", "fail", `${relativePath} 存在，但未检测到 locale 引入`, {
      suggestion: `在 ${relativePath} 中引入 element-ui 和 @kd/components 的 locale 语言包`,
    });
  }
  return createCheck("component-locale", "pass", "组件库 locale 适配文件已包含 locale 引入");
}

function checkPostcssConfig(projectRoot) {
  const configPath = path.join(projectRoot, "postcss.config.js");
  if (!fs.existsSync(configPath)) {
    return createCheck("postcss-config", "fail", "缺少 postcss.config.js", {
      suggestion: "执行 scaffold 或手动创建 postcss.config.js 并配置 postcss-rtlcss",
    });
  }
  const content = fs.readFileSync(configPath, "utf8");
  if (!content.includes("postcss-rtlcss")) {
    return createCheck("postcss-config", "fail", "postcss.config.js 未配置 postcss-rtlcss");
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

/**
 * 检查 @kd/components 版本是否 >= 5.0.0（v5 起才有 dist/locale/lang/* 国际化文件）
 * @param {string} projectRoot - 项目根路径
 * @returns {object} 检查结果
 */
function checkKdComponentsVersion(projectRoot) {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return createCheck("kd-components-version", "fail", "package.json 不存在");
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const version =
    (pkg.dependencies && pkg.dependencies["@kd/components"]) ||
    (pkg.devDependencies && pkg.devDependencies["@kd/components"]);
  if (!version) {
    return createCheck("kd-components-version", "fail", "未检测到 @kd/components", {
      suggestion: "安装 @kd/components v5+: pnpm add @kd/components@^5",
    });
  }
  const match = version.match(/(\d+)\./);
  if (!match) {
    return createCheck("kd-components-version", "fail", `@kd/components 版本格式无法解析: ${version}`);
  }
  const major = parseInt(match[1], 10);
  if (major < 5) {
    return createCheck("kd-components-version", "fail", `@kd/components 版本 ${version} 过低，国际化 locale 需要 v5+`, {
      suggestion: "升级: pnpm add @kd/components@^5",
    });
  }
  return createCheck("kd-components-version", "pass", `@kd/components ${version}`);
}

/**
 * 检查 layout-header 组件是否注入了语言切换器（i18nMixin + kd-select）
 * @param {string} projectRoot - 项目根路径
 * @returns {object} 检查结果
 */
function checkLayoutHeaderLanguageSwitcher(projectRoot) {
  const defaultPath = path.join(projectRoot, "src/layout/layout-header/index.vue");
  let headerPath = defaultPath;

  if (!fs.existsSync(headerPath)) {
    // 搜索 src/layout/ 下含 right-box 的 .vue 文件
    const layoutDir = path.join(projectRoot, "src/layout");
    if (!fs.existsSync(layoutDir)) {
      return createCheck("layout-header-language", "fail", "src/layout 目录不存在");
    }
    const found = findHeaderFile(layoutDir);
    if (!found) {
      return createCheck("layout-header-language", "fail", "未找到 layout-header 组件");
    }
    headerPath = found;
  }

  const content = fs.readFileSync(headerPath, "utf8");
  const hasMixin = content.includes("i18nMixin");
  const hasSwitcher = content.includes("activeLanguage") || content.includes("changeLanguage");

  if (hasMixin && hasSwitcher) {
    return createCheck("layout-header-language", "pass", "layout-header 已注入语言切换器");
  }
  return createCheck("layout-header-language", "fail", "layout-header 缺少语言切换器或 i18nMixin", {
    suggestion: "执行 inject 或手动注入 i18nMixin 和 kd-select 语言切换器",
  });
}

/**
 * 递归搜索 layout 目录下包含 right-box class 的 .vue 文件
 * @param {string} dir - 搜索目录
 * @returns {string|null} 文件路径或 null
 */
function findHeaderFile(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findHeaderFile(fullPath);
      if (found) return found;
    } else if (entry.name.endsWith(".vue")) {
      const content = fs.readFileSync(fullPath, "utf8");
      if (content.includes("right-box")) {
        return fullPath;
      }
    }
  }
  return null;
}

/**
 * 检查 elementui-utils.js 是否存在且包含 @kd/components locale 引入
 * @param {string} projectRoot - 项目根路径
 * @param {object} bootstrapRules - 基建规则
 * @returns {object} 检查结果
 */
function checkElementuiUtils(projectRoot, bootstrapRules) {
  const filePath = path.join(projectRoot, bootstrapRules.componentLocaleFile || "src/utils/elementui-utils.js");
  if (!fs.existsSync(filePath)) {
    return createCheck("elementui-utils", "fail", "缺少 elementui-utils.js 组件 locale 适配文件", {
      suggestion: "执行 scaffold 或手动创建 src/utils/elementui-utils.js",
    });
  }
  const content = fs.readFileSync(filePath, "utf8");
  if (!content.includes("@kd/components/dist/locale")) {
    return createCheck("elementui-utils", "fail", "elementui-utils.js 未引入 @kd/components locale", {
      suggestion: "在 elementui-utils.js 中引入 @kd/components 的 locale 语言包",
    });
  }
  return createCheck("elementui-utils", "pass", "elementui-utils.js 检查通过");
}

module.exports = {
  inspectProjectSetup,
};
