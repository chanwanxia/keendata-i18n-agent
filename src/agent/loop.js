const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { toToolDefinitions } = require("./tools");

/** checkpoint 存储目录（~/.kd-i18n/checkpoints/），不污染目标项目 */
const CHECKPOINT_DIR = path.join(os.homedir(), ".kd-i18n", "checkpoints");
/** 超过此步数后开始裁剪历史 tool 结果，减小 context window */
const CONTEXT_TRIM_THRESHOLD = 15;
/** 裁剪时保留最近多少步的完整 tool 结果 */
const CONTEXT_TRIM_KEEP_RECENT = 8;
/** 裁剪后旧 tool 结果保留的字符数 */
const CONTEXT_TRIM_KEEP_CHARS = 120;
/** 无限模式下连续相同工具调用的循环检测阈值 */
const LOOP_DETECT_THRESHOLD = 5;
/** 无限模式的安全上限，防止真正的死循环 */
const SAFETY_CAP = 2000;

/**
 * 将工具结果格式化为人类可读的简短摘要
 * @param {string} toolName - 工具名称
 * @param {object} result - 工具返回结果
 * @returns {string} 人类可读的摘要
 */
function formatToolResult(toolName, result) {
  if (!result) return "无返回";
  if (result.error) return `错误: ${result.error}`;

  switch (toolName) {
    case "read_file":
      return result.error
        ? `错误: ${result.error}`
        : `读取 ${result.relativePath} (${(result.content || "").length} 字符)`;

    case "write_file":
      return result.written
        ? `写入 ${result.relativePath} (${result.bytes} 字节)`
        : "写入失败";

    case "list_files":
      return `列出 ${result.directory} 下 ${result.fileCount} 个文件`;

    case "scaffold":
      if (!result.summary) return "基础设施检查完成";
      return [
        `创建 ${result.summary.createdCount || 0} 个文件`,
        `跳过 ${result.summary.skippedCount || 0} 个已存在文件`,
        result.summary.postcssUpdated ? "更新 postcss 配置" : null,
        result.summary.legacyCleaned ? "清理旧模板文件" : null,
        result.summary.actionColumnWidthUpdated ? "补齐操作列宽度 helper" : null,
        formatCleanupSuffix(result.cleanupSummary),
      ]
        .filter(Boolean)
        .join(", ");

    case "inject": {
      const count = countInjectUpdatedFiles(result);
      return count > 0
        ? `注入/更新 ${count} 个接入点`
        : "无需注入，接入点已是最新";
    }

    case "doctor": {
      const s = result.summary || {};
      return `${s.passCount || 0} 通过, ${s.warnCount || 0} 警告, ${s.failCount || 0} 失败`;
    }

    case "scan_chinese": {
      const s = result.summary || {};
      return `发现 ${result.totalCandidates || s.candidateCount || 0} 处待国际化文案 (${s.fileCount || 0} 个文件)`;
    }

    case "apply_i18n": {
      const s = result.summary || {};
      const changedFileCount = s.changedFileCount || result.totalChangedFiles || 0;
      return changedFileCount > 0
        ? `改写 ${changedFileCount} 个文件, ${s.replacementCount || 0} 处替换`
        : "无需改写，未发现可自动处理项";
    }

    case "cleanup_i18n": {
      const fileCount = getCleanupFileCount(result.summary, result.cleanedFiles);
      const fixCount = result.summary ? result.summary.totalFixes || 0 : 0;
      return fileCount > 0
        ? `清理 ${fileCount} 个文件, 修复 ${fixCount} 处历史问题`
        : "无需清理，未发现历史遗留问题";
    }

    case "extract_entries":
      return result.ok ? "词条提取成功" : `词条提取失败: ${(result.stderr || "").slice(0, 80)}`;

    case "translate_entries": {
      const s = result.summary || {};
      const provider = result.provider ? result.provider.used || "unknown" : "unknown";
      const count = s.translatedCount || s.filledCount || 0;
      const remaining =
        result.provider && typeof result.provider.remainingCount === "number"
          ? `, 剩余 ${result.provider.remainingCount} 个缺失翻译`
          : "";
      const issueSuffix =
        result.issues && result.issues.length
          ? `, ${result.issues.length} 个校验问题`
          : "";
      if (result.provider && result.provider.executed === false) {
        return `未执行外部翻译 (provider: ${provider}), 本地补齐 ${count} 条${issueSuffix}`;
      }
      return `保存 ${count} 个缺失翻译 (provider: ${provider})${remaining}${issueSuffix}`;
    }

    case "validate_translations": {
      const s = result.summary || {};
      return result.ok
        ? "翻译校验通过"
        : `${s.issueCount || 0} 个问题, ${s.missingLanguageCount || 0} 语言缺失`;
    }

    case "compile_languages":
      return result.ok
        ? `编译成功${result.idMapFixed ? " (已修复 idMap)" : ""}`
        : `编译失败: ${(result.stderr || "").slice(0, 80)}`;

    case "check_generated_files":
      return result.ok
        ? "运行时产物完整"
        : `缺失 ${(result.missingFiles || result.missing || []).length} 个产物文件`;

    case "run_shell":
      return result.ok
        ? `命令执行成功`
        : `命令执行失败: ${(result.stderr || "").slice(0, 80)}`;

    default:
      return JSON.stringify(result).slice(0, 120);
  }
}

