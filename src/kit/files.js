const fs = require("fs");
const path = require("path");

/**
 * 收集项目中所有需要处理的目标文件
 * @param {string} projectRoot - 项目根路径
 * @param {object} config - i18n 配置
 * @returns {array} 文件绝对路径数组
 */
function collectTargetFiles(projectRoot, config) {
  const files = [];
  config.include.forEach((entry) => walk(path.join(projectRoot, entry), projectRoot, config, files));
  return files;
}

/**
 * 递归遍历目录收集目标文件
 * @param {string} currentPath - 当前路径
 * @param {string} projectRoot - 项目根路径
 * @param {object} config - i18n 配置
 * @param {array} files - 累积的文件数组
 */
function walk(currentPath, projectRoot, config, files) {
  if (!fs.existsSync(currentPath)) return;

  const stats = fs.statSync(currentPath);
  if (stats.isDirectory()) {
    const dirName = path.basename(currentPath);
    const relativePath = toRelative(projectRoot, currentPath);
    if (isExcludedDirectory(dirName, relativePath, config.excludeDirs)) return;

    fs.readdirSync(currentPath).forEach((name) => {
      walk(path.join(currentPath, name), projectRoot, config, files);
    });
    return;
  }

  const relativePath = toRelative(projectRoot, currentPath);
  if (config.excludeFiles.includes(relativePath)) return;
  if (!config.extensions.includes(path.extname(currentPath))) return;
  files.push(currentPath);
}

/**
 * 判断目录是否命中排除规则；兼容目录名（dist）和相对路径前缀（src/assets）。
 * @param {string} dirName - 当前目录名
 * @param {string} relativePath - 当前目录相对项目根路径
 * @param {string[]} excludeDirs - 排除目录配置
 * @returns {boolean} 是否排除该目录
 */
function isExcludedDirectory(dirName, relativePath, excludeDirs = []) {
  return excludeDirs.some((entry) => {
    const normalized = String(entry || "").replace(/\\/g, "/").replace(/\/+$/g, "");
    if (!normalized) return false;
    if (!normalized.includes("/")) return dirName === normalized;
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  });
}

/**
 * 将绝对路径转换为相对项目根路径
 * @param {string} projectRoot - 项目根路径
 * @param {string} filePath - 文件路径
 * @returns {string} 相对路径（正斜杠分隔）
 */
function toRelative(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

module.exports = {
  collectTargetFiles,
  toRelative,
};
