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
 * @param {object} [options] - 修复选项
 * @param {boolean} [options.full=false] - 是否启用完整格式规则
 * @returns {object} { ok, fixedCount, errors, warnings }
 */
function runEslintFix(projectRoot, relativeFiles, options = {}) {
  if (relativeFiles.length === 0) {
    return { ok: true, fixedCount: 0, errors: [], warnings: [] };
  }

  if (!hasEslintConfig(projectRoot)) {
    return {
      ok: true,
      fixedCount: 0,
      errors: [],
      warnings: ["目标项目未配置 eslint，跳过自动修复"],
    };
  }

  if (!isEslintAvailable(projectRoot)) {
    return {
      ok: true,
      fixedCount: 0,
      errors: [],
      warnings: ["目标项目未安装 eslint，跳过自动修复"],
    };
  }

  // 只修复实际存在的文件
  const existingFiles = relativeFiles.filter((f) =>
    fs.existsSync(path.join(projectRoot, f)),
  );

  if (existingFiles.length === 0) {
    return { ok: true, fixedCount: 0, errors: [], warnings: [] };
  }

  const fileList = existingFiles
    .map((f) => `"${f.replace(/"/g, '\\"')}"`)
    .join(" ");

  // 使用 --fix 自动修复，--no-error-on-unmatched-pattern 避免文件不匹配时报错。
  // apply / inject 默认关闭容易改动既有排版的规则；write_file 使用完整模式。
  const eslintArgs = options.full
    ? "--fix --no-error-on-unmatched-pattern"
    : "--fix --no-error-on-unmatched-pattern --rule 'prettier/prettier: off' --rule 'no-console: off' --rule 'vue/max-attributes-per-line: off' --rule 'vue/first-attribute-linebreak: off' --rule 'vue/multiline-html-element-content-newline: off'";
  const eslintExecutable = fs.existsSync(
    path.join(projectRoot, "node_modules/.bin/eslint"),
  )
    ? "pnpm exec eslint"
    : "eslint";
  const command = `${eslintExecutable} ${eslintArgs} ${fileList}`;
  const result = runShellCommandCaptured(
    command,
    projectRoot,
    "eslint --fix 自动修复",
  );

  // eslint --fix 返回 0 表示无错误或已自动修复，返回 1 表示存在无法自动修复的错误。
  // 其他非零值表示配置、命令执行等严重问题。
  if (result.status !== 0 && result.status !== 1) {
    return {
      ok: false,
      fixedCount: 0,
      errors: [
        result.status === 2
          ? `eslint 配置错误: ${result.stderr.slice(0, 500)}`
          : `eslint 执行失败，退出码 ${result.status}: ${result.stderr.slice(0, 500)}`,
      ],
      warnings: [],
    };
  }

  if (options.full && result.status !== 0) {
    return {
      ok: false,
      fixedCount: existingFiles.length,
      errors: [
        result.status === 1
          ? "eslint 仍有无法自动修复的错误，请手动检查"
          : `eslint 执行失败，退出码 ${result.status}: ${result.stderr.slice(0, 500)}`,
      ],
      warnings: [],
    };
  }

  // 保守模式允许先完成自动修复，再由后续流程报告仍需手动处理的规则。
  return {
    ok: true,
    fixedCount: existingFiles.length,
    errors: [],
    warnings: result.status === 1 ? ["部分规则无法自动修复，需手动检查"] : [],
  };
}

module.exports = {
  hasEslintConfig,
  isEslintAvailable,
  runEslintFix,
};
