const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");

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
    "vue-i18n": "8.28.2",
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
    "i18n:extract":
      "voerkai18n extract -D && prettier --write src/languages/*.*",
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
    layoutHeader: injectLayoutHeader(projectRoot, options),
    kdComponentsVersion: checkKdComponentsVersion(projectRoot),
 };

  // 对被修改的文件统一执行 eslint --fix，修复注入引入的格式问题
  const { runEslintFix } = require("./eslint");
  const modifiedFiles = [];
  if (results.mainJs.updated) modifiedFiles.push("src/main.js");
  if (results.appVue.updated) modifiedFiles.push("src/App.vue");
  if (results.vueConfig.updated) modifiedFiles.push("vue.config.js");
 if (results.interceptors.updated && results.interceptors.file) {
   modifiedFiles.push(results.interceptors.file);
 }
 if (results.layoutHeader.updated && results.layoutHeader.file) {
   modifiedFiles.push(results.layoutHeader.file);
 }
 if (modifiedFiles.length > 0) {
    runEslintFix(projectRoot, modifiedFiles);
  }

  return {
    ok: true,
    summary: {
      packageJsonUpdated: results.packageJson.updated,
      mainJsUpdated: results.mainJs.updated,
      vueConfigUpdated: results.vueConfig.updated,
      appVueUpdated: results.appVue.updated,
     interceptorsUpdated: results.interceptors.updated,
     layoutHeaderUpdated: results.layoutHeader.updated,
     kdComponentsWarning: results.kdComponentsVersion || null,
   },
   details: results,
  };
}

/**
 * 检查全局 voerkai18n CLI 版本是否为 2.1.x
 * @returns {object} { ok, version, message }
 */
