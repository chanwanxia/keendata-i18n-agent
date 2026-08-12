const fs = require("fs");
const path = require("path");
const { detectPreset } = require("./presets");

const CONFIG_FILE = "i18n-kit.config.json";

const DEFAULT_CONFIG = {
  include: ["src"],
  extensions: [".js", ".vue"],
  excludeDirs: ["node_modules", "dist", ".git", ".idea"],
  excludeFiles: [
    "src/languages/index.js",
    "src/languages/idMap.js",
    "src/languages/zh.js",
    "src/languages/en.js",
    "src/languages/jp.js",
    "src/languages/ar.js",
  ],
  translationFile: "src/languages/translates/default.json",
  generatedFiles: [
    "src/languages/index.js",
    "src/languages/idMap.js",
    "src/languages/zh.js",
    "src/languages/en.js",
    "src/languages/jp.js",
    "src/languages/ar.js",
  ],
  languages: ["zh", "en", "jp", "ar"],
  extractCommand: "pnpm i18n:extract",
  translate: {
    provider: "llm",
    command: "pnpm exec voerkai18n translate",
    useGlossaryFallback: true,
    useGlossaryPostProcess: true,
    strictPlaceholders: true,
    baidu: {
      appidEnv: "BAIDU_APPID",
      appkeyEnv: "BAIDU_APPKEY",
    },
  },
  compileCommand: "pnpm i18n:compile",
  hardcodedChinese: {
    ignoreFilePrefixes: ["src/languages/formatters/"],
    ignorePatterns: ["this.t(", "t(", "$t(", "import { t }", 'from "@/languages"', "from '@/languages'"],
  },
};

/**
 * 解析项目根路径，默认使用当前工作目录
 * @param {string} projectArg - 项目路径参数
 * @returns {string} 项目根路径
 */
function resolveProjectRoot(projectArg) {
  const projectRoot = projectArg ? path.resolve(projectArg) : process.cwd();
  const packagePath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    throw new Error(`目标项目不存在 package.json: ${projectRoot}`);
  }
  return projectRoot;
}

/**
 * 加载项目 i18n 配置，合并默认配置和用户配置文件
 * @param {string} projectRoot - 项目根路径
 * @returns {object} 合并后的配置
 */
function loadProjectConfig(projectRoot) {
  const profile = detectProjectProfile(projectRoot);
  const suggestedConfig = buildSuggestedConfig(profile);
  const configPath = path.join(projectRoot, CONFIG_FILE);
  if (!fs.existsSync(configPath)) return suggestedConfig;

  const userConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return {
    ...suggestedConfig,
    ...userConfig,
    hardcodedChinese: {
      ...suggestedConfig.hardcodedChinese,
      ...(userConfig.hardcodedChinese || {}),
    },
    translate: {
      ...suggestedConfig.translate,
      ...(userConfig.translate || {}),
      baidu: {
        ...(suggestedConfig.translate ? suggestedConfig.translate.baidu : {}),
        ...((userConfig.translate && userConfig.translate.baidu) || {}),
      },
    },
  };
}

/**
 * 探测项目的基础画像（框架、依赖、语言目录等）
 * @param {string} projectRoot - 项目根路径
 * @returns {object} 项目画像对象
 */
function detectBaseProjectProfile(projectRoot) {
  const packagePath = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const allDeps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };

  const languageDir = detectLanguageDir(projectRoot);
  const settingsPath = path.join(projectRoot, languageDir, "settings.json");
  const languages = fs.existsSync(settingsPath) ? readLanguagesFromSettings(settingsPath) : DEFAULT_CONFIG.languages;
  const packageManager = detectPackageManager(projectRoot);
  const packageScripts = packageJson.scripts || {};

  return {
    projectRoot,
    packageName: packageJson.name || path.basename(projectRoot),
    packageManager,
    framework: detectFramework(allDeps),
    dependencies: Object.keys(allDeps),
    hasVueConfig: fs.existsSync(path.join(projectRoot, "vue.config.js")),
    hasVoerka: Boolean(allDeps["@voerkai18n/cli"] || allDeps["@voerkai18n/runtime"] || allDeps["voerkai18n-loader"]),
    hasVueI18n: Boolean(allDeps["vue-i18n"]),
    languageDir,
    translationFile: normalizeRelativePath(path.join(languageDir, "translates", "default.json")),
    settingsFile: fs.existsSync(settingsPath) ? toRelative(projectRoot, settingsPath) : null,
    generatedFiles: buildGeneratedFiles(languageDir, languages),
    languages,
    scripts: {
      extract: packageScripts["i18n:extract"] || null,
      translate: packageScripts["i18n:translate"] || null,
      compile: packageScripts["i18n:compile"] || null,
    },
  };
}

/**
 * 根据项目画像构建建议配置
 * @param {object} profile - 项目画像
 * @returns {object} i18n 配置对象
 */
function buildSuggestedConfig(profile) {
  const config = {
    ...DEFAULT_CONFIG,
    excludeFiles: buildGeneratedFiles(profile.languageDir, profile.languages),
    translationFile: profile.translationFile,
    generatedFiles: profile.generatedFiles,
    languages: profile.languages,
    extractCommand: buildCommand(profile.packageManager, "i18n:extract", profile.scripts.extract, "extract -D"),
    translate: buildTranslateConfig(profile),
    compileCommand: buildCommand(profile.packageManager, "i18n:compile", profile.scripts.compile, "compile"),
  };

  if (profile.preset) {
    config.preset = profile.preset.id;
  }

  if (profile.preset && profile.preset.id === "keendata-vue2-voerkai") {
    config.apply = {
      templateAttributes: [
        "placeholder",
        "title",
        "label",
        "content-text",
        "reference-text",
        "confirm-text",
        "confirmText",
        "cancel-text",
        "cancelText",
        "empty-text",
        "emptyText",
        "p-l",
      ],
      scriptObjectKeys: ["label", "title", "content", "confirmText", "cancelText", "text", "placeholder", "message"],
      specialComponents: ["kd-column-text", "kd-column-filter", "kd-input"],
    };
  }

  return config;
}