/**
 * 读取 cleanup 摘要中的清理文件数，兼容不同工具返回形态。
 * @param {object} summary - cleanup summary
 * @param {object[]} cleanedFiles - 清理文件列表
 * @returns {number} 清理文件数
 */
function getCleanupFileCount(summary, cleanedFiles) {
  if (summary && typeof summary.cleanedFileCount === "number") {
    return summary.cleanedFileCount;
  }
  if (summary && typeof summary.cleanedCount === "number") {
    return summary.cleanedCount;
  }
  return cleanedFiles ? cleanedFiles.length : 0;
}

/**
 * 统计 inject 工具实际更新的接入点数量。
 * @param {object} result - inject 工具返回结果
 * @returns {number} 更新数量
 */
function countInjectUpdatedFiles(result) {
  const summary = result.summary || {};
  const details = result.details || {};
  return [
    summary.packageJsonUpdated || (details.packageJson && details.packageJson.updated),
    summary.mainJsUpdated || (details.mainJs && details.mainJs.updated),
    summary.vueConfigUpdated || (details.vueConfig && details.vueConfig.updated),
    summary.appVueUpdated || (details.appVue && details.appVue.updated),
    summary.interceptorsUpdated ||
      (details.interceptors && details.interceptors.updated),
    summary.layoutHeaderUpdated ||
      (details.layoutHeader && details.layoutHeader.updated),
  ].filter(Boolean).length;
}

/**
 * 格式化 scaffold 后附带的 cleanup 摘要。
 * @param {object} summary - cleanup summary
 * @returns {string|null} cleanup 摘要
 */
function formatCleanupSuffix(summary) {
  const cleanedFileCount = getCleanupFileCount(summary);
  if (cleanedFileCount <= 0) return null;
  return `清理 ${cleanedFileCount} 个历史文件问题`;
}

/**
 * 裁剪 messages 中较早的 tool 结果，减小 context window 加速 LLM 调用。
 * 保留 system/user 消息和最近 N 步的完整 tool 结果，旧结果截断为摘要。
 * @param {object[]} messages - 消息数组（原地修改）
 * @returns {void}
 */
function trimContext(messages) {
  const toolIndices = [];
  messages.forEach((msg, i) => {
    if (msg.role === "tool") toolIndices.push(i);
  });

  const cutoff = toolIndices.length - CONTEXT_TRIM_KEEP_RECENT;
  for (let i = 0; i < cutoff; i += 1) {
    const msg = messages[toolIndices[i]];
    if (msg.content && msg.content.length > CONTEXT_TRIM_KEEP_CHARS) {
      msg.content =
        msg.content.slice(0, CONTEXT_TRIM_KEEP_CHARS) + "...[已截断]";
    }
  }
}

/**
 * 检测连续相同工具调用（死循环检测）
 * @param {object[]} recentCalls - 最近几次调用的 { tool, argsHash } 数组
 * @returns {boolean} 是否检测到死循环
 */
function isLooping(recentCalls) {
  if (recentCalls.length < LOOP_DETECT_THRESHOLD) return false;
  const last = recentCalls[recentCalls.length - 1];
  let consecutive = 0;
  for (let i = recentCalls.length - 1; i >= 0; i -= 1) {
    if (
      recentCalls[i].tool === last.tool &&
      recentCalls[i].argsHash === last.argsHash
    ) {
      consecutive += 1;
    } else {
      break;
    }
  }
  return consecutive >= LOOP_DETECT_THRESHOLD;
}

/**
 * 根据项目根路径计算 checkpoint 文件路径
 * 使用项目路径的 MD5 hash 作为文件名，避免路径中的特殊字符
 * @param {string} projectRoot - 项目根路径
 * @returns {string} checkpoint 文件绝对路径
 */
