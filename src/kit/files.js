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
    if (config.excludeDirs.includes(dirName)) return;

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
