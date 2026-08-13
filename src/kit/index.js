const { applyI18n } = require("./apply");
const { cleanupI18n } = require("./apply");
const { runEslintFix, hasEslintConfig, isEslintAvailable } = require("./eslint");
const { main } = require("./cli");
const {
  buildSuggestedConfig,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  detectProjectProfile,
  loadProjectConfig,
  resolveProjectRoot,
  writeProjectConfig,
} = require("./config");
const { inspectProjectSetup } = require("./doctor");
const { inject, checkGlobalCliVersion, injectPackageJson, injectMainJs, injectVueConfig, injectAppVue, injectAcceptLanguage } = require("./inject");
const { runShellCommand } = require("./shell");
const { runShellCommandCaptured } = require("./shell");
const { scaffold, ensurePostcssConfig } = require("./scaffold");
const { scanHardcodedChinese } = require("./scan");
const { translateTranslations } = require("./translate");
const {
  extractPlaceholders,
  fixIdMapKeys,
  inspectGeneratedFiles,
  isPlaceholderCompatible,
  validateTranslationObject,
  validateTranslations,
} = require("./validate");

module.exports = {
  applyI18n,
  cleanupI18n,
  hasEslintConfig,
  isEslintAvailable,
  buildSuggestedConfig,
  checkGlobalCliVersion,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  detectProjectProfile,
  ensurePostcssConfig,
  extractPlaceholders,
  fixIdMapKeys,
  inject,
  injectAcceptLanguage,
  injectAppVue,
  injectMainJs,
  injectPackageJson,
  injectVueConfig,
  inspectGeneratedFiles,
  inspectProjectSetup,
  isPlaceholderCompatible,
  loadProjectConfig,
  main,
  resolveProjectRoot,
  runShellCommand,
  runShellCommandCaptured,
  runEslintFix,
  scaffold,
  scanHardcodedChinese,
  translateTranslations,
  validateTranslationObject,
  validateTranslations,
  writeProjectConfig,
};