function getCheckpointPath(projectRoot) {
  const hash = crypto
    .createHash("md5")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 16);
  return path.join(CHECKPOINT_DIR, `${hash}.json`);
}

/**
 * 加载 checkpoint 文件以恢复中断的执行
 * @param {string} projectRoot - 项目根路径
 * @returns {object|null} checkpoint 数据或 null
 */
function loadCheckpoint(projectRoot) {
  if (!projectRoot) return null;
  const checkpointPath = getCheckpointPath(projectRoot);
  if (!fs.existsSync(checkpointPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    if (!data.messages || !Array.isArray(data.messages)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * 保存 checkpoint 文件，记录当前执行状态以支持恢复
 * @param {string} projectRoot - 项目根路径
 * @param {object} data - checkpoint 数据
 * @returns {void}
 */
function saveCheckpoint(projectRoot, data) {
  if (!projectRoot) return;
  const checkpointPath = getCheckpointPath(projectRoot);
  try {
    fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
    fs.writeFileSync(checkpointPath, JSON.stringify(data), "utf8");
  } catch {
    // checkpoint 保存失败不应中断主流程
  }
}

/**
 * 清除 checkpoint 文件（任务完成后或 --no-resume 时调用）
 * @param {string} projectRoot - 项目根路径
 * @returns {void}
 */
function clearCheckpoint(projectRoot) {
  if (!projectRoot) return;
  const checkpointPath = getCheckpointPath(projectRoot);
  try {
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
  } catch {
    // ignore
  }
}

/**
 * 执行 tool-calling agent loop
 *
 * 支持特性：
 * - 动态步数：maxSteps=0 表示自动模式（安全上限 SAFETY_CAP），不会因固定上限中断
 * - 断点续传：自动保存/加载 checkpoint（存储在 ~/.kd-i18n/checkpoints/），中断后重新 run 从上次位置继续
 * - 上下文裁剪：定期截断旧 tool 结果，保持 LLM 调用速度
 * - 循环检测：连续相同调用超过阈值时自动停止
 * - 友好日志：显示 [step N/~total] 和人类可读的工具结果摘要
 *
 * @param {object} client - openai SDK 客户端实例
 * @param {string} model - 模型名称
 * @param {string} systemPrompt - system prompt
 * @param {object[]} tools - 工具数组（含 execute 函数）
 * @param {object} options - 选项 { maxSteps, projectRoot, resume, estimatedTotal }
 * @returns {object} { ok, message, stepCount, timeline }
 */
async function runAgentLoop(
  client,
  model,
  systemPrompt,
  tools,
  options = {},
) {
  const {
    maxSteps = 0,
    projectRoot = null,
    resume = true,
    estimatedTotal = 0,
  } = options;

  const toolDefinitions = toToolDefinitions(tools);
  const timeline = [];
  let messages;
  let startStep = 0;
  let stepCount = 0;
  const recentCalls = [];
  const startTime = Date.now();

  // --no-resume：清除旧 checkpoint，从头开始
  if (!resume && projectRoot) {
    clearCheckpoint(projectRoot);
  }

  // 尝试从 checkpoint 恢复
  if (resume && projectRoot) {
    const checkpoint = loadCheckpoint(projectRoot);
    if (checkpoint) {
      messages = checkpoint.messages;
      startStep = checkpoint.stepCount || 0;
      stepCount = startStep;
      if (checkpoint.timeline) {
        timeline.push(...checkpoint.timeline);
      }
      console.log(
        `[i18n-agent] 从第 ${startStep} 步恢复执行（共 ${timeline.length} 条历史记录）`,
      );
    }
  }

  if (!messages) {
    messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: "请开始执行国际化流程。" },
    ];
  }

  // maxSteps=0 表示自动模式，使用安全上限
  const hardLimit = maxSteps > 0 ? maxSteps : SAFETY_CAP;

  for (let step = startStep; step < hardLimit; step += 1) {
    // 定期裁剪上下文，保持 LLM 调用速度
    if (step >= CONTEXT_TRIM_THRESHOLD && step % 10 === 0) {
      trimContext(messages);
    }

    const stepStart = Date.now();

    let response;
    try {
      response = await client.chat.completions.create({
        model,
        messages,
        tools: toolDefinitions,
        temperature: 0,
      });
    } catch (err) {
      // 保存 checkpoint 以便恢复
      if (projectRoot) {
        saveCheckpoint(projectRoot, {
          messages,
          stepCount: step,
          timeline,
          model,
          projectRoot,
        });
      }
      return {
        ok: false,
        message: formatLlmFailureMessage(err, Boolean(projectRoot)),
        stepCount: step,
        timeline,
      };
    }

    const message = response.choices[0].message;
    messages.push(message);

    // 没有 tool_calls 说明 agent 认为任务完成了
    if (!message.tool_calls || message.tool_calls.length === 0) {
      if (projectRoot) clearCheckpoint(projectRoot);
      const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `[i18n-agent] 流程完成，共 ${step + 1} 步，耗时 ${totalElapsed}s`,
      );
      return {
        ok: true,
        message: message.content || "agent 流程执行完成",
        stepCount: step + 1,
        timeline,
      };
    }

    // 依次执行每个 tool call
    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      const tool = tools.find((t) => t.name === toolName);

      let result;
      let args = {};
      if (!tool) {
        result = { error: `未知工具: ${toolName}` };
      } else {
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          args = {};
        }
        try {
          result = await tool.execute(args);
        } catch (err) {
          result = { error: err.message };
        }
      }

      const resultJson = JSON.stringify(result);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: resultJson,
      });

      timeline.push({
        step: step + 1,
        action: toolName,
        reason: toolCall.function.arguments || "{}",
        result: resultJson.slice(0, 500),
      });

      const toolElapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
      const summary = formatToolResult(toolName, result);
      const stepDisplay =
        estimatedTotal > 0
          ? `${step + 1}/~${estimatedTotal}`
          : `${step + 1}`;
      console.log(
        `[i18n-agent] [${stepDisplay}] ${toolName} → ${summary} (${toolElapsed}s)`,
      );

      // 循环检测：记录最近调用，检测死循环
      const argsHash = JSON.stringify(args);
      recentCalls.push({ tool: toolName, argsHash });
      if (recentCalls.length > LOOP_DETECT_THRESHOLD + 2) {
        recentCalls.shift();
      }
      if (maxSteps === 0 && isLooping(recentCalls)) {
        if (projectRoot) {
          saveCheckpoint(projectRoot, {
            messages,
            stepCount: step + 1,
            timeline,
            model,
            projectRoot,
          });
        }
        return {
          ok: false,
          message: `检测到连续 ${LOOP_DETECT_THRESHOLD} 次相同工具调用 (${toolName})，agent 已停止以避免重复改写。${formatResumeHint(Boolean(projectRoot))}`,
          stepCount: step + 1,
          timeline,
        };
      }
    }

    stepCount = step + 1;

    // 每步保存 checkpoint
    if (projectRoot) {
      saveCheckpoint(projectRoot, {
        messages,
        stepCount,
        timeline,
        model,
        projectRoot,
      });
    }
  }

  // 达到步数上限，checkpoint 已保存，重新 run 可继续
  const resumeHint = formatResumeHint(Boolean(projectRoot));
  return {
    ok: false,
    message:
      maxSteps > 0
        ? `已达到 --max-steps=${maxSteps}，流程尚未确认完成。${resumeHint}`
        : `已达到安全上限 ${SAFETY_CAP} 步，流程尚未确认完成。${resumeHint}`,
    stepCount,
    timeline,
  };
}

/**
 * 格式化 checkpoint 恢复提示。
 * @param {boolean} hasCheckpoint - 是否存在可保存 checkpoint 的项目路径
 * @returns {string} 恢复提示
 */
function formatResumeHint(hasCheckpoint) {
  return hasCheckpoint
    ? "已保存 checkpoint，重新执行 kd-i18n run 可继续；如需从头开始请加 --no-resume。"
    : "当前未绑定项目路径，未保存 checkpoint。";
}

/**
 * 格式化 LLM 调用失败提示，附带限流和恢复建议。
 * @param {Error} error - LLM 调用错误
 * @param {boolean} hasCheckpoint - 是否已保存 checkpoint
 * @returns {string} 失败提示
 */
function formatLlmFailureMessage(error, hasCheckpoint) {
  const reason = error && error.message ? error.message : "未知错误";
  return `LLM 调用失败: ${reason}。请检查 LLM_API_KEY、网络或服务限流状态。${formatResumeHint(hasCheckpoint)}`;
}

module.exports = {
  runAgentLoop,
  formatToolResult,
  trimContext,
  loadCheckpoint,
  saveCheckpoint,
  clearCheckpoint,
  getCheckpointPath,
  CHECKPOINT_DIR,
  formatLlmFailureMessage,
};
