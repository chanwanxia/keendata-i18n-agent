/**
 * 根据当前状态决定下一步动作
 * @param {object} state - agent 运行状态
 * @returns {object} { action, reason }
 */
function decideNextAction(state) {
  if (!state.bootstrap.configReady) return { action: "init_config", reason: "目标项目缺少 i18n-kit.config.json" };
  if (!state.bootstrap.translationFileReady) {
    return { action: "create_translation_file", reason: "目标项目缺少翻译源文件" };
  }
  if (!state.results.scaffold && state.agentConfig.autoScaffold) {
    return { action: "scaffold", reason: "写入 i18n 基础设施文件" };
  }
  if (!state.results.inject && state.agentConfig.autoInject) {
    return { action: "inject", reason: "注入 i18n 相关代码到 main.js / vue.config.js / App.vue" };
  }
  if (!state.results.checkCli) return { action: "check_cli", reason: "检查全局 voerkai18n CLI 版本" };
  if (!state.results.doctor) return { action: "doctor", reason: "检查基建" };
  if (state.results.doctor.summary.failCount > 0) {
    if (!state.repairs.injectRetried && state.agentConfig.autoInject) {
      state.repairs.injectRetried = true;
      return { action: "inject", reason: "doctor 检测到基建缺失，重试注入" };
    }
    return { action: "stop", reason: "doctor 仍有 fail 项，超出当前自动修复范围" };
  }
  if (!state.results.scan) return { action: "scan", reason: "扫描待处理中文" };
  if (state.results.scan.summary.candidateCount > 0 && !state.results.apply) {
    return { action: "apply", reason: "扫描发现待国际化文案，执行自动改写" };
  }
  if (!state.results.extract) return { action: "extract", reason: "提取词条" };
  if (!state.results.translate) return { action: "translate", reason: "执行翻译" };
  if (
    state.results.translate &&
    state.results.translate.ok === false &&
    state.results.translate.placeholderMismatches &&
    state.results.translate.placeholderMismatches.length > 0 &&
    !state.repairs.glossaryRepairTried
  ) {
    return { action: "glossary_repair", reason: "翻译后占位符不一致，尝试 glossary 二次修复" };
  }
  if (!state.results.validate) return { action: "validate", reason: "校验翻译结果" };
  if (state.results.validate.ok === false) {
    return { action: "stop", reason: "validate 未通过" };
  }
  if (!state.results.compile) return { action: "compile", reason: "执行最终编译" };
  return { action: "finish", reason: "流程已完成" };
}

module.exports = {
  decideNextAction,
};
