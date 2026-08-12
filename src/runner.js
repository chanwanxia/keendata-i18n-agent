const fs = require("fs");
const path = require("path");
const kit = require("./kit");
const { decideNextAction } = require("./policy");
const { createLlmClient } = require("./llm");

/**
 * 执行 agent 全流程
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} agentConfig - agent 配置
 * @param {object} flags - 命令行标志
 * @returns {object} 执行结果
 */
async function runAgent(projectRoot, agentConfig, flags = {}) {
  const llmClient = createLlmClient(agentConfig);
  const state = createInitialState(projectRoot, agentConfig, flags);

  for (let step = 0; step < agentConfig.maxSteps; step += 1) {
    state.stepCount = step + 1;

    const suggestion = decideNextAction(state);
    const allowedActions = [
      "init_config",
      "create_translation_file",
      "scaffold",
      "inject",
      "check_cli",
      "doctor",
      "scan",
      "apply",
      "extract",
      "translate",
      "glossary_repair",
      "validate",
      "compile",
      "finish",
      "stop",
    ];

    const decision = await maybeDecideWithLlm(llmClient, state, suggestion, allowedActions);
    const action = allowedActions.includes(decision.action) ? decision.action : suggestion.action;
    const reason = decision.reason || suggestion.reason;
    state.timeline.push({ step: state.stepCount, action, reason });

    if (action === "finish") {
      return finalizeState(state, true, "agent 流程执行完成");
    }
    if (action === "stop") {
      return finalizeState(state, false, reason || "agent 停止执行");
    }

    const execution = await executeAction(action, state, flags);
    if (execution && execution.stop) {
      return finalizeState(state, execution.ok, execution.message);
    }
  }

  return finalizeState(state, false, "超过最大步骤数，agent 主动停止");
}

/**
 * 创建初始状态
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} agentConfig - agent 配置
 * @param {object} flags - 命令行标志
 * @returns {object} 初始状态
 */
function createInitialState(projectRoot, agentConfig, flags) {
  const hasKitConfig = fs.existsSync(path.join(projectRoot, kit.CONFIG_FILE));
  const initialConfig = kit.loadProjectConfig(projectRoot);
  return {
    projectRoot,
    agentConfig,
    flags,
    stepCount: 0,
    timeline: [],
    bootstrap: {
      configReady: hasKitConfig,
      translationFileReady: fs.existsSync(path.join(projectRoot, initialConfig.translationFile)),
    },
    repairs: {
      glossaryRepairTried: false,
      injectRetried: false,
    },
    results: {
      scaffold: null,
      inject: null,
      checkCli: null,
      doctor: null,
      scan: null,
      apply: null,
      extract: null,
      translate: null,
      validate: null,
      compile: null,
      generated: null,
    },
  };
}

/**
 * 如果启用了 LLM 决策模式，用 LLM 决定下一步动作
 * @param {object} llmClient - LLM 客户端
 * @param {object} state - 当前状态
 * @param {object} suggestion - 规则引擎的建议
 * @param {string[]} allowedActions - 允许的动作列表
 * @returns {object} 决策结果
 */
async function maybeDecideWithLlm(llmClient, state, suggestion, allowedActions) {
  if (!llmClient) return suggestion;

  try {
    const decision = await llmClient.decide({
      state: summarizeStateForDecision(state),
      suggestedAction: suggestion,
      allowedActions,
    });
    if (!decision || !decision.action) return suggestion;
    return decision;
  } catch (error) {
    return {
      ...suggestion,
      reason: `${suggestion.reason}（LLM 决策失败，已回退规则模式：${error.message}）`,
    };
  }
}

/**
 * 执行指定动作
 * @param {string} action - 动作名称
 * @param {object} state - 当前状态
 * @param {object} flags - 命令行标志
 * @returns {object|null} 执行结果，null 表示继续
 */