function checkGlobalCliVersion() {
  const result = require("child_process").spawnSync(
    "voerkai18n",
    ["--version"],
    {
      encoding: "utf8",
      shell: true,
      timeout: 10000,
    },
  );

  const output = result.stdout || "";
  // voerkai18n --version 输出含 ANSI 颜色码，需先剥离再匹配版本号
  const stripped = output.replace(/\x1b\[[0-9;]*m/g, "");
  const match = stripped.match(/installed:\s*(\d+\.\d+\.\d+)/);

  if (!match) {
    return {
      ok: false,
      version: null,
      message:
        "未检测到全局 voerkai18n，请执行: pnpm add -g @voerkai18n/cli@2.1.13",
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
    return Boolean(pkg[otherSection] && pkg[otherSection][name]);
  }

  ["dependencies", "devDependencies", "scripts"].forEach((section) => {
    if (!pkg[section]) pkg[section] = {};
    Object.entries(REQUIRED_DEPS[section]).forEach(([name, value]) => {
      // scripts 不做跨 section 去重；依赖项若已在另一 section 中则跳过
      if (section !== "scripts" && existsInOtherSection(name, section)) {
        return;
      }
      if (
        !pkg[section][name] ||
        (options.force && pkg[section][name] !== value)
      ) {
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
function injectMainJs(projectRoot, _options = {}) {
  const mainPath = path.join(projectRoot, "src/main.js");
  if (!fs.existsSync(mainPath)) {
    return { updated: false, message: "src/main.js 不存在" };
  }

  let source = fs.readFileSync(mainPath, "utf8");

  // 幂等性检查：已包含 i18nPlugin 时，仍需检查 i18n 实例导入是否完整
  if (source.includes("i18nPlugin")) {
    // 检查是否有 import { i18n } from "@/utils/elementui-utils"
    // 缺失时补充导入和 new Vue({ i18n }) 实例选项
    const i18nImportPattern = /import\s*\{\s*i18n\s*\}\s*from\s*["']@\/utils\/elementui-utils["'];?/;
    if (i18nImportPattern.test(source)) {
      return { updated: false, message: "main.js 已包含 i18n 注入" };
    }
    // 补充 i18n 实例导入和 Vue 实例选项
    source = ensureI18nInstance(source);
    fs.writeFileSync(mainPath, source, "utf8");
    const { runEslintFix } = require("./eslint");
    runEslintFix(projectRoot, ["src/main.js"]);
    return { updated: true, message: "main.js 补充了 i18n 实例导入" };
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

  let vueUseNode = null;

  traverse(ast, {
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

  if (vueUseNode) {
    const pluginCall = t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier("Vue"), t.identifier("use")),
        [
          t.identifier("i18nPlugin"),
          t.objectExpression([
            t.objectProperty(
              t.identifier("i18nScope"),
              t.identifier("i18nScope"),
            ),
          ]),
        ],
      ),
    );
    const mixinCall = t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier("Vue"), t.identifier("mixin")),
        [t.identifier("i18nWidthMixin")],
      ),
    );
    vueUseNode.insertAfter(mixinCall);
    vueUseNode.insertAfter(pluginCall);
  }

  let output = generate(ast, {
    retainLines: true,
    comments: true,
    jsescOption: { minimal: true },
  }).code;

  // 修复 AST 生成时可能将多条语句挤在同一行的问题
  output = fixInjectedStatementNewlines(output);

  // 使用字符串操作插入 import，确保每个语句独占一行（AST splice 不会添加换行）
  output = insertImportsAsString(output, importsToAdd);

  // 写入后执行 eslint --fix 修复格式
  const { runEslintFix } = require("./eslint");
  runEslintFix(projectRoot, ["src/main.js"]);

  source = replaceOldVueI18n(source, output);
  fs.writeFileSync(mainPath, output, "utf8");
  return { updated: true };
}

/**
 * 修复 AST 生成时多条语句挤在同一行的问题
 * 将形如 Vue.use(A);Vue.use(B);Vue.mixin(C); 的行拆分为多行
 * @param {string} code - AST 生成的代码
 * @returns {string} 修复后的代码
 */
function fixInjectedStatementNewlines(code) {
  return code.replace(
    /((?:Vue\.use|Vue\.mixin)\([^;]*\);)(?=(?:Vue\.use|Vue\.mixin)\()/g,
    "$1\n",
  );
}

/**
 * 使用字符串操作在最后一个 import/require 之后插入新的 import 语句
 * 确保每个语句独占一行，遵循 eslint 规则
 * @param {string} code - AST 生成的代码
 * @param {string[]} importsToAdd - 要插入的 import 语句数组
 * @returns {string} 插入后的代码
 */
function insertImportsAsString(code, importsToAdd) {
  const lines = code.split("\n");
  let lastImportLineIndex = -1;

  // 找到最后一个 import 或 require 语句所在行
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (
      trimmed.startsWith("import ") ||
      trimmed.startsWith("require(") ||
      trimmed.match(/^const\s+\w+\s*=\s*require\(/)
    ) {
      lastImportLineIndex = i;
    }
  }

  const importBlock = importsToAdd.join("\n") + "\n";

  if (lastImportLineIndex >= 0) {
    lines.splice(lastImportLineIndex + 1, 0, importBlock);
    return lines.join("\n");
  }

  // 没有 import 时，插入到文件开头
  return importBlock + code;
}

/**
 * 替换旧的 vue-i18n 引入为新的 elementui-utils 引入
 * @param {string} original - 原始源码
 * @param {string} output - AST 生成后的源码
 * @returns {string} 处理后的源码
 */
function replaceOldVueI18n(original, output) {
  let result = output;

  // 情况 1：旧式 default import（import i18n from "..."）
  const oldPatterns = [
    /import\s+i18n\s+from\s+["']@\/assets\/lang\/index["'];?/g,
    /import\s+i18n\s+from\s+["'][^"']*lang[^"']*["'];?/g,
  ];

  oldPatterns.forEach((pattern) => {
    if (pattern.test(result)) {
      result = result.replace(
        pattern,
        'import { i18n } from "@/utils/elementui-utils";',
      );
    }
  });

  // 情况 2：副作用导入（import "@/utils/elementui-utils"）-> 命名导入
  // 情况 3：确保 new Vue({ i18n }) 实例选项
  result = ensureI18nInstance(result);

  return result;
}

/**
 * 向 vue.config.js 注入 voerkai18n-loader 规则
 * 使用大括号匹配算法精确移除旧规则，避免正则匹配不完整导致的残留问题
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

  // 幂等性：已包含 voerkai18n-loader 时跳过（force 模式下先清理再重新注入）
  if (content.includes("voerkai18n-loader")) {
    if (!options.force) {
      return { updated: false, message: "vue.config.js 已包含 voerkai18n-loader" };
    }
    content = removeVoerkai18nLoaderRules(content);
  }

  const loaderRule = [
    "        {",
    "          test: /\\.(js|vue)$/,",
    "          use: [",
    "            {",
    '              loader: "voerkai18n-loader",',
    "              options: {",
    "                autoImport: true,",
    "                debug: false,",
    "              },",
    "            },",
    "          ],",
    '          include: path.join(__dirname, "src"),',
    '          enforce: "pre",',
    "        },",
  ].join("\n");

  if (content.includes("module:") && content.includes("rules:")) {
    content = content.replace(/(rules:\s*\[)/, "$1\n" + loaderRule);
  } else if (content.includes("configureWebpack")) {
    content = content.replace(
      /(configureWebpack:\s*\{)/,
      "$1\n    module: {\n      rules: [\n" + loaderRule + "\n      ],\n    },",
    );
  } else {
    content = content.replace(
      /(\};\s*$)/,
      "  configureWebpack: {\n    module: {\n      rules: [\n" +
        loaderRule +
        "\n      ],\n    },\n  },\n$1",
    );
  }

  fs.writeFileSync(configPath, content, "utf8");
  return { updated: true };
}

/**
 * 移除 vue.config.js 中所有已存在的 voerkai18n-loader 规则块及孤立残留片段
 * 使用大括号匹配算法精确定位完整规则对象，并重建 rules 数组只保留有效规则
 * @param {string} content - vue.config.js 内容
 * @returns {string} 清理后的内容
 */
function removeVoerkai18nLoaderRules(content) {
  let result = content;

  // 第一步：移除所有包含 voerkai18n-loader 的完整规则块
  while (true) {
    const loaderIdx = result.indexOf("voerkai18n-loader");
    if (loaderIdx === -1) break;

    let braceStart = -1;
    let depth = 0;
    for (let i = loaderIdx; i >= 0; i--) {
      if (result[i] === "}") depth++;
      else if (result[i] === "{") {
        if (depth === 0) {
          const prefix = result.substring(i, loaderIdx);
          if (prefix.includes("test:")) {
            braceStart = i;
            break;
          }
        } else {
          depth--;
        }
      }
    }

    if (braceStart === -1) break;

    depth = 0;
    let braceEnd = -1;
    for (let i = braceStart; i < result.length; i++) {
      if (result[i] === "{") depth++;
      else if (result[i] === "}") {
        depth--;
        if (depth === 0) {
          braceEnd = i + 1;
          break;
        }
      }
    }

    if (braceEnd === -1) break;

    let removeEnd = braceEnd;
    while (removeEnd < result.length && result[removeEnd] === ",") removeEnd++;
    while (removeEnd < result.length && /\s/.test(result[removeEnd])) removeEnd++;

    result = result.substring(0, braceStart) + result.substring(removeEnd);
  }

  // 第二步：重建 rules 数组，只保留完整的规则对象（含 test: 属性）
  // 这会清理之前错误注入留下的孤立 }、],、include、enforce 等残骸
  result = rebuildRulesArray(result);

  return result;
}

/**
 * 找到 rules: [ ... ] 数组，移除其中不包含 test: 的孤立片段
 * 通过查找下一个同级属性来定位 rules 数组边界，不受孤立 } 干扰
 * 保留完整的规则对象，清理破碎代码
 * @param {string} content - vue.config.js 内容
 * @returns {string} 清理后的内容
 */
function rebuildRulesArray(content) {
  const rulesStartMatch = content.match(/rules:\s*\[/);
  if (!rulesStartMatch) return content;

  const bracketStart = rulesStartMatch.index + rulesStartMatch[0].length;

  // 查找 rules 数组的闭合 ]：找下一个同级属性或 configureWebpack 的结束
  // 同级属性如 plugins:, optimization:, output:, name:, resolve:, externals: 等
  // 或者 module: 的闭合 },
  const afterRules = content.substring(bracketStart);
  const closingMatch = afterRules.match(/\n\s*\](\s*,|\s*\n)/);
  if (!closingMatch) return content;

  // 找到最后一个 ] 在合理的缩进位置（至少 2 空格缩进，属于 module.rules 的闭合）
  // 从后往前找：找 closingMatch 之前、且后面紧跟 }, 或空行的 ]
  let searchEnd = closingMatch.index;
  // 扩大搜索范围：找 closingMatch 之后紧跟 }, 的位置（这才是 rules 数组真正的闭合）
  const fullCloseMatch = afterRules.match(/\n[ \t]*\]\s*,?\s*\n\s*\}/);
  if (fullCloseMatch) {
    searchEnd = fullCloseMatch.index + fullCloseMatch[0].indexOf("]");
  }

  const bracketEnd = bracketStart + searchEnd;
  const before = content.substring(0, bracketStart);
  const rulesBody = content.substring(bracketStart, bracketEnd);
  const after = content.substring(bracketEnd);

  // 在 rulesBody 中提取所有完整的规则对象（含 test: 属性）
  const validRules = [];
  let i = 0;
  while (i < rulesBody.length) {
    while (i < rulesBody.length && /[\s,]/.test(rulesBody[i])) i++;
    if (i >= rulesBody.length) break;

    if (rulesBody[i] !== "{") {
      while (i < rulesBody.length && rulesBody[i] !== "\n") i++;
      continue;
    }

    let depth = 0;
    const ruleStart = i;
    let ruleEnd = -1;
    for (let j = i; j < rulesBody.length; j++) {
      if (rulesBody[j] === "{") depth++;
      else if (rulesBody[j] === "}") {
        depth--;
        if (depth === 0) {
          ruleEnd = j + 1;
          break;
        }
      }
    }

    if (ruleEnd === -1) break;

    const ruleText = rulesBody.substring(ruleStart, ruleEnd);
    if (ruleText.includes("test:")) {
      validRules.push(ruleText.trim());
    }

    i = ruleEnd;
  }

  if (validRules.length === 0) {
    return before + "\n      " + after.trimStart();
  }

  const indent = "\n        ";
  const closeIndent = "\n      ";
  const rulesContent = validRules.map((r) => indent + r + ",").join("");
  return before + rulesContent + closeIndent + after.trimStart();
}

/**
 * 向 App.vue 注入 i18nMixin 和路由标题逻辑
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 注入结果
 */
function injectAppVue(projectRoot, _options = {}) {
  const appPath = path.join(projectRoot, "src/App.vue");
  if (!fs.existsSync(appPath)) {
    return { updated: false, message: "src/App.vue 不存在" };
  }

  let content = fs.readFileSync(appPath, "utf8");

  // 幂等性检查
  if (content.includes("i18nMixin")) {
    // 已注入 i18nMixin，但仍需检查 $route watch 是否为标准模式
    const standardWatchPattern = /this\.t\(route\?\.meta\?\.title\s*\?\?\s*"/;
    if (standardWatchPattern.test(content)) {
      return { updated: false, message: "App.vue 已包含 i18nMixin 和标准 watch" };
    }
    // 有 i18nMixin 但 watch 不是标准模式，替换 watch
    content = replaceRouteWatch(content, projectRoot);
    if (content) {
      fs.writeFileSync(appPath, content, "utf8");
      return { updated: true, message: "App.vue 替换了 $route watch 为标准模式" };
    }
    return { updated: false, message: "App.vue 已包含 i18nMixin，watch 无需替换" };
  }

  const mixinImport =
    'import { i18nMixin } from "@/languages/i18n-plugin/i18nMixin";';

  content = content.replace(/(<script[^>]*>)/, "$1\n" + mixinImport);

  if (content.includes("mixins:")) {
    content = content.replace(/(mixins:\s*\[)/, "$1i18nMixin(), ");
  } else {
    content = content.replace(
      /(export\s+default\s*\{)/,
      "$1\n  mixins: [i18nMixin()],",
    );
  }

  // 替换 $route watch 为标准模式
  const replaced = replaceRouteWatch(content, projectRoot);
  if (replaced) {
    content = replaced;
  }


  fs.writeFileSync(appPath, content, "utf8");
  return { updated: true };
}

/**
 * 替换 App.vue 中的 $route watch 为标准 i18n 模式
 * 从原 watch 中提取项目特定的 fallback 标题（如"数据湖"），替换为标准模式
 * @param {string} content - App.vue 内容
 * @param {string} projectRoot - 项目根路径（用于提取 fallback 标题）
 * @returns {string|null} 替换后的内容，null 表示无需替换
 */
function replaceRouteWatch(content, _projectRoot) {
  // 提取原 watch 中的 fallback 标题
  let fallbackTitle = "通用配置";
  const fallbackPatterns = [
    /\?\?\s*this\.t\(["']([^"']+)["']\)/,
    /\?\?\s*["']([^"']+)["']/,
  ];
  for (const pattern of fallbackPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      fallbackTitle = match[1];
      break;
    }
  }

  // 标准模式：替换整个 $route watch handler 内容
  // 标准模式：相对缩进（indent 前缀由调用方添加）
  // $route: 0 空格相对缩进，handler 2 空格，body 4 空格
  const standardWatch = [
    "$route: {",
    "  handler(route) {",
    '    const subTitle = this.t(route?.meta?.title ?? "' + fallbackTitle + '");',
    '    const prefix = this.t(this.tabPrefix) || this.t("数据中台");',
    "    document.title = subTitle ? `${subTitle} - ${prefix}` : prefix;",
    "  },",
    "  deep: true,",
    "  immediate: true,",
    "},",
  ].join("\n");

  // 匹配整个 $route watch 块（需要处理嵌套大括号）
  // 从 $route: { 开始，匹配到对应的闭合 }（考虑 handler() {} 内部的大括号）
  const routeStart = content.indexOf("$route:");

  // 从原 $route: 前的空格获取缩进（默认 4 空格）
  const indentMatch = routeStart > 0 ? content.substring(0, routeStart).match(/([ \t]*)$/) : null;
  const indent = indentMatch ? indentMatch[1] : "    ";
  const indentedWatch = standardWatch.split("\n").map((line) => indent + line).join("\n");

  if (routeStart === -1) {
    // 没有 $route watch，在 watch: { 后注入
    if (content.includes("watch:")) {
      return content.replace(/(watch:\s*\{)/, "$1\n" + indentedWatch);
    }
    return null;
  }

  // 从 $route: { 开始，按大括号深度匹配到闭合的 },
  const braceStart = content.indexOf("{", routeStart);
  if (braceStart === -1) return null;
  let depth = 0;
  let endIdx = braceStart;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  // 包含 trailing comma
  if (content[endIdx] === ",") endIdx++;

  // oldWatch = content.substring(routeStart, endIdx);
  return content.substring(0, routeStart - indent.length) + indentedWatch + content.substring(endIdx);

  // 如果没有 $route watch，在 watch: { 后注入
  if (content.includes("watch:")) {
    return content.replace(/(watch:\s*\{)/, "$1\n" + indentedWatch);
  }

  return null;
}

/**
 * 在请求拦截器中注入 Accept-Language 和 X-Timezone header
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 注入结果
 */
/**
 * 在请求拦截器中注入 Accept-Language 和 X-Timezone header
 * 注入逻辑：
 * 1. 优先处理含 config.headers["menuKey"] 的文件（header 配置的权威位置）
 *    - 若已有完整的 languageMap + X-Timezone 注入：跳过
 *    - 若有旧的 Accept-Language（无 languageMap 或无 X-Timezone）：原地替换升级
 *    - 若无 Accept-Language：在 menuKey 前注入
 * 2. 回退到含 interceptors.request.use 的文件：仅当没有 menuKey 文件时才处理
 * 3. 整个 src/utils/ 只注入一个文件，避免重复
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 注入结果
 */
function injectAcceptLanguage(projectRoot, _options = {}) {
  const utilsDir = path.join(projectRoot, "src/utils");
  if (!fs.existsSync(utilsDir)) {
    return { updated: false, message: "src/utils 目录不存在" };
  }

  const files = fs.readdirSync(utilsDir).filter((f) => f.endsWith(".js"));

  /** 待注入的 header 设置语句（不含缩进，缩进由上下文动态确定） */
  const headerLines = [
    'const languageMap = {',
    '  zh: "zh-CN",',
    '  en: "en-US",',
    '  jp: "ja-JP",',
    '  ar: "ar",',
    '};',
    'config.headers["Accept-Language"] = languageMap[localStorage.getItem("language") || "zh"];',
    'config.headers["X-Timezone"] = localStorage.getItem("i18n-tz") || "";',
  ];

  /**
   * 判断文件是否已包含完整的 header 注入（languageMap + Accept-Language + X-Timezone）
   * @param {string} content - 文件内容
   * @returns {boolean} 是否已完整注入
   */
  function isFullyInjected(content) {
    return (
      content.includes("Accept-Language") &&
      content.includes("languageMap") &&
      content.includes("X-Timezone")
    );
  }

  /**
   * 在 menuKey 行前注入或替换 header 设置
   * @param {string} content - 文件内容
   * @param {string} filePath - 文件路径
   * @param {string} file - 文件名
   * @returns {object|null} 注入结果，null 表示未处理
   */
  function injectAtMenuKey(content, filePath, file) {
    const menuKeyMatch = content.match(/^([ \t]*)config\.headers\["menuKey"\]/m);
    if (!menuKeyMatch) return null;

    const indent = menuKeyMatch[1];

    // 已完整注入：跳过
    if (isFullyInjected(content)) return "skip";

    // 有旧的 Accept-Language（无 languageMap 或无 X-Timezone）：原地替换
    if (content.includes("Accept-Language")) {
      // 移除旧的 Accept-Language 行（可能有多行，全部清除）
      let newContent = content.replace(
        /^[ \t]*config\.headers\["Accept-Language"\].*$/gm,
        "",
      );
      // 移除可能残留的旧 X-Timezone 行
      newContent = newContent.replace(
        /^[ \t]*config\.headers\["X-Timezone"\].*$/gm,
        "",
      );
      // 移除可能残留的旧 languageMap 块（单行或多行）
      newContent = newContent.replace(
        /^[ \t]*const languageMap = \{[\s\S]*?\};\s*$/gm,
        "",
      );
      // 清理被移除行留下的空行（连续 2+ 空行合并为 1 个空行）
      newContent = newContent.replace(/\n{3,}/g, "\n\n");
      // 清理函数体开头的多余空行（如 `=> {\n\n  const` -> `=> {\n  const`）
      newContent = newContent.replace(/(\{)\n\n+/g, "$1\n");

      // 重新匹配 menuKey 位置（内容可能已变化）
      const newMenuKeyMatch = newContent.match(
        /^([ \t]*)config\.headers\["menuKey"\]/m,
      );
      if (newMenuKeyMatch) {
        const insertPos = newMenuKeyMatch.index;
        const newIndent = newMenuKeyMatch[1];
        const injection =
          headerLines.map((line) => newIndent + line).join("\n") + "\n";
        newContent =
          newContent.slice(0, insertPos) + injection + newContent.slice(insertPos);
      }
      fs.writeFileSync(filePath, newContent, "utf8");
      return { updated: true, file: path.join("src/utils", file) };
    }

    // 无 Accept-Language：在 menuKey 前注入
    const injection =
      headerLines.map((line) => indent + line).join("\n") + "\n";
    const insertPos = menuKeyMatch.index;
    const newContent =
      content.slice(0, insertPos) + injection + content.slice(insertPos);
    fs.writeFileSync(filePath, newContent, "utf8");
    return { updated: true, file: path.join("src/utils", file) };
  }

  /**
   * 在 interceptors.request.use 回调顶部注入 header 设置
   * @param {string} content - 文件内容
   * @param {string} filePath - 文件路径
   * @param {string} file - 文件名
   * @returns {object|null} 注入结果，null 表示未处理
   */
  function injectAtInterceptor(content, filePath, file) {
    // 已完整注入：跳过
    if (isFullyInjected(content)) return "skip";

    // 有旧的不完整注入：不在此处处理（由 menuKey 路径处理）
    if (content.includes("Accept-Language")) return null;

    const interceptorPattern =
      /(interceptors\.request\.use\(\s*(?:\(([^)]*)\)\s*=>|function\s*\(([^)]*)\))\s*\{)/;
    const match = content.match(interceptorPattern);
    if (!match) return null;

    const afterMatch = content.slice(match.index + match[0].length);
    const nextLineMatch = afterMatch.match(/^([ \t]*)\S/m);
    const indent = nextLineMatch ? nextLineMatch[1] : "  ";
    const injection =
      "\n" + headerLines.map((line) => indent + line).join("\n");
    const insertPos = match.index + match[0].length;
    const newContent =
      content.slice(0, insertPos) + injection + content.slice(insertPos);
    fs.writeFileSync(filePath, newContent, "utf8");
    return { updated: true, file: path.join("src/utils", file) };
  }

  // 第一轮：优先处理含 config.headers["menuKey"] 的文件
  for (const file of files) {
    const filePath = path.join(utilsDir, file);
    const content = fs.readFileSync(filePath, "utf8");

    if (!content.includes('config.headers["menuKey"]')) continue;

    const result = injectAtMenuKey(content, filePath, file);
    if (result === "skip") continue;
    if (result) return result;
  }

  // 如果含 menuKey 的文件已完整注入，清理其他文件中的冗余注入
  let menuKeyFileFullyInjected = false;
  for (const file of files) {
    const filePath = path.join(utilsDir, file);
    const content = fs.readFileSync(filePath, "utf8");
    if (
      content.includes('config.headers["menuKey"]') &&
      isFullyInjected(content)
    ) {
      menuKeyFileFullyInjected = true;
      break;
    }
  }

  if (menuKeyFileFullyInjected) {
    let cleanedFile = null;
    for (const file of files) {
      const filePath = path.join(utilsDir, file);
      const content = fs.readFileSync(filePath, "utf8");
      // 跳过含 menuKey 的文件（权威位置），只清理其他文件中的冗余注入
      if (content.includes('config.headers["menuKey"]')) continue;
      if (!content.includes("Accept-Language")) continue;

      // 移除冗余的 header 注入
      let newContent = content;
      newContent = newContent.replace(
        /^[ \t]*const languageMap = \{[\s\S]*?\};\s*$/gm,
        "",
      );
      newContent = newContent.replace(
        /^[ \t]*config\.headers\["Accept-Language"\].*$/gm,
        "",
      );
      newContent = newContent.replace(
        /^[ \t]*config\.headers\["X-Timezone"\].*$/gm,
        "",
      );
      // 清理多余空行
      newContent = newContent.replace(/\n{3,}/g, "\n\n");
      newContent = newContent.replace(/(\{)\n\n+/g, "$1\n");
      newContent = newContent.replace(/\n\n+(  return)/g, "\n  $1");

      if (newContent !== content) {
        fs.writeFileSync(filePath, newContent, "utf8");
        cleanedFile = path.join("src/utils", file);
      }
    }
    if (cleanedFile) {
      return { updated: true, file: cleanedFile };
    }
    return { updated: false, message: "header 注入已完成，无冗余需清理" };
  }

  // 第二轮：回退到含 interceptors.request.use 的文件（仅处理未注入的）
  for (const file of files) {
    const filePath = path.join(utilsDir, file);
    const content = fs.readFileSync(filePath, "utf8");

    if (!content.includes("interceptors.request.use")) continue;

    const result = injectAtInterceptor(content, filePath, file);
    if (result === "skip") continue;
    if (result) return result;
  }

  return { updated: false, message: "未找到合适的请求拦截器" };
}

/**
 * 向 layout-header 组件注入语言切换器（kd-select）和 i18nMixin
 * 查找策略：优先 src/layout/layout-header/index.vue，否则搜索 src/layout/ 下含 right-box 的 .vue 文件
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} options - 选项 { force: boolean }
 * @returns {object} 注入结果
 */
function injectLayoutHeader(projectRoot, _options = {}) {
  const defaultPath = path.join(projectRoot, "src/layout/layout-header/index.vue");
  let headerPath = defaultPath;
  let headerRelative = "src/layout/layout-header/index.vue";

  // 如果默认路径不存在，搜索 src/layout/ 下含 right-box 的 .vue 文件
  if (!fs.existsSync(headerPath)) {
    const layoutDir = path.join(projectRoot, "src/layout");
    if (!fs.existsSync(layoutDir)) {
      return { updated: false, message: "src/layout 目录不存在" };
    }
    const found = findHeaderComponent(layoutDir);
    if (!found) {
      return { updated: false, message: "未找到 layout-header 组件" };
    }
    headerPath = found;
    headerRelative = path.relative(projectRoot, found);
  }

  let content = fs.readFileSync(headerPath, "utf8");

  // 幂等性检查：已包含 i18nMixin 则跳过
  // force 模式下也跳过 —— layout-header 一旦注入 i18nMixin 就不会"内容不完整"
  if (content.includes("i18nMixin")) {
    return { updated: false, message: "layout-header 已包含 i18nMixin", file: headerRelative };
  }

  // 1. 注入 import { i18nMixin }
  if (!content.includes("i18nMixin")) {
    const mixinImport = 'import { i18nMixin } from "@/languages/i18n-plugin/i18nMixin";';
    content = content.replace(/(<script[^>]*>)/, "$1\n" + mixinImport);
  }

  // 2. 注入 mixins: [i18nMixin()]
  if (content.includes("mixins:")) {
    if (!content.includes("i18nMixin()")) {
      content = content.replace(/(mixins:\s*\[)/, "$1i18nMixin(), ");
    }
  } else {
    content = content.replace(
      /(export\s+default\s*\{)/,
      "$1\n  mixins: [i18nMixin()],",
    );
  }

  // 3. 在 right-box 区域注入语言切换器
  const languageSwitcher = [
    "      <!-- 语言切换器 -->",
    "      <kd-select",
    '        :value="activeLanguage"',
    '        :options="languages"',
    '        label="title"',
    '        val="name"',
    '        width="160"',
    '        @change="changeLanguage"',
    "      ></kd-select>",
  ].join("\n");

  // 匹配 <div class="right-box"> 内部内容
  const rightBoxPattern = /(<div\s+class="right-box"\s*>)([\s\S]*?)(<\/div>)/;
  if (rightBoxPattern.test(content)) {
    content = content.replace(rightBoxPattern, (match, openTag, inner, closeTag) => {
      // 如果已有 activeLanguage 则跳过注入
      if (inner.includes("activeLanguage")) return match;
      const trimmedInner = inner.trim();
      const separator = trimmedInner ? "\n" + trimmedInner + "\n    " : "\n    ";
      return openTag + "\n" + languageSwitcher + separator + closeTag;
    });
  }

  fs.writeFileSync(headerPath, content, "utf8");
  return { updated: true, file: headerRelative };
}

/**
 * 在 layout 目录下递归搜索包含 right-box class 的 .vue 文件
 * @param {string} dir - 搜索目录
 * @returns {string|null} 文件路径或 null
 */
function findHeaderComponent(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findHeaderComponent(fullPath);
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
 * 检查 @kd/components 版本是否 >= 5.2.1（v5 起才有 dist/locale/lang/* 国际化文件）
 * 仅输出 warn，不阻塞流程
 * @param {string} projectRoot - 目标项目根路径
 * @returns {object|null} 版本检查结果，null 表示未找到 @kd/components
 */
function checkKdComponentsVersion(projectRoot) {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return null;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const version =
    (pkg.dependencies && pkg.dependencies["@kd/components"]) ||
    (pkg.devDependencies && pkg.devDependencies["@kd/components"]);

  if (!version) {
    return { ok: false, message: "未检测到 @kd/components，elementui-utils.js 中的 KD 组件 locale 将不可用" };
  }

  // 提取版本号中的主版本号（支持 ^5.2.1, ~5.0.0, 5.x 等格式）
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return { ok: false, message: `@kd/components 版本格式无法解析: ${version}` };
  }

  const major = parseInt(match[1], 10);
  const minor = parseInt(match[2], 10);
  const patch = parseInt(match[3], 10);
  if (major < 5 || (major === 5 && (minor < 2 || (minor === 2 && patch < 1)))) {
    return {
      ok: false,
      message: `@kd/components 版本 ${version} 过低，国际化 locale 文件需要 v5.2.1+，请升级: pnpm add @kd/components@^5`,
    };
  }

  return { ok: true, message: `@kd/components ${version} 版本满足要求` };
}

/**
 * 确保 main.js 中有 i18n 实例的命名导入和 Vue 实例选项
 * 处理三种情况：
 * 1. 已有 import { i18n } from "@/utils/elementui-utils" -> 跳过
 * 2. 已有 import "@/utils/elementui-utils"（副作用导入）-> 转换为命名导入
 * 3. 没有任何 elementui-utils 导入 -> 新增命名导入
 * 然后确保 new Vue({...}) 中包含 i18n 实例选项
 * @param {string} source - main.js 源码
 * @returns {string} 处理后的源码
 */
function ensureI18nInstance(source) {
  let result = source;

  const namedImportPattern = /import\s*\{\s*i18n\s*\}\s*from\s*["']@\/utils\/elementui-utils["'];?/;
  const sideEffectImportPattern = /import\s+["']@\/utils\/elementui-utils["'];?/;

  if (!namedImportPattern.test(result)) {
    if (sideEffectImportPattern.test(result)) {
      // 副作用导入 -> 命名导入
      result = result.replace(
        sideEffectImportPattern,
        'import { i18n } from "@/utils/elementui-utils";',
      );
    } else {
      // 无导入 -> 新增命名导入
      const importStatement = 'import { i18n } from "@/utils/elementui-utils";\n';
      const lines = result.split("\n");
      let lastImportIndex = -1;
      for (let i = 0; i < lines.length; i += 1) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith("import ") || trimmed.startsWith("require(")) {
          lastImportIndex = i;
        }
      }
      if (lastImportIndex >= 0) {
        lines.splice(lastImportIndex + 1, 0, importStatement);
        result = lines.join("\n");
      } else {
        result = importStatement + result;
      }
    }
  }

  // 确保 new Vue({...}) 中包含 i18n 实例选项
  if (!/new\s+Vue\s*\(\s*\{[^}]*\bi18n\b/.test(result)) {
   result = result.replace(/(new\s+Vue\s*\(\s*\{)/, "$1\n    i18n,");
 }

  return result;
}

module.exports = {
  inject,
  checkGlobalCliVersion,
  injectPackageJson,
  injectMainJs,
  injectVueConfig,
  injectAppVue,
  injectAcceptLanguage,
  injectLayoutHeader,
  checkKdComponentsVersion,
  REQUIRED_DEPS,
};
