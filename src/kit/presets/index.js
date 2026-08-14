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
 * 获取默认 preset，用于未命中 preset 时回退检查
 * @returns {object} 默认 preset 对象
 */
function getDefaultPreset() {
  return keendataVue2VoerkaPreset;
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

  // preset 匹配基于项目类型（框架 + UI 库），不要求 i18n 基建已就位
  // doctor 的职责是检查哪些东西缺失，所以不能因为缺东西就不匹配 preset
  const hasKeenDataUi = profile.dependencies.includes("@kd/components");

  // 至少满足以下条件之一才算 KeenData Vue2 项目：
  // 1. 已安装 voerkai18n（说明正在接入或已接入 i18n）
  // 2. 已存在 i18n 基建文件（说明 scaffold 已执行过）
  const hasVoerka = profile.hasVoerka;
  const hasInfraFiles = fs.existsSync(
    path.join(projectRoot, "src/languages"),
  );

  return profile.framework === "vue2" && hasKeenDataUi && (hasVoerka || hasInfraFiles);
}

module.exports = {
  detectPreset,
  getPresetById,
  listPresets,
  getDefaultPreset,
};
