const {
  buildSuggestedConfig,
  detectProjectProfile,
  loadProjectConfig,
  resolveProjectRoot,
  writeProjectConfig,
} = require("./config");
const { getPresetById, listPresets } = require("./presets");
const { applyI18n } = require("./apply");
const { cleanupI18n } = require("./apply");
const { inspectProjectSetup } = require("./doctor");
const { inject, checkGlobalCliVersion } = require("./inject");
const { scaffold } = require("./scaffold");
const { scanHardcodedChinese } = require("./scan");
const { translateTranslations } = require("./translate");
const { validateTranslations, inspectGeneratedFiles, postCompileFix } = require("./validate");
const { runShellCommand } = require("./shell");

async function main(argv) {
  const { command, flags } = parseArgs(argv);
  if (isHelpCommand(command)) {
    printHelp();
    return;
  }

  const projectRoot = resolveProjectRoot(flags.project);
  const profile = detectProjectProfile(projectRoot);
  const config = loadProjectConfig(projectRoot);

  switch (command) {
    case "init":
      initCommand(projectRoot, profile, config, flags);
      return;
    case "profile":
      printProfile(projectRoot, profile, flags);
      return;
    case "doctor":
      process.exit(doctorCommand(projectRoot, profile, config, flags));
      return;
    case "rules":
    case "preset":
      printRules(projectRoot, profile, flags);
      return;
    case "scan":
      process.exit(scanCommand(projectRoot, config, flags));
      return;
    case "apply":
      process.exit(applyCommand(projectRoot, config, flags));
      return;
    case "translate":
      process.exit(await translateCommand(projectRoot, config, flags));
      return;
    case "validate":
      process.exit(validateCommand(projectRoot, config, flags));
      return;
    case "extract":
      process.exit(
        runShellCommand(config.extractCommand, projectRoot, "执行词条提取"),
      );
      return;
    case "compile":
      process.exit(
        runShellCommand(config.compileCommand, projectRoot, "执行语言包编译"),
      );
      return;
    case "scaffold":
      process.exit(scaffoldCommand(projectRoot, profile, config, flags));
      return;
    case "inject":
      process.exit(injectCommand(projectRoot, profile, config, flags));
      return;
    case "audit":
      process.exit(auditCommand(projectRoot, profile, config, flags));
      return;
    case "agent":
    case "run":
      process.exit(await runCommand(projectRoot, config, flags));
      return;
    default:
      printHelp();
  }
}

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const flags = {};

  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];

    if (item === "--dry-run") flags.dryRun = true;
    if (item === "--json") flags.json = true;
    if (item === "--strict") flags.strict = true;
    if (item === "--no-apply") flags.noApply = true;
    if (item === "--no-extract") flags.noExtract = true;
    if (item === "--no-translate") flags.noTranslate = true;
    if (item === "--no-compile") flags.noCompile = true;
    if (item === "--fail-on-scan") flags.failOnScan = true;
    if (item === "--write-config") flags.writeConfig = true;
    if (item === "--force") flags.force = true;
    if (item === "--provider") flags.provider = rest[i + 1];
    if (item === "--appid-env") flags.appidEnv = rest[i + 1];
    if (item === "--appkey-env") flags.appkeyEnv = rest[i + 1];
    if (item === "--project") flags.project = rest[i + 1];
    if (
      item === "--provider" ||
      item === "--appid-env" ||
      item === "--appkey-env" ||
      item === "--project"
    )
      i += 1;
  }

  return { command, flags };
}

function initCommand(projectRoot, profile, config, flags) {
  if (flags.writeConfig) {
    const configPath = writeProjectConfig(projectRoot, config, {
      force: flags.force,
    });
    const output = {
      projectRoot,
      configPath,
      profile,
      config,
    };
    if (flags.json) {
      printJson(output);
    } else {
      console.log(`[i18n-kit] 已写入配置文件: ${configPath}`);
      printProfile(projectRoot, profile, {});
    }
    return;
  }

  printInitTemplate(projectRoot, profile, config, flags);
}

function scanCommand(projectRoot, config, flags) {
  const scanReport = scanHardcodedChinese(projectRoot, config);

  if (flags.json) {
    printJson(scanReport);
  } else {
    printScanReport(projectRoot, scanReport);
  }

  if (flags.strict && scanReport.summary.candidateCount > 0) return 1;
  return 0;
}