/**
 * 将配置写入项目的 i18n-kit.config.json
 * @param {string} projectRoot - 项目根路径
 * @param {object} config - 配置对象
 * @param {object} options - 选项 { force: boolean }
 * @returns {string} 配置文件路径
 */
function writeProjectConfig(projectRoot, config, options = {}) {
  const configPath = path.join(projectRoot, CONFIG_FILE);
  if (fs.existsSync(configPath) && !options.force) {
    throw new Error(`配置文件已存在: ${configPath}`);
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

/**
 * 检测项目使用的包管理器
 * @param {string} projectRoot - 项目根路径
 * @returns {string} pnpm / yarn / npm
 */
function detectPackageManager(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

/**
 * 根据依赖检测前端框架
 * @param {object} deps - 依赖对象
 * @returns {string} vue2 / vue / react / unknown
 */
function detectFramework(deps) {
  if (deps.vue) {
    return deps.vue.startsWith("2") ? "vue2" : "vue";
  }
  if (deps.react) return "react";
  return "unknown";
}

/**
 * 检测项目的语言文件目录
 * @param {string} projectRoot - 项目根路径
 * @returns {string} 语言目录相对路径
 */
function detectLanguageDir(projectRoot) {
  const candidates = ["src/languages", "languages"];
  const found = candidates.find((dir) => fs.existsSync(path.join(projectRoot, dir)));
  return found || "src/languages";
}

/**
 * 从 settings.json 读取语言列表
 * @param {string} settingsPath - settings.json 路径
 * @returns {array} 语言名称数组
 */
function readLanguagesFromSettings(settingsPath) {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const languages = (settings.languages || []).map((item) => item.name).filter(Boolean);
    return languages.length > 0 ? languages : DEFAULT_CONFIG.languages;
  } catch (error) {
    return DEFAULT_CONFIG.languages;
  }
}

/**
 * 构建运行时生成的语言包文件列表
 * @param {string} languageDir - 语言目录
 * @param {array} languages - 语言列表
 * @returns {array} 文件路径数组
 */
function buildGeneratedFiles(languageDir, languages) {
  const files = [
    path.join(languageDir, "index.js"),
    path.join(languageDir, "idMap.js"),
    path.join(languageDir, "storage.js"),
  ];

  languages.forEach((lang) => {
    files.push(path.join(languageDir, `${lang}.js`));
  });

  return files.map((file) => file.split(path.sep).join("/"));
}

/**
 * 将路径分隔符统一为正斜杠
 * @param {string} filePath - 文件路径
 * @returns {string} 标准化后的路径
 */
function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

/**
 * 构建 voerkai18n 命令字符串
 * @param {string} packageManager - 包管理器
 * @param {string} scriptName - 脚本名
 * @param {string} scriptValue - 脚本值
 * @param {string} fallbackVoerkaCommand - 回退命令
 * @returns {string} 命令字符串
 */
function buildCommand(packageManager, scriptName, scriptValue, fallbackVoerkaCommand) {
  if (scriptValue) {
    if (packageManager === "pnpm") return `pnpm ${scriptName}`;
    if (packageManager === "yarn") return `yarn ${scriptName}`;
    return `npm run ${scriptName}`;
  }

  if (packageManager === "pnpm") return `pnpm exec voerkai18n ${fallbackVoerkaCommand}`;
  if (packageManager === "yarn") return `yarn voerkai18n ${fallbackVoerkaCommand}`;
  return `npx voerkai18n ${fallbackVoerkaCommand}`;
}

/**
 * 构建翻译配置
 * @param {object} profile - 项目画像
 * @returns {object} 翻译配置
 */
function buildTranslateConfig(profile) {
  return {
    ...DEFAULT_CONFIG.translate,
    command: buildTranslateBaseCommand(profile.packageManager, profile.scripts.translate),
  };
}

/**
 * 构建翻译基础命令
 * @param {string} packageManager - 包管理器
 * @param {string} scriptValue - 脚本值
 * @returns {string} 命令字符串
 */
function buildTranslateBaseCommand(packageManager, scriptValue) {
  if (scriptValue) {
    if (packageManager === "pnpm") return "pnpm i18n:translate";
    if (packageManager === "yarn") return "yarn i18n:translate";
    return "npm run i18n:translate";
  }

  if (packageManager === "pnpm") return "pnpm exec voerkai18n translate";
  if (packageManager === "yarn") return "yarn voerkai18n translate";
  return "npx voerkai18n translate";
}

/**
 * 将绝对路径转换为相对项目根路径
 * @param {string} projectRoot - 项目根路径
 * @param {string} filePath - 文件路径
 * @returns {string} 相对路径
 */
function toRelative(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

/**
 * 探测完整项目画像（含 preset 匹配）
 * @param {string} projectRoot - 项目根路径
 * @returns {object} 完整项目画像
 */
function detectProjectProfile(projectRoot) {
  const profile = detectBaseProjectProfile(projectRoot);
  const preset = detectPreset(profile, projectRoot);

  if (preset) {
    profile.preset = {
      id: preset.id,
      title: preset.title,
    };
  }

  return profile;
}

module.exports = {
  buildSuggestedConfig,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  detectProjectProfile,
  loadProjectConfig,
  resolveProjectRoot,
  writeProjectConfig,
};
