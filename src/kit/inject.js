const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const { runShellCommand } = require("./shell");

const JS_PARSE_PLUGINS = [
  "jsx",
  "classProperties",
  "decorators-legacy",
  "objectRestSpread",
  "optionalChaining",
  "nullishCoalescingOperator",
  "dynamicImport",
  "topLevelAwait",
  "typescript",
];

/**
 * 依赖注入清单：dependencies / devDependencies / scripts
 */
const REQUIRED_DEPS = {
  dependencies: {
    "@voerkai18n/runtime": "^2.1.13",
    "@voerkai18n/vue2": "^2.1.13",
  },
  devDependencies: {
    "@voerkai18n/cli": "^2.1.13",
    "voerkai18n-loader": "^2.1.13",
    postcss: "^8.5.14",
    "postcss-rtlcss": "^6.0.0",
    "postcss-html": "^1.8.1",
    "postcss-scss": "^4.0.9",
  },
  scripts: {
    "i18n:extract": "voerkai18n extract -D && prettier --write src/languages/*.*",
    "i18n:compile": "voerkai18n compile && prettier --write src/languages/*.*",
  },
};

/**
 * 执行全部注入：package.json 依赖、main.js、vue.config.js、App.vue、interceptors
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} profile - 项目画像
 * @param {object} config - i18n 配置
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 注入报告
 */
function inject(projectRoot, profile, config, options = {}) {
  const results = {
    packageJson: injectPackageJson(projectRoot, options),
    mainJs: injectMainJs(projectRoot, options),
    vueConfig: injectVueConfig(projectRoot, options),
    appVue: injectAppVue(projectRoot, options),
    interceptors: injectAcceptLanguage(projectRoot, options),
  };

  return {
    ok: true,
    summary: {
      packageJsonUpdated: results.packageJson.updated,
      mainJsUpdated: results.mainJs.updated,
      vueConfigUpdated: results.vueConfig.updated,
      appVueUpdated: results.appVue.updated,
      interceptorsUpdated: results.interceptors.updated,
    },
    details: results,
  };
}

/**
 * 检查全局 voerkai18n CLI 版本是否为 2.1.x
 * @returns {object} { ok, version, message }
 */
