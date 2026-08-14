/**
 * ESLint 自动修复工具
 *
 * 在 apply / inject 写入文件后，自动对目标项目执行 eslint --fix，
 * 修复因 AST 生成引入的多余空格、格式不规范等问题。
 */
const { runShellCommandCaptured } = require("./shell");
const path = require("path");
const fs = require("fs");

/**
 * 检测目标项目是否配置了 ESLint
 * @param {string} projectRoot - 目标项目根路径
 * @returns {boolean} 是否存在 eslint 配置
 */
function hasEslintConfig(projectRoot) {
  const configFiles = [
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
  ];

  if (configFiles.some((f) => fs.existsSync(path.join(projectRoot, f)))) {
    return true;
  }

  // 检查 package.json 中是否有 eslintConfig 字段
  const pkgPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return Boolean(pkg.eslintConfig);
  }

  return false;
}

/**
 * 检测目标项目是否安装了 eslint（本地或全局）
 * @param {string} projectRoot - 目标项目根路径
 * @returns {boolean} 是否可用 eslint
 */
function isEslintAvailable(projectRoot) {
  const localEslint = path.join(projectRoot, "node_modules/.bin/eslint");
  if (fs.existsSync(localEslint)) return true;

  const result = runShellCommandCaptured(
    "eslint --version",
    projectRoot,
    "检测 eslint 版本",
  );
  return result.status === 0;
}

/**
 * 对指定文件列表执行 eslint --fix
 * @param {string} projectRoot - 目标项目根路径
 * @param {string[]} relativeFiles - 相对路径文件列表
 * @returns {object} { ok, fixedCount, errors }
 */
function runEslintFix(projectRoot, relativeFiles) {
  if (relativeFiles.length === 0) {
    return { ok: true, fixedCount: 0, errors: [] };
  }

  if (!hasEslintConfig(projectRoot)) {
    return {
      ok: true,
      fixedCount: 0,
      errors: ["目标项目未配置 eslint，跳过自动修复"],
    };
  }

  if (!isEslintAvailable(projectRoot)) {
    return {
      ok: true,
      fixedCount: 0,
      errors: ["目标项目未安装 eslint，跳过自动修复"],
    };
  }

  // 只修复实际存在的文件
  const existingFiles = relativeFiles.filter((f) =>
    fs.existsSync(path.join(projectRoot, f)),
  );

  if (existingFiles.length === 0) {
    return { ok: true, fixedCount: 0, errors: [] };
  }

  const fileList = existingFiles
    .map((f) => `"${f.replace(/"/g, '\\"')}"`)
    .join(" ");

  // 使用 --fix 自动修复，--no-error-on-unmatched-pattern 避免文件不匹配时报错
  // --fix-only 仅修复可自动修复的问题
  // --rule 'prettier/prettier: off' 禁用 prettier 格式化，避免清除项目原有注释和格式
  // --rule 'no-console: off' 不修改项目原有的 console 语句
  const command = `npx eslint --fix --no-error-on-unmatched-pattern --rule 'prettier/prettier: off' --rule 'no-console: off' ${fileList}`;
  const result = runShellCommandCaptured(
    command,
    projectRoot,
    "eslint --fix 自动修复",
  );

  // eslint --fix 返回 0 表示无错误或已自动修复，返回 1 表示存在无法自动修复的错误
  // 返回 2 表示配置错误等严重问题
  if (result.status === 2) {
    return {
      ok: false,
      fixedCount: 0,
      errors: [`eslint 配置错误: ${result.stderr.slice(0, 500)}`],
    };
  }

  // status 0 或 1 都算修复完成（1 表示有残留错误但 fix 已执行）
  return {
    ok: true,
    fixedCount: existingFiles.length,
    errors: result.status === 1 ? ["部分规则无法自动修复，需手动检查"] : [],
  };
}

module.exports = {
  hasEslintConfig,
  isEslintAvailable,
  runEslintFix,
};