function applyCommand(projectRoot, config, flags) {
  const report = applyI18n(projectRoot, config, { dryRun: !!flags.dryRun });

  if (flags.json) {
    printJson(report);
  } else {
    printApplyReport(projectRoot, report);
  }

  return report.ok ? 0 : 1;
}

async function translateCommand(projectRoot, config, flags) {
  const report = await translateTranslations(projectRoot, config, {
    provider: flags.provider,
    appidEnv: flags.appidEnv,
    appkeyEnv: flags.appkeyEnv,
  });

  if (flags.json) {
    printJson(report);
  } else {
    printTranslateReport(projectRoot, report);
  }

  return report.ok ? 0 : 1;
}

function validateCommand(projectRoot, config, flags) {
  const report = validateTranslations(projectRoot, config);
  const generated = inspectGeneratedFiles(projectRoot, config);
  const output = {
    ...report,
    generated,
    ok: report.ok && generated.ok,
  };

  if (flags.json) {
    printJson(output);
  } else {
    printValidateReport(projectRoot, output);
  }

  return output.ok ? 0 : 1;
}

function doctorCommand(projectRoot, profile, config, flags) {
  const report = inspectProjectSetup(projectRoot, profile, config);

  if (flags.json) {
    printJson(report);
  } else {
    printDoctorReport(projectRoot, report);
  }

  return report.ok ? 0 : 1;
}

async function runCommand(projectRoot, config, flags) {
  const result = {
    projectRoot,
    doctor: inspectProjectSetup(
      projectRoot,
      detectProjectProfile(projectRoot),
      config,
    ),
    scan: scanHardcodedChinese(projectRoot, config),
    apply: { skipped: !!flags.noApply, ok: true },
    extract: { skipped: !!flags.noExtract, ok: true },
    translate: { skipped: !!flags.noTranslate, ok: true },
    validate: null,
    compile: { skipped: !!flags.noCompile, ok: true },
    generated: null,
    ok: true,
  };

  logStep("步骤 0/6 检查 i18n 基建");
  printDoctorReport(projectRoot, result.doctor);

  logStep("步骤 1/6 扫描疑似未国际化文案");
  printScanReport(projectRoot, result.scan);

  if (flags.failOnScan && result.scan.summary.candidateCount > 0) {
    result.ok = false;
    return finalizeRun(result, flags);
  }

  if (!flags.noApply) {
    logStep("步骤 1.5/6 清理遗留问题（嵌套 t()、重复 import）");
    const cleanupReport = cleanupI18n(projectRoot, config);
    if (cleanupReport.summary.cleanedFileCount > 0) {
      console.log(
        `[i18n-kit] cleanup: 修复 ${cleanupReport.summary.cleanedFileCount} 个文件, ${cleanupReport.summary.totalFixes} 处问题`,
      );
    }
    logStep("步骤 2/6 自动改写可安全提取的文案");
    result.apply = applyI18n(projectRoot, config);
    printApplyReport(projectRoot, result.apply);
    if (!result.apply.ok) {
      result.ok = false;
      return finalizeRun(result, flags);
    }
  }

  if (!flags.noExtract) {
    logStep("步骤 3/6 执行词条提取");
    result.extract.ok =
      runShellCommand(config.extractCommand, projectRoot, "执行词条提取") === 0;
    if (!result.extract.ok) {
      result.ok = false;
      return finalizeRun(result, flags);
    }
  }

  if (!flags.noTranslate) {
    logStep("步骤 4/6 自动补齐缺失翻译");
    result.translate = await translateTranslations(projectRoot, config, {
      provider: flags.provider,
      appidEnv: flags.appidEnv,
      appkeyEnv: flags.appkeyEnv,
    });
    printTranslateReport(projectRoot, result.translate);
    if (!result.translate.ok) {
      result.ok = false;
      return finalizeRun(result, flags);
    }
  }

  logStep(`步骤 5/6 校验翻译源${flags.noCompile ? "" : "与产物准备情况"}`);
  result.validate = validateTranslations(projectRoot, config);
  printValidateReport(projectRoot, result.validate);
  if (!result.validate.ok) {
    result.ok = false;
    return finalizeRun(result, flags);
  }

  if (!flags.noCompile) {
    logStep("步骤 6/6 执行语言包编译");
    result.compile.ok =
      runShellCommand(config.compileCommand, projectRoot, "执行语言包编译") ===
      0;
    if (!result.compile.ok) {
      result.ok = false;
      return finalizeRun(result, flags);
    }
    // compile 后统一修复：idMap.js 引号 + .prettierignore + eslint --fix
    postCompileFix(projectRoot, config);
  }

  result.generated = inspectGeneratedFiles(projectRoot, config);
  result.ok = result.generated.ok;
  return finalizeRun(result, flags);
}

