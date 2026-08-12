const { spawnSync } = require("child_process");

/**
 * 在指定目录下执行 shell 命令
 * @param {string} command - 命令字符串
 * @param {string} cwd - 工作目录
 * @param {string} label - 日志标签
 * @param {object} options - 选项 { env: object }
 * @returns {number} 退出码 0 表示成功
 */
function runShellCommand(command, cwd, label, options = {}) {
  console.log(`[i18n-kit] ${label}: ${command}`);
  const result = spawnSync(command, {
    cwd,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });
  return result.status === 0 ? 0 : 1;
}

module.exports = {
  runShellCommand,
};