async function executeAction(action, state, flags) {
  const projectRoot = state.projectRoot;

  if (action === "init_config") {
    if (!state.agentConfig.autoInitConfig) {
      return { stop: true, ok: false, message: "缺少 i18n-kit.config.json，且 agent 未开启 autoInitConfig" };
    }

    const profile = kit.detectProjectProfile(projectRoot);
    const config = kit.buildSuggestedConfig(profile);
    kit.writeProjectConfig(projectRoot, config, { force: false });
    state.bootstrap.configReady = true;
    state.bootstrap.translationFileReady = fs.existsSync(path.join(projectRoot, config.translationFile));
    return null;
  }

  if (action === "create_translation_file") {
    if (!state.agentConfig.autoCreateTranslationFile) {
      return { stop: true, ok: false, message: "缺少翻译源文件，且 agent 未开启 autoCreateTranslationFile" };
    }

    const config = kit.loadProjectConfig(projectRoot);
    const translationPath = path.join(projectRoot, config.translationFile);
    fs.mkdirSync(path.dirname(translationPath), { recursive: true });
    if (!fs.existsSync(translationPath)) {
      fs.writeFileSync(translationPath, "{}\n", "utf8");
    }
    state.bootstrap.translationFileReady = true;
    return null;
  }

  if (action === "scaffold") {
    if (!state.agentConfig.autoScaffold) {
      return { stop: true, ok: false, message: "未开启 autoScaffold" };
    }
    const profile = kit.detectProjectProfile(projectRoot);
    const config = kit.loadProjectConfig(projectRoot);
    state.results.scaffold = kit.scaffold(projectRoot, profile, config);
    console.log(`[i18n-agent] scaffold: 创建 ${state.results.scaffold.summary.createdCount} 个文件, 跳过 ${state.results.scaffold.summary.skippedCount} 个`);
    return null;
  }

  if (action === "inject") {
    if (!state.agentConfig.autoInject) {
      return { stop: true, ok: false, message: "未开启 autoInject" };
    }
    const profile = kit.detectProjectProfile(projectRoot);
    const config = kit.loadProjectConfig(projectRoot);
    state.results.inject = kit.inject(projectRoot, profile, config);
    console.log("[i18n-agent] inject: 依赖注入和代码改造完成");
    return null;
  }

  if (action === "check_cli") {
    const cliCheck = kit.checkGlobalCliVersion();
    state.results.checkCli = cliCheck;
    if (!cliCheck.ok) {
      return { stop: true, ok: false, message: cliCheck.message };
    }
    console.log(`[i18n-agent] ${cliCheck.message}`);
    return null;
  }

  const config = kit.loadProjectConfig(projectRoot);
  state.bootstrap.translationFileReady = fs.existsSync(path.join(projectRoot, config.translationFile));

  if (action === "doctor") {
    const profile = kit.detectProjectProfile(projectRoot);
    state.results.doctor = kit.inspectProjectSetup(projectRoot, profile, config);
    return null;
  }

  if (action === "scan") {
    state.results.scan = kit.scanHardcodedChinese(projectRoot, config);
    console.log(`[i18n-agent] scan: 发现 ${state.results.scan.summary.candidateCount} 处待国际化文案`);
    return null;
  }

  if (action === "apply") {
    state.results.apply = kit.applyI18n(projectRoot, config, { dryRun: false });
    console.log(`[i18n-agent] apply: 改写 ${state.results.apply.summary.changedFileCount} 个文件, ${state.results.apply.summary.replacementCount} 处替换`);
    return null;
  }

  if (action === "extract") {
    const status = kit.runShellCommand(config.extractCommand, projectRoot, "agent 执行词条提取");
    state.results.extract = { ok: status === 0, command: config.extractCommand };
    if (!state.results.extract.ok) {
      return { stop: true, ok: false, message: "extract 执行失败" };
    }
    return null;
  }

  if (action === "translate") {
    state.results.translate = await kit.translateTranslations(projectRoot, config, {
      provider: flags.provider || (config.translate && config.translate.provider),
      appidEnv: flags.appidEnv,
      appkeyEnv: flags.appkeyEnv,
    });
    return null;
  }

  if (action === "glossary_repair") {
    state.repairs.glossaryRepairTried = true;
    state.results.translate = await kit.translateTranslations(projectRoot, config, {
      provider: "none",
    });
    return null;
  }

  if (action === "validate") {
    const report = kit.validateTranslations(projectRoot, config);
    const generated = kit.inspectGeneratedFiles(projectRoot, config);
    state.results.validate = { ...report, generated, ok: report.ok && generated.ok };
    return null;
  }

  if (action === "compile") {
    const status = kit.runShellCommand(config.compileCommand, projectRoot, "agent 执行语言包编译");
    state.results.compile = { ok: status === 0, command: config.compileCommand };
    state.results.generated = kit.inspectGeneratedFiles(projectRoot, config);
    if (!state.results.compile.ok || !state.results.generated.ok) {
      return { stop: true, ok: false, message: "compile 执行失败或产物缺失" };
    }
  }

  return null;
}

/**
 * 将状态摘要为 LLM 决策可用的格式
 * @param {object} state - 当前状态
 * @returns {object} 状态摘要
 */
function summarizeStateForDecision(state) {
  return {
    stepCount: state.stepCount,
    bootstrap: state.bootstrap,
    repairs: state.repairs,
    results: {
      scaffold: summarizeResult(state.results.scaffold),
      inject: summarizeResult(state.results.inject),
      checkCli: summarizeResult(state.results.checkCli),
      doctor: summarizeResult(state.results.doctor),
      scan: summarizeResult(state.results.scan),
      apply: summarizeResult(state.results.apply),
      extract: summarizeResult(state.results.extract),
      translate: summarizeResult(state.results.translate),
      validate: summarizeResult(state.results.validate),
      compile: summarizeResult(state.results.compile),
      generated: summarizeResult(state.results.generated),
    },
  };
}

/**
 * 摘要单个结果
 * @param {object} result - 结果对象
 * @returns {object} 摘要
 */
function summarizeResult(result) {
  if (!result) return null;
  if (result.summary) return { summary: result.summary, ok: result.ok };
  if (typeof result.ok === "boolean") return result;
  return result;
}

/**
 * 完成状态并返回最终结果
 * @param {object} state - 当前状态
 * @param {boolean} ok - 是否成功
 * @param {string} message - 结果消息
 * @returns {object} 最终结果
 */
function finalizeState(state, ok, message) {
  return {
    ok,
    message,
    projectRoot: state.projectRoot,
    stepCount: state.stepCount,
    timeline: state.timeline,
    bootstrap: state.bootstrap,
    repairs: state.repairs,
    results: state.results,
  };
}

module.exports = {
  runAgent,
};