function finalizeRun(result, flags) {
  if (flags.json) {
    printJson(result);
  } else {
    if (result.generated)
      printGeneratedReport(result.projectRoot, result.generated);
    console.log(`[i18n-kit] ${result.ok ? "执行完成" : "执行失败"}`);
  }
  return result.ok ? 0 : 1;
}

/**
 * 执行 scaffold 命令
 * @param {string} projectRoot - 项目根路径
 * @param {object} profile - 项目画像
 * @param {object} config - i18n 配置
 * @param {object} flags - 命令行标志
 * @returns {number} 退出码
 */
function scaffoldCommand(projectRoot, profile, config, flags) {
  const report = scaffold(projectRoot, profile, config, { force: flags.force });
  if (flags.json) {
    printJson(report);
  } else {
    console.log(
      `[i18n-kit] scaffold: 创建 ${report.summary.createdCount} 个文件, 跳过 ${report.summary.skippedCount} 个`,
    );
    if (report.created.length > 0) {
      report.created.forEach((f) => console.log(`  + ${f}`));
    }
    if (report.postcss.updated) {
      console.log(`[i18n-kit] postcss.config.js: ${report.postcss.action}`);
    }
  }
  return 0;
}

/**
 * 执行 inject 命令
 * @param {string} projectRoot - 项目根路径
 * @param {object} profile - 项目画像
 * @param {object} config - i18n 配置
 * @param {object} flags - 命令行标志
 * @returns {number} 退出码
 */
function injectCommand(projectRoot, profile, config, flags) {
  const report = inject(projectRoot, profile, config, { force: flags.force });
  if (flags.json) {
    printJson(report);
  } else {
    console.log("[i18n-kit] inject 结果:");
    console.log(
      `  package.json: ${report.details.packageJson.updated ? "已更新" : "无需更新"}`,
    );
    console.log(
      `  main.js: ${report.details.mainJs.updated ? "已注入" : "无需注入"}`,
    );
    console.log(
      `  vue.config.js: ${report.details.vueConfig.updated ? "已注入" : "无需注入"}`,
    );
    console.log(
      `  App.vue: ${report.details.appVue.updated ? "已注入" : "无需注入"}`,
    );
    console.log(
      `  interceptors: ${report.details.interceptors.updated ? "已注入" : "无需注入"}`,
    );
  }
  const cliCheck = checkGlobalCliVersion();
  if (!cliCheck.ok) {
    console.log(`[i18n-kit] 警告: ${cliCheck.message}`);
  }
  return 0;
}

/**
 * 执行 audit 命令，输出国际化合规性审计报告
 * @param {string} projectRoot - 项目根路径
 * @param {object} profile - 项目画像
 * @param {object} config - i18n 配置
 * @param {object} flags - 命令行标志
 * @returns {number} 退出码
 */
function auditCommand(projectRoot, profile, config, flags) {
  const report = {
    projectRoot,
    scan: scanHardcodedChinese(projectRoot, config),
    doctor: inspectProjectSetup(projectRoot, profile, config),
    validate: validateTranslations(projectRoot, config),
    generated: inspectGeneratedFiles(projectRoot, config),
  };
  report.ok =
    report.scan.summary.candidateCount === 0 &&
    report.doctor.ok &&
    report.validate.ok &&
    report.generated.ok;

  if (flags.json) {
    printJson(report);
  } else {
    console.log(`[i18n-kit] 审计报告: ${projectRoot}`);
    console.log(
      `[i18n-kit] 残留中文: ${report.scan.summary.candidateCount} 处`,
    );
    console.log(
      `[i18n-kit] 基建: ${report.doctor.summary.passCount} 通过, ${report.doctor.summary.warnCount} 警告, ${report.doctor.summary.failCount} 失败`,
    );
    console.log(
      `[i18n-kit] 翻译: ${report.validate.summary.missingLanguageCount} 缺失, ${report.validate.summary.issueCount} 问题`,
    );
    console.log(`[i18n-kit] 产物: ${report.generated.ok ? "完整" : "缺失"}`);
    console.log(`[i18n-kit] 总体: ${report.ok ? "合规" : "不合规"}`);
  }
  return report.ok ? 0 : 1;
}

