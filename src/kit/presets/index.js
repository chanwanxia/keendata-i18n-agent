const fs = require("fs");
const path = require("path");
const keendataVue2VoerkaPreset = require("./keendata-vue2-voerkai");

const presets = [keendataVue2VoerkaPreset];

/**
 * 根据项目画像自动匹配 preset
 * @param {object} profile - 项目画像
 * @param {string} projectRoot - 项目根路径
 * @returns {object|null} 匹配的 preset 或 null
 */
function detectPreset(profile, projectRoot) {
  const matched = presets.find((preset) => matchPreset(preset, profile, projectRoot));
  return matched || null;
}

/**
 * 根据 preset ID 获取 preset 对象
 * @param {string} presetId - preset ID
 * @returns {object|null} preset 对象或 null
 */
function getPresetById(presetId) {
  return presets.find((preset) => preset.id === presetId) || null;
}

/**
 * 列出所有可用 preset
 * @returns {array} preset 摘要数组
 */
function listPresets() {
  return presets.map((preset) => ({
    id: preset.id,
    title: preset.title,
  }));
}

/**
 * 检查项目是否匹配指定 preset
 * @param {object} preset - preset 对象
 * @param {object} profile - 项目画像
 * @param {string} projectRoot - 项目根路径
 * @returns {boolean} 是否匹配
 */
function matchPreset(preset, profile, projectRoot) {
  if (preset.id !== "keendata-vue2-voerkai") return false;

  const requiredFiles = [
    "src/languages/i18n-plugin/i18nMixin.js",
    "src/mixins/i18n-width-mixin.js",
    "src/styles/i18n-style.scss",
    "src/utils/elementui-utils.js",
  ];

  const hasRequiredFiles = requiredFiles.every((file) => fs.existsSync(path.join(projectRoot, file)));
  const hasRequiredDeps = profile.hasVoerka && profile.hasVueI18n;
  const hasKeenDataUi = profile.dependencies.includes("@kd/components");

  return profile.framework === "vue2" && hasRequiredDeps && hasRequiredFiles && hasKeenDataUi;
}

module.exports = {
  detectPreset,
  getPresetById,
  listPresets,
};