function checkGlobalCliVersion() {
  const result = require("child_process").spawnSync("voerkai18n", ["--version"], {
    encoding: "utf8",
    shell: true,
    timeout: 10000,
  });

  const output = result.stdout || "";
  // voerkai18n --version 输出含 ANSI 颜色码，需先剥离再匹配版本号
  const stripped = output.replace(/\x1b\[[0-9;]*m/g, "");
  const match = stripped.match(/installed:\s*(\d+\.\d+\.\d+)/);

  if (!match) {
    return {
      ok: false,
      version: null,
      message: "未检测到全局 voerkai18n，请执行: pnpm add -g @voerkai18n/cli@2.1.13",
    };
  }

  const version = match[1];
  const major = parseInt(version.split(".")[0], 10);

  if (major === 3) {
    return {
      ok: false,
      version,
      message: `检测到 voerkai18n v${version}，与当前工具链不兼容，请降级: pnpm add -g @voerkai18n/cli@2.1.13`,
    };
  }

  if (major === 2 && version.startsWith("2.1.")) {
    return { ok: true, version, message: `voerkai18n v${version} 版本兼容` };
  }

  return {
    ok: false,
    version,
    message: `voerkai18n v${version} 版本不兼容，请安装: pnpm add -g @voerkai18n/cli@2.1.13`,
  };
}

/**
 * 向目标项目 package.json 注入依赖和脚本
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 注入结果
 */
function injectPackageJson(projectRoot, options = {}) {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { updated: false, message: "package.json 不存在" };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const added = [];

  /**
   * 检查依赖是否已存在于另一个 section 中，避免重复添加
   * @param {string} name - 依赖名
   * @param {string} currentSection - 当前要写入的 section
   * @returns {boolean} 是否已存在于另一个 section
   */
  function existsInOtherSection(name, currentSection) {
    const otherSection =
      currentSection === "dependencies" ? "devDependencies" : "dependencies";
    return Boolean(
      pkg[otherSection] && pkg[otherSection][name]
    );
  }

  ["dependencies", "devDependencies", "scripts"].forEach((section) => {
    if (!pkg[section]) pkg[section] = {};
    Object.entries(REQUIRED_DEPS[section]).forEach(([name, value]) => {
      // scripts 不做跨 section 去重；依赖项若已在另一 section 中则跳过
      if (section !== "scripts" && existsInOtherSection(name, section)) {
        return;
      }
      if (!pkg[section][name] || (options.force && pkg[section][name] !== value)) {
        pkg[section][name] = value;
        added.push(`${section}.${name}`);
      }
    });
  });

  if (added.length === 0) {
    return { updated: false, added: [] };
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  return { updated: true, added };
}

/**
 * 用 AST 向 main.js 注入 i18n 相关 import 和 Vue.use/Vue.mixin 调用
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 注入结果
 */
function injectMainJs(projectRoot, options = {}) {
  const mainPath = path.join(projectRoot, "src/main.js");
  if (!fs.existsSync(mainPath)) {
    return { updated: false, message: "src/main.js 不存在" };
  }

  let source = fs.readFileSync(mainPath, "utf8");

  if (source.includes('i18nPlugin') && !options.force) {
    return { updated: false, message: "main.js 已包含 i18n 注入" };
  }

  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: "unambiguous",
      plugins: JS_PARSE_PLUGINS,
    });
  } catch (error) {
    return { updated: false, message: `main.js 解析失败: ${error.message}` };
  }

  const importsToAdd = [
    'import { i18nScope } from "@/languages";',
    'import { i18nPlugin } from "@voerkai18n/vue2";',
    'import { i18nWidthMixin } from "@/mixins/i18n-width-mixin";',
    'require("@/styles/i18n-style.scss");',
  ];

  let lastImportIndex = -1;
  let vueUseNode = null;

  traverse(ast, {
    ImportDeclaration(pathRef) {
      lastImportIndex = Math.max(lastImportIndex, pathRef.node.end);
    },
    ExpressionStatement(pathRef) {
      const expr = pathRef.node.expression;
      if (
        t.isCallExpression(expr) &&
        t.isMemberExpression(expr.callee) &&
        t.isIdentifier(expr.callee.object, { name: "Vue" }) &&
        t.isIdentifier(expr.callee.property, { name: "use" })
      ) {
        vueUseNode = pathRef;
      }
    },
  });

  const importNodes = importsToAdd.map((stmt) => {
    return parser.parse(stmt, { sourceType: "module" }).program.body[0];
  });

  if (vueUseNode) {
    const pluginCall = t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier("Vue"), t.identifier("use")),
        [t.identifier("i18nPlugin"), t.objectExpression([t.objectProperty(t.identifier("i18nScope"), t.identifier("i18nScope"))])]
      )
    );
    const mixinCall = t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier("Vue"), t.identifier("mixin")),
        [t.identifier("i18nWidthMixin")]
      )
    );
    vueUseNode.insertAfter(mixinCall);
    vueUseNode.insertAfter(pluginCall);
  }

  if (lastImportIndex >= 0) {
    importNodes.forEach((node, i) => {
      const inserted = t.cloneNode(node);
      if (i === 0) {
        ast.program.body.splice(findInsertPosition(ast.program.body, lastImportIndex), 0, inserted);
      } else {
        ast.program.body.splice(findInsertPosition(ast.program.body, lastImportIndex) + i, 0, t.cloneNode(node));
      }
    });
  } else {
    importNodes.reverse().forEach((node) => {
      ast.program.body.unshift(t.cloneNode(node));
    });
  }

  let output = generate(ast, {
    retainLines: true,
    comments: true,
    jsescOption: { minimal: true },
  }).code;

  source = replaceOldVueI18n(source, output);
  fs.writeFileSync(mainPath, output, "utf8");
  return { updated: true };
}

/**
 * 查找插入 import 的位置索引
 * @param {array} body - AST program body
 * @param {number} endPos - 最后一个 import 的 end 位置
 * @returns {number} 插入位置索引
 */
function findInsertPosition(body, endPos) {
  for (let i = 0; i < body.length; i++) {
    if (body[i].start >= endPos) {
      return i;
    }
  }
  return body.length;
}

/**
 * 替换旧的 vue-i18n 引入为新的 elementui-utils 引入
 * @param {string} original - 原始源码
 * @param {string} output - AST 生成后的源码
 * @returns {string} 处理后的源码
 */