function printInitTemplate(projectRoot, profile, config, flags) {
  const template = {
    projectRoot,
    profile,
    config,
    nextSteps: buildInitNextSteps(profile),
  };
  if (flags.json) {
    printJson(template);
  } else {
    console.log(`[i18n-kit] 目标项目: ${projectRoot}`);
    console.log("[i18n-kit] 下面是建议写入目标项目的配置模板:");
    printJson(config);
    console.log("[i18n-kit] 推荐接入步骤:");
    buildInitNextSteps(profile).forEach((step, index) => {
      console.log(`  ${index + 1}. ${step}`);
    });
  }
}

function printProfile(projectRoot, profile, flags) {
  const output = {
    projectRoot,
    profile,
    suggestedConfig: buildSuggestedConfig(profile),
  };

  if (flags.json) {
    printJson(output);
    return;
  }

  console.log(`[i18n-kit] 目标项目: ${projectRoot}`);
  console.log(`[i18n-kit] 包名: ${profile.packageName}`);
  console.log(`[i18n-kit] 包管理器: ${profile.packageManager}`);
  console.log(`[i18n-kit] 框架: ${profile.framework}`);
  console.log(`[i18n-kit] VoerkaI18n: ${profile.hasVoerka ? "yes" : "no"}`);
  console.log(`[i18n-kit] vue-i18n: ${profile.hasVueI18n ? "yes" : "no"}`);
  console.log(
    `[i18n-kit] 预设: ${profile.preset ? profile.preset.id : "none"}`,
  );
  console.log(`[i18n-kit] 语言目录: ${profile.languageDir}`);
  console.log(`[i18n-kit] 翻译源: ${profile.translationFile}`);
  console.log(`[i18n-kit] 语言列表: ${profile.languages.join(", ")}`);
  console.log(`[i18n-kit] 提取命令: ${output.suggestedConfig.extractCommand}`);
  console.log(`[i18n-kit] 编译命令: ${output.suggestedConfig.compileCommand}`);
}

function printRules(projectRoot, profile, flags) {
  const preset = profile.preset ? getPresetById(profile.preset.id) : null;
  const output = {
    projectRoot,
    preset: preset
      ? {
          id: preset.id,
          title: preset.title,
          rules: preset.rules,
        }
      : null,
    availablePresets: listPresets(),
  };

  if (flags.json) {
    printJson(output);
    return;
  }

  console.log(`[i18n-kit] 目标项目: ${projectRoot}`);
  if (!preset) {
    console.log("[i18n-kit] 当前项目未命中内置 preset");
    console.log(
      `[i18n-kit] 可用 preset: ${listPresets()
        .map((item) => item.id)
        .join(", ")}`,
    );
    return;
  }

  console.log(`[i18n-kit] 命中 preset: ${preset.id}`);
  console.log(`[i18n-kit] 标题: ${preset.title}`);
  console.log("[i18n-kit] 规则详情请使用 --json 查看");
}

function printDoctorReport(projectRoot, report) {
  console.log(`[i18n-kit] 目标项目: ${projectRoot}`);
  console.log(`[i18n-kit] 预设: ${report.preset ? report.preset.id : "none"}`);
  console.log(`[i18n-kit] 检查项: ${report.summary.total}`);
  console.log(`[i18n-kit] 通过: ${report.summary.passCount}`);
  console.log(`[i18n-kit] 警告: ${report.summary.warnCount}`);
  console.log(`[i18n-kit] 失败: ${report.summary.failCount}`);

  report.checks.forEach((item) => {
    console.log(`  - [${item.status}] ${item.id}: ${item.message}`);
    if (item.missing && item.missing.length > 0) {
      console.log(`    缺失: ${item.missing.join(" | ")}`);
    }
    if (item.missingImports && item.missingImports.length > 0) {
      console.log(`    缺失样式: ${item.missingImports.join(" | ")}`);
    }
    if (item.suggestion) {
      console.log(`    建议: ${item.suggestion}`);
    }
  });
}

