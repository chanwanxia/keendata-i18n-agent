const { applyI18n } = require("./apply");
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
  inspectGeneratedFiles,
  isPlaceholderCompatible,
  validateTranslationObject,
  validateTranslations,
} = require("./validate");

module.exports = {
  applyI18n,
  buildSuggestedConfig,
  checkGlobalCliVersion,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  detectProjectProfile,
  ensurePostcssConfig,
  extractPlaceholders,
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
  scaffold,
  scanHardcodedChinese,
  translateTranslations,
  validateTranslationObject,
  validateTranslations,
  writeProjectConfig,
};