function replaceOldVueI18n(original, output) {
  let result = output;

  const oldPatterns = [
    /import\s+i18n\s+from\s+["']@\/assets\/lang\/index["'];?/g,
    /import\s+i18n\s+from\s+["'][^"']*lang[^"']*["'];?/g,
  ];

  oldPatterns.forEach((pattern) => {
    if (pattern.test(result)) {
      result = result.replace(pattern, 'import { i18n } from "@/utils/elementui-utils";');
    }
  });

  return result;
}

/**
 * 向 vue.config.js 注入 voerkai18n-loader 规则
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 注入结果
 */
function injectVueConfig(projectRoot, options = {}) {
  const configPath = path.join(projectRoot, "vue.config.js");
  if (!fs.existsSync(configPath)) {
    return { updated: false, message: "vue.config.js 不存在" };
  }

  let content = fs.readFileSync(configPath, "utf8");

  if (content.includes("voerkai18n-loader") && !options.force) {
    return { updated: false, message: "vue.config.js 已包含 voerkai18n-loader" };
  }

  const loaderRule = `
        {
          test: /\\.(js|vue)$/,
          use: [
            {
              loader: "voerkai18n-loader",
              options: {
                autoImport: true,
                debug: false,
              },
            },
          ],
          include: path.join(__dirname, "src"),
          enforce: "pre",
        },`;

  if (content.includes("module:") && content.includes("rules:")) {
    content = content.replace(/(rules:\s*\[)/, "$1" + loaderRule);
  } else if (content.includes("configureWebpack")) {
    content = content.replace(
      /(configureWebpack:\s*\{)/,
      "$1\n    module: {\n      rules: [" + loaderRule + "\n      ],\n    },"
    );
  } else {
    content = content.replace(
      /(\};)/,
      "  configureWebpack: {\n    module: {\n      rules: [" + loaderRule + "\n      ],\n    },\n  },\n$1"
    );
  }

  fs.writeFileSync(configPath, content, "utf8");
  return { updated: true };
}

/**
 * 向 App.vue 注入 i18nMixin 和路由标题逻辑
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 注入结果
 */
function injectAppVue(projectRoot, options = {}) {
  const appPath = path.join(projectRoot, "src/App.vue");
  if (!fs.existsSync(appPath)) {
    return { updated: false, message: "src/App.vue 不存在" };
  }

  let content = fs.readFileSync(appPath, "utf8");

  if (content.includes("i18nMixin") && !options.force) {
    return { updated: false, message: "App.vue 已包含 i18nMixin" };
  }

  const mixinImport = 'import { i18nMixin } from "@/languages/i18n-plugin/i18nMixin";';

  content = content.replace(
    /(<script[^>]*>)/,
    "$1\n" + mixinImport
  );

  if (content.includes("mixins:")) {
    content = content.replace(/(mixins:\s*\[)/, "$1i18nMixin(), ");
  } else {
    content = content.replace(/(export\s+default\s*\{)/, "$1\n  mixins: [i18nMixin()],");
  }

  if (!content.includes("document.title")) {
    const routeWatchPattern = /(\$route:\s*\{[\s\S]*?handler\s*\([^)]*\)\s*\{)/;
    if (routeWatchPattern.test(content)) {
      const titleLogic = `
        const subTitle = this.t(route?.meta?.title ?? "通用配置");
        const prefix = this.t(this.tabPrefix) || this.t("数据中台");
        document.title = subTitle ? \`\${subTitle} - \${prefix}\` : prefix;
`;
      content = content.replace(routeWatchPattern, "$1" + titleLogic);
    }
  }

  fs.writeFileSync(appPath, content, "utf8");
  return { updated: true };
}

/**
 * 在请求拦截器中注入 Accept-Language 和 X-Timezone header
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 注入结果
 */
function injectAcceptLanguage(projectRoot, options = {}) {
  const utilsDir = path.join(projectRoot, "src/utils");
  if (!fs.existsSync(utilsDir)) {
    return { updated: false, message: "src/utils 目录不存在" };
  }

  const files = fs.readdirSync(utilsDir).filter((f) => f.endsWith(".js"));
  let injected = false;

  for (const file of files) {
    const filePath = path.join(utilsDir, file);
    const content = fs.readFileSync(filePath, "utf8");

    if (!content.includes("interceptors.request.use")) continue;
    if (content.includes("Accept-Language") && !options.force) continue;

    const headerInjection = `
  const languageMap = { zh: "zh-CN", en: "en-US", jp: "ja-JP", ar: "ar" };
  config.headers["Accept-Language"] = languageMap[localStorage.getItem("language") || "zh"];
  config.headers["X-Timezone"] = localStorage.getItem("i18n-tz") || "";`;

    // 匹配 interceptors.request.use 后的第一个回调（成功处理器）的开括号 {
    // 支持 (config) => { 和 function(config) { 两种写法
    // 不使用 [^,]+ 跳过到第二个回调，避免误注入到 error handler
    const interceptorPattern =
      /(interceptors\.request\.use\(\s*(?:\(([^)]*)\)\s*=>|function\s*\(([^)]*)\))\s*\{)/;

    const match = content.match(interceptorPattern);
    if (match) {
      const insertPos = match.index + match[0].length;
      const newContent =
        content.slice(0, insertPos) +
        headerInjection +
        content.slice(insertPos);
      fs.writeFileSync(filePath, newContent, "utf8");
      injected = true;
      return { updated: true, file: path.join("src/utils", file) };
    }
  }

  return { updated: false, message: "未找到合适的请求拦截器" };
}

module.exports = {
  inject,
  checkGlobalCliVersion,
  injectPackageJson,
  injectMainJs,
  injectVueConfig,
  injectAppVue,
  injectAcceptLanguage,
  REQUIRED_DEPS,
};