function printScanReport(projectRoot, report) {
  console.log(`[i18n-kit] 目标项目: ${projectRoot}`);
  console.log(`[i18n-kit] 扫描文件数: ${report.summary.fileCount}`);
  console.log(`[i18n-kit] 疑似未国际化文案: ${report.summary.candidateCount}`);
  report.candidates.slice(0, 20).forEach((item) => {
    console.log(`  - ${item.file}:${item.line} ${item.text}`);
  });
  if (report.candidates.length > 20) {
    console.log(`  ... 其余 ${report.candidates.length - 20} 条已省略`);
  }
}

function printApplyReport(projectRoot, report) {
  console.log(`[i18n-kit] 目标项目: ${projectRoot}`);
  console.log(
    `[i18n-kit] 执行模式: ${report.summary.dryRun ? "dry-run" : "write"}`,
  );
  console.log(`[i18n-kit] 已改写文件数: ${report.summary.changedFileCount}`);
  console.log(`[i18n-kit] 总替换次数: ${report.summary.replacementCount}`);
  report.changedFiles.slice(0, 20).forEach((item) => {
    console.log(`  - ${item.file} (${item.replacements} 处)`);
    if (item.preview) {
      console.log(`    L${item.preview.line}: ${item.preview.before}`);
      console.log(`    => ${item.preview.after}`);
    }
  });
}

function printTranslateReport(projectRoot, report) {
  console.log(`[i18n-kit] 目标项目: ${projectRoot}`);
  if (!report.ok && report.summary && report.summary.missingFile) {
    console.log(`[i18n-kit] 未找到翻译源文件: ${report.summary.missingFile}`);
    return;
  }
  if (report.provider) {
    console.log(`[i18n-kit] 翻译 provider: ${report.provider.used}`);
    console.log(
      `[i18n-kit] provider 执行: ${report.provider.executed ? "yes" : "no"}`,
    );
    if (report.provider.credentialEnv) {
      console.log(
        `[i18n-kit] provider 凭证环境变量: ${report.provider.credentialEnv.appidEnv} / ${report.provider.credentialEnv.appkeyEnv}`,
      );
    }
    if (report.provider.message) {
      console.log(`[i18n-kit] provider 结果: ${report.provider.message}`);
    }
  }
  console.log(`[i18n-kit] 自动补齐翻译数: ${report.summary.filledCount}`);
  console.log(
    `[i18n-kit] 术语二次校正数: ${report.summary.correctedCount || 0}`,
  );
  console.log(`[i18n-kit] 翻译问题数: ${report.summary.issueCount || 0}`);
  report.filledItems.slice(0, 20).forEach((item) => {
    console.log(`  - ${item.language}: ${item.key} => ${item.value}`);
  });
  report.correctedItems?.slice(0, 10).forEach((item) => {
    console.log(`  - 校正 ${item.language}: ${item.key} => ${item.value}`);
  });
  (report.issues || []).slice(0, 10).forEach((item) => {
    const detail = formatIssue(item);
    console.log(`  - ${detail}`);
  });
}

function printValidateReport(projectRoot, report) {
  console.log(`[i18n-kit] 目标项目: ${projectRoot}`);
  if (report.missingFile) {
    console.log(`[i18n-kit] 未找到翻译源文件: ${report.missingFile}`);
    return;
  }

  console.log(`[i18n-kit] 词条总数: ${report.summary.entryCount}`);
  console.log(`[i18n-kit] 缺失翻译数: ${report.summary.missingLanguageCount}`);
  console.log(`[i18n-kit] 翻译问题数: ${report.summary.issueCount}`);

  report.missingLanguages.slice(0, 10).forEach((item) => {
    console.log(`  - 缺失翻译 ${item.language}: ${item.key}`);
  });
  (report.issues || []).slice(0, 20).forEach((item) => {
    const detail = formatIssue(item);
    console.log(`  - ${detail}`);
  });
  if ((report.issues || []).length > 20) {
    console.log(`  ... 其余 ${(report.issues || []).length - 20} 条已省略`);
  }
}

function printGeneratedReport(projectRoot, report) {
  console.log(`[i18n-kit] 目标项目: ${projectRoot}`);
  if (report.ok) {
    console.log("[i18n-kit] 运行时语言包产物检查通过");
    return;
  }
  console.log("[i18n-kit] 以下运行时语言包产物缺失:");
  report.missingFiles.forEach((item) => console.log(`  - ${item}`));
}

/**
 * 格式化单个翻译问题为可读字符串
 * @param {object} issue - 翻译问题
 * @returns {string} 可读描述
 */
function formatIssue(issue) {
  const typeLabel =
    {
      literal: "字面量未保留",
      placeholder: "占位符不一致",
      source_leakage: "源文残留",
    }[issue.type] || issue.type;

  if (issue.type === "literal") {
    return `${typeLabel} ${issue.language}: ${issue.key} | 缺失=${issue.missingLiterals.join(", ")}`;
  }
  if (issue.type === "placeholder") {
    return `${typeLabel} ${issue.language}: ${issue.key} | 源=${issue.sourcePlaceholders.join(",")} | 目标=${issue.translatedPlaceholders.join(",")}`;
  }
  if (issue.type === "source_leakage") {
    return `${typeLabel} ${issue.language}: ${issue.key} | 残留=${issue.leakedText}`;
  }
  return `${typeLabel} ${issue.language}: ${issue.key}`;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  console.log(`
@kd/i18n

用法:
  kd-i18n <command> --project /absolute/path/to/repo [flags]

命令:
  init       输出配置模板，或通过 --write-config 写入目标项目
  profile    探测目标项目的 i18n 接入画像
  doctor     按 preset 检查 i18n 基建、RTL 与关键接入点
  rules      输出命中的 preset/rules
  preset     rules 的别名
  scan       扫描疑似未国际化中文
  apply      自动改写可安全处理的文案
  translate  自动补齐 default.json 中缺失的翻译
  validate   校验 default.json 翻译完整性与正确性
  extract    执行目标项目的词条提取命令
  compile    执行目标项目的语言包编译命令
  scaffold   写入 i18n 基础设施文件（languages 目录、mixin、样式等）
  inject     向 main.js / vue.config.js / App.vue / interceptors 注入 i18n 代码
  audit      审计项目国际化合规性
  run        以 Agent 模式串行执行全流程
  agent      run 的别名

常用参数:
  --project PATH  指定目标项目绝对路径
  --json          输出 JSON，便于 AI 或 CI 解析
  --dry-run       仅预览 apply 改动，不写入文件
  --strict        scan 模式发现疑似问题时返回非 0
  --provider NAME 翻译 provider，可选 glossary / baidu / command
  --appid-env ENV 百度翻译 appid 的环境变量名
  --appkey-env ENV 百度翻译 appkey 的环境变量名
  --write-config  init 模式下写入 i18n-kit.config.json
  --force         配合 --write-config 覆盖已有配置
  --no-apply      run 模式跳过 apply
  --no-extract    run 模式跳过 extract
  --no-translate  run 模式跳过 translate
  --no-compile    run 模式跳过 compile
  --fail-on-scan  run 模式发现疑似未国际化文案时直接失败

示例:
  kd-i18n profile --project /path/to/repo
  kd-i18n doctor --project /path/to/repo
  kd-i18n rules --project /path/to/repo --json
  kd-i18n apply --project /path/to/repo --dry-run
  BAIDU_APPID=xxx BAIDU_APPKEY=xxx kd-i18n translate --project /path/to/repo --provider baidu
  kd-i18n run --project /path/to/repo
`);
}

function logStep(text) {
  console.log(`\n=== ${text} ===`);
}

function buildInitNextSteps(profile) {
  const steps = [
    "先执行 doctor，确认 i18n 基建、RTL、loader 和语言目录是否齐备",
    "先用 apply --dry-run 预览自动改写结果，再决定是否实际写入",
    "如需真实翻译，配置 translate.provider=baidu，并通过环境变量传入百度翻译凭证",
    "执行 run 跑完整链路：scan -> apply -> extract -> translate -> validate -> compile",
  ];

  if (profile.preset && profile.preset.id === "keendata-vue2-voerkai") {
    steps.unshift(
      "当前项目已命中 keendata-vue2-voerkai preset，可直接复用 KeenData 的国际化规则",
    );
  }

  return steps;
}

function isHelpCommand(command) {
  return ["help", "--help", "-h"].includes(command);
}

module.exports = {
  main,
};
