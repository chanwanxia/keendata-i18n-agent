const t = require("@babel/types");

/**
 * 精确匹配关键词列表（使用默认 otherLabel=t("显示名称")）
 * t() 参数中包含"中文名"或"中文名称"时需特殊处理：
 * 其他语言不能叫"中文名"，需改为"显示名称"
 */
const DISPLAY_NAME_EXACT_KEYWORDS = [
  "中文名称：",
  "中文名：",
  "中文名称",
  "中文名",
];

/**
 * 将文本中的"中文名称"/"中文名"替换为"显示名称"，生成 otherLabel 的翻译 key
 * 注意：先替换"中文名称"再替换"中文名"，避免"中文名称"中的"中文名"被先匹配
 * @param {string} text - 原始中文文本
 * @returns {string} 替换后的文本（作为 t() 的参数）
 */
function replaceDisplayNameKeyword(text) {
  return text.replace(/中文名称/g, "显示名称").replace(/中文名/g, "显示名称");
}

/**
 * 判断文本是否为精确匹配关键词
 * @param {string} text - t() 参数文本
 * @returns {boolean} 是否精确匹配
 */
function isExactDisplayNameKeyword(text) {
  return DISPLAY_NAME_EXACT_KEYWORDS.includes(text);
}

/**
 * 构建 displayNameLabel() 调用源码
 * - 精确匹配关键词：使用默认 otherLabel，只需传 chLabel
 * - 子串匹配（如"标签中文名称"）：同时传 chLabel 和 t(otherLabel)
 * @param {string} fullText - t() 的原始参数文本
 * @param {boolean} inScript - 是否在 script 上下文（决定 t 前缀是否有 this.）
 * @returns {string} displayNameLabel() 调用源码
 */
function buildDisplayNameLabelCall(fullText, inScript) {
  const tPrefix = inScript ? "this.t" : "t";
  if (isExactDisplayNameKeyword(fullText)) {
    return `displayNameLabel('${fullText}')`;
  }
  const otherLabel = replaceDisplayNameKeyword(fullText);
  return `displayNameLabel('${fullText}', ${tPrefix}('${otherLabel}'))`;
}

/**
 * 判断指定位置是否在 rules:{...} 块内部
 * rules 对象中的校验提示（如 mBlurRequired(this.t("请输入...")) ）不应被转换为 displayNameLabel，
 * 因为 displayNameConfig 的 chTip/otherTip 已处理校验提示的国际化
 * @param {string} code - 完整源码
 * @param {number} pos - 待检测的位置
 * @returns {boolean} 是否在 rules 块内
 */
function isInsideRulesBlock(code, pos) {
  const before = code.substring(0, pos);
  const rulesIdx = before.lastIndexOf("rules:");
  if (rulesIdx === -1) return false;
  const braceIdx = before.indexOf("{", rulesIdx);
  if (braceIdx === -1 || braceIdx >= pos) return false;
  let depth = 1;
  for (let i = braceIdx + 1; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return i >= pos;
    }
  }
  return false;
}

/**
 * 判断调用表达式的 callee 是否为 displayNameLabel 或 this.displayNameLabel
 * displayNameLabel 的参数是中文常量字符串，不应被 t() 包裹
 * @param {object} callee - Babel callee 节点
 * @returns {boolean} 是否为 displayNameLabel 调用
 */
function isDisplayNameLabelCallee(callee) {
  if (
    t.isIdentifier(callee, { name: "displayNameLabel" }) ||
    t.isIdentifier(callee, { name: "displayNameConfig" })
  )
    return true;
  if (
    t.isMemberExpression(callee) &&
    (t.isIdentifier(callee.property, { name: "displayNameLabel" }) ||
      t.isIdentifier(callee.property, { name: "displayNameConfig" }))
  )
    return true;
  return false;
}

/**
 * 判断源码位置是否位于 Vue SFC 的 script 块中
 * @param {string} code - 完整 Vue 源码
 * @param {number} pos - 待检测的位置
 * @returns {boolean} 是否在 script 块内
 */
function isInsideScriptBlock(code, pos) {
  const before = code.substring(0, pos);
  const scriptStart = before.lastIndexOf("<script");
  if (scriptStart === -1) return false;
  const scriptEnd = before.lastIndexOf("</script>");
  return scriptStart > scriptEnd;
}

/**
 * Step 1: 将 t('...含中文名...') 替换为 displayNameLabel(...)
 * 匹配 t('...') 或 t("...")，参数中含有"中文名"或"中文名称"
 * 同时匹配 this.t(...) 中的 t(...) 部分（this. 前缀自然保留）
 * 跳过 rules:{...} 块中的 t() 调用：校验提示由 displayNameConfig 的 chTip/otherTip 处理
 * @param {string} result - 当前源码
 * @returns {{ code: string, replacements: number }}
 */
function transformTCallDisplayName(result) {
  let code = result;
  let replacements = 0;
  const tCallPattern = /t\(\s*(['"])([^'"]*(?:中文名|中文名称)[^'"]*)\1\s*\)/g;
  let m;
  while ((m = tCallPattern.exec(code)) !== null) {
    const fullMatch = m[0];
    const fullText = m[2];
    const matchStart = m.index;
    const matchEnd = matchStart + fullMatch.length;
    // 幂等性：t( 前面是字母/下划线时，说明是 displayNameLabel( 等标识符的一部分
    if (matchStart > 0 && /[\w$]/.test(code[matchStart - 1])) continue;
    // 幂等性：已经是 displayNameLabel 则跳过
    if (/displayNameLabel/.test(fullMatch)) continue;
    // 跳过 rules:{...} 块中的 t() 调用
    if (isInsideRulesBlock(code, matchStart)) continue;
    // 判断是否在 script 上下文（this.t 前缀）
    const beforeMatch = code.substring(Math.max(0, matchStart - 10), matchStart);
    const inScript = /this\.$/.test(beforeMatch);
    // script 中裸 t() 常见于 props default / beforeRouteEnter 等 this 不可用场景，
    // 不能转换为未导入的裸 displayNameLabel()。
    if (!inScript && isInsideScriptBlock(code, matchStart)) continue;
    const callSource = buildDisplayNameLabelCall(fullText, inScript);
    code = code.substring(0, matchStart) + callSource + code.substring(matchEnd);
    tCallPattern.lastIndex = matchStart + callSource.length;
    replacements += 1;
  }
  return { code, replacements };
}

/**
 * Step 2: 处理静态 label="含中文名的文本"（未被 t() 包裹的情况）
 * @param {string} result - 当前源码
 * @returns {{ code: string, replacements: number }}
 */
function transformStaticLabelDisplayName(result) {
  let replacements = 0;
  const code = result.replace(
    / label="([^"]*(?:中文名|中文名称)[^"]*)"/g,
    (match, labelText) => {
      if (/ :label=/.test(match)) return match;
      const callSource = buildDisplayNameLabelCall(labelText, false);
      replacements += 1;
      return ` :label="${callSource}"`;
    },
  );
  return { code, replacements };
}

/**
 * 在源码中查找指定字段的 rules 数组，并返回可删除范围和应保留的自定义规则
 * @param {string} code - 当前源码
 * @param {string} propName - 表单字段名
 * @returns {object|null} rules 信息
 */
function extractPropRulesInfo(code, propName) {
  let searchIndex = 0;
  let rulesObject = findRulesObject(code, searchIndex);

  while (rulesObject) {
    const body = code.slice(rulesObject.bodyStart, rulesObject.bodyEnd);
    const propPattern = new RegExp(
      `(^|[\\n,{])([ \\t]*)(["']?${escapeRegExp(propName)}["']?)\\s*:`,
      "m",
    );
    const propMatch = propPattern.exec(body);
    if (propMatch) {
      const propStart = rulesObject.bodyStart + propMatch.index;
      let arrayStart =
        rulesObject.bodyStart + propMatch.index + propMatch[0].length;
      while (/\s/.test(code[arrayStart])) arrayStart += 1;
      if (code[arrayStart] !== "[") return null;

      const arrayEnd = findMatchingBracket(code, arrayStart, "[", "]");
      if (arrayEnd === -1) return null;

      let removeEnd = arrayEnd + 1;
      while (/\s/.test(code[removeEnd])) removeEnd += 1;
      if (code[removeEnd] === ",") removeEnd += 1;

      const arrayInner = code.slice(arrayStart + 1, arrayEnd);
      const rules = splitTopLevelItems(arrayInner);
      const customRules = rules.filter((rule) => !isDisplayNameBuiltinRule(rule));

      return {
        required: rules.some((rule) => isRequiredRule(rule)),
        customRules,
        removeStart: propStart,
        removeEnd,
      };
    }

    searchIndex = rulesObject.bodyEnd + 1;
    rulesObject = findRulesObject(code, searchIndex);
  }

  return null;
}

/**
 * 查找第一个 rules: { ... } 对象范围
 * @param {string} code - 当前源码
 * @param {number} startIndex - 起始查找位置
 * @returns {object|null} rules 对象范围
 */
function findRulesObject(code, startIndex = 0) {
  const match = /rules\s*:\s*\{/m.exec(code.slice(startIndex));
  if (!match) return null;
  const matchIndex = startIndex + match.index;
  const braceStart = matchIndex + match[0].lastIndexOf("{");
  const braceEnd = findMatchingBracket(code, braceStart, "{", "}");
  if (braceEnd === -1) return null;
  return {
    bodyStart: braceStart + 1,
    bodyEnd: braceEnd,
  };
}

/**
 * 查找成对括号的结束位置，跳过字符串字面量内部的括号
 * @param {string} code - 当前源码
 * @param {number} start - 起始括号位置
 * @param {string} openChar - 开括号
 * @param {string} closeChar - 闭括号
 * @returns {number} 闭括号位置，未找到时返回 -1
 */
function findMatchingBracket(code, start, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = start; i < code.length; i++) {
    const char = code[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 按顶层逗号拆分数组项，保留对象、函数调用等嵌套结构
 * @param {string} source - 数组内部源码
 * @returns {string[]} 顶层数组项
 */
function splitTopLevelItems(source) {
  const items = [];
  let current = "";
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      if (current.trim()) items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) items.push(current.trim());
  return items;
}

/**
 * 判断规则项是否应交由 displayNameConfig 内置生成
 * @param {string} ruleSource - 单条规则源码
 * @returns {boolean} 是否为内置规则
 */
function isDisplayNameBuiltinRule(ruleSource) {
  return isRequiredRule(ruleSource) || /\bmValidateChinese\s*\(/.test(ruleSource);
}

/**
 * 判断规则项是否为必填校验
 * @param {string} ruleSource - 单条规则源码
 * @returns {boolean} 是否为必填校验
 */
function isRequiredRule(ruleSource) {
  return /\bm(?:Blur|Change)Required\s*\(/.test(ruleSource);
}

/**
 * 转义正则字面量中的特殊字符
 * @param {string} value - 原始文本
 * @returns {string} 可用于 RegExp 的文本
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 构建 displayNameConfig 初始化参数源码
 * @param {object} options - 配置项
 * @returns {string} 参数源码
 */
function buildDisplayNameConfigOptions({
  required,
  chLabel,
  otherLabelKey,
  customRules,
}) {
  const params = [];
  if (required) params.push("required: true");
  if (chLabel !== "中文名称" || otherLabelKey) {
    params.push(`chLabel: "${chLabel}"`);
  }
  if (otherLabelKey) {
    params.push(`otherLabel: this.t("${otherLabelKey}")`);
  }
  if (customRules.length > 0) {
    params.push(`rules: [${customRules.join(", ")}]`);
  }
  return `{ ${params.join(", ")} }`;
}

/**
 * 从自定义 rules 源码中提取未绑定 this 的 validator 方法名
 * @param {string[]} customRules - 自定义规则源码列表
 * @returns {string[]} validator 方法名列表
 */
function collectUnboundValidatorNames(customRules) {
  const names = new Set();
  const validatorPattern =
    /\bvalidator\s*:\s*(?!this\.)([A-Za-z_$][\w$]*)/g;
  customRules.forEach((rule) => {
    let match;
    while ((match = validatorPattern.exec(rule)) !== null) {
      names.add(match[1]);
    }
  });
  return [...names];
}

/**
 * 将 rules 中的裸 validator 引用改为 created/methods 可访问的 this.validator
 * @param {string[]} customRules - 自定义规则源码列表
 * @returns {string[]} 转换后的规则源码列表
 */
function bindValidatorRulesToThis(customRules) {
  return customRules.map((rule) =>
    rule.replace(
      /\bvalidator\s*:\s*(?!this\.)([A-Za-z_$][\w$]*)/g,
      "validator: this.$1",
    ),
  );
}

/**
 * 将 data() 内部的局部 validator 箭头函数提升为 Vue methods 方法
 * @param {string} code - 当前源码
 * @param {string[]} validatorNames - 需要提升的 validator 名称
 * @returns {{ code: string, movedCount: number }}
 */
function promoteLocalValidatorsToMethods(code, validatorNames) {
  let result = code;
  const methodSources = [];

  validatorNames.forEach((validatorName) => {
    if (hasVueMethod(result, validatorName)) return;
    const extracted = extractLocalValidator(result, validatorName);
    if (!extracted) return;
    result =
      result.slice(0, extracted.removeStart) + result.slice(extracted.removeEnd);
    methodSources.push(extracted.methodSource);
  });

  if (methodSources.length === 0) {
    return { code: result, movedCount: 0 };
  }

  return {
    code: insertVueMethods(result, methodSources),
    movedCount: methodSources.length,
  };
}

/**
 * 判断 Vue options 中是否已经存在同名 method
 * @param {string} code - 当前源码
 * @param {string} methodName - 方法名
 * @returns {boolean} 是否已存在
 */
function hasVueMethod(code, methodName) {
  const methodsMatch = /methods\s*:\s*\{[\s\S]*?\n\s*\}/.exec(code);
  if (!methodsMatch) return false;
  return new RegExp(`\\b${escapeRegExp(methodName)}\\s*\\(`).test(
    methodsMatch[0],
  );
}

/**
 * 收集局部 validator 前紧邻的行注释，提升到 methods 时一并移动
 * @param {string} code - 当前源码
 * @param {number} declarationStart - validator 声明起始位置
 * @returns {{ removeStart: number, comments: string[] }} 注释信息
 */
function collectLeadingValidatorComments(code, declarationStart) {
  const comments = [];
  let removeStart = declarationStart;
  let previousLineEnd = code.lastIndexOf("\n", declarationStart - 1);

  while (previousLineEnd > 0) {
    const previousLineStart = code.lastIndexOf("\n", previousLineEnd - 1) + 1;
    const line = code.slice(previousLineStart, previousLineEnd);
    if (!/^\s*\/\//.test(line)) break;
    comments.unshift(line.trim());
    removeStart = previousLineStart;
    previousLineEnd = previousLineStart - 1;
  }

  return { removeStart, comments };
}

/**
 * 提取 data() 里的局部 validator 箭头函数，并改写为 methods 方法源码
 * @param {string} code - 当前源码
 * @param {string} validatorName - validator 名称
 * @returns {object|null} 提取结果
 */
function extractLocalValidator(code, validatorName) {
  const pattern = new RegExp(
    `\\bconst\\s+${escapeRegExp(validatorName)}\\s*=\\s*(async\\s*)?\\(([^)]*)\\)\\s*=>\\s*`,
    "m",
  );
  const match = pattern.exec(code);
  if (!match) return null;

  const bodyStart = match.index + match[0].length;
  const asyncKeyword = match[1] ? "async " : "";
  const params = match[2].trim();
  let body;
  let removeEnd;

  if (code[bodyStart] === "{") {
    const closeBrace = findMatchingBracket(code, bodyStart, "{", "}");
    if (closeBrace === -1) return null;
    body = code.slice(bodyStart + 1, closeBrace).trimEnd();
    removeEnd = closeBrace + 1;
  } else {
    const expressionEnd = code.indexOf(";", bodyStart);
    if (expressionEnd === -1) return null;
    const expression = code.slice(bodyStart, expressionEnd).trim();
    body = `\n      return ${expression};`;
    removeEnd = expressionEnd;
  }

  while (/\s/.test(code[removeEnd]) && code[removeEnd] !== "\n") removeEnd += 1;
  if (code[removeEnd] === ";") removeEnd += 1;
  if (code[removeEnd] === "\n") removeEnd += 1;

  const leading = collectLeadingValidatorComments(code, match.index);
  const commentSource =
    leading.comments.length > 0
      ? leading.comments.map((comment) => `    ${comment}`).join("\n")
      : `    // ${validatorName} 自定义校验`;

  return {
    removeStart: leading.removeStart,
    removeEnd,
    methodSource: `${commentSource}\n    ${asyncKeyword}${validatorName}(${params}) {${body}\n    },`,
  };
}

/**
 * 将方法源码插入 Vue options 的 methods 中，缺失 methods 时自动创建
 * @param {string} code - 当前源码
 * @param {string[]} methodSources - 方法源码列表
 * @returns {string} 插入后的源码
 */
function insertVueMethods(code, methodSources) {
  const methodsSource = methodSources.join("\n");
  if (/methods\s*:\s*\{/.test(code)) {
    return code.replace(/methods\s*:\s*\{/, (match) => `${match}\n${methodsSource}`);
  }

  const methodBlock = `\n  methods: {\n${methodsSource}\n  },`;
  if (/\n\s*created\s*\(\s*\)\s*\{/.test(code)) {
    return code.replace(/(\n\s*created\s*\(\s*\)\s*\{)/, `${methodBlock}$1`);
  }
  if (/\n\s*computed\s*:/.test(code)) {
    return code.replace(/(\n\s*computed\s*:)/, `${methodBlock}$1`);
  }
  if (/\n\s*watch\s*:/.test(code)) {
    return code.replace(/(\n\s*watch\s*:)/, `${methodBlock}$1`);
  }

  const scriptEndIdx = code.lastIndexOf("</script>");
  const searchEnd = scriptEndIdx === -1 ? code.length : scriptEndIdx;
  const beforeScriptEnd = code.slice(0, searchEnd);
  const lastBraceIdx = beforeScriptEnd.lastIndexOf("}");
  if (lastBraceIdx === -1) return code;
  return `${code.slice(0, lastBraceIdx)}${methodBlock}\n${code.slice(lastBraceIdx)}`;
}

/**
 * 查找 this.xxxConfig = this.displayNameConfig({ ... }) 的参数对象范围
 * @param {string} code - 当前源码
 * @param {string} configName - 配置变量名
 * @returns {object|null} 参数对象范围
 */
function findDisplayNameConfigAssignment(code, configName) {
  const pattern = new RegExp(
    `this\\.${escapeRegExp(configName)}\\s*=\\s*this\\.displayNameConfig\\(\\s*\\{`,
  );
  const match = pattern.exec(code);
  if (!match) return null;

  const bodyStart = match.index + match[0].length;
  const openBrace = bodyStart - 1;
  const bodyEnd = findMatchingBracket(code, openBrace, "{", "}");
  if (bodyEnd === -1) return null;

  let assignmentEnd = bodyEnd + 1;
  while (/\s/.test(code[assignmentEnd])) assignmentEnd += 1;
  if (code[assignmentEnd] === ")") assignmentEnd += 1;
  if (code[assignmentEnd] === ";") assignmentEnd += 1;

  return {
    start: match.index,
    bodyStart,
    bodyEnd,
    end: assignmentEnd,
    body: code.slice(bodyStart, bodyEnd),
  };
}

/**
 * 修复旧版本已生成但丢失自定义 validator 的 displayNameConfig 初始化
 * @param {string} code - 当前源码
 * @param {string} configName - 配置变量名
 * @param {string} propName - 表单字段名
 * @returns {object} 修复结果
 */
function repairExistingDisplayNameConfigRules(code, configName, propName) {
  const validatorName = `validate${propName.charAt(0).toUpperCase()}${propName.slice(1)}`;
  if (!new RegExp(`\\b${escapeRegExp(validatorName)}\\b`).test(code)) {
    return { changed: false, code };
  }

  let result = code;
  const promoteResult = promoteLocalValidatorsToMethods(result, [validatorName]);
  result = promoteResult.code;

  const assignment = findDisplayNameConfigAssignment(result, configName);
  if (!assignment) {
    return {
      changed: promoteResult.movedCount > 0,
      code: result,
    };
  }

  if (/\brules\s*:/.test(assignment.body)) {
    const boundBody = assignment.body.replace(
      new RegExp(`\\bvalidator\\s*:\\s*${escapeRegExp(validatorName)}\\b`, "g"),
      `validator: this.${validatorName}`,
    );
    if (boundBody === assignment.body) {
      return {
        changed: promoteResult.movedCount > 0,
        code: result,
      };
    }
    return {
      changed: true,
      code:
        result.slice(0, assignment.bodyStart) +
        boundBody +
        result.slice(assignment.bodyEnd),
    };
  }

  const body = assignment.body.trim();
  const separator = body ? `${assignment.body.trimEnd()}, ` : " ";
  const replacement = `${separator}rules: [{ validator: this.${validatorName}, trigger: "blur" }] `;
  return {
    changed: true,
    code:
      result.slice(0, assignment.bodyStart) +
      replacement +
      result.slice(assignment.bodyEnd),
  };
}

/**
 * Step 3 & 4: 处理 el-form-item 的 displayNameLabel → displayNameConfig 模式
 * 将 :label="displayNameLabel(...)" 转换为 :label="propConfig.label" :rules="propConfig.rules"
 * 并在 script 中注入 displayNameConfig 初始化到 data() 和 created()
 * @param {string} result - 当前源码
 * @param {object} sfc - @vue/compiler-sfc 解析结果
 * @returns {{ code: string, replacements: number }}
 */
function transformFormItemDisplayNameConfig(result, sfc) {
  let replacements = 0;
  let code = result;
  const formItemConfigs = [];

  if (!sfc || !sfc.template) {
    return { code, replacements };
  }

  const formItemPattern = /<el-form-item\s+([^>]*?)>/g;
  let match;
  while ((match = formItemPattern.exec(code)) !== null) {
    const fullMatch = match[0];
    const attrs = match[1];

    const labelMatch = attrs.match(/:label="displayNameLabel\(([^"]*)\)"/);
    if (!labelMatch) continue;

    // 幂等性：已使用 Config.label 则跳过
    if (/Config\.label/.test(attrs)) continue;

    const propMatch = attrs.match(/\sprop="([^"]+)"/);
    if (!propMatch) continue;
    const propName = propMatch[1];
    const configName = `${propName}Config`;

    // 从 displayNameLabel 调用中提取参数
    const argsStr = labelMatch[1].trim();
    const argParts = argsStr.match(/['"]([^'"]*)['"]/g);
    const chLabel =
      argParts && argParts[0]
        ? argParts[0].replace(/^['"]|['"]$/g, "")
        : "中文名称";
    const otherLabelKey =
      argParts && argParts[1]
        ? argParts[1].replace(/^['"]|['"]$/g, "")
        : null;

    // 替换 :label="displayNameLabel(...)" → :label="configName.label"
    let newAttrs = attrs.replace(
      /:label="displayNameLabel\([^"]*\)"/,
      `:label="${configName}.label"`,
    );

    // 替换或添加 :rules="configName.rules"
    if (/\s:rules=/.test(newAttrs)) {
      newAttrs = newAttrs.replace(
        /\s:rules="[^"]*"/,
        ` :rules="${configName}.rules"`,
      );
    } else {
      newAttrs += ` :rules="${configName}.rules"`;
    }

    const newTag = `<el-form-item ${newAttrs}>`;
    code = code.replace(fullMatch, newTag);
    replacements += 1;

    formItemConfigs.push({ propName, configName, chLabel, otherLabelKey });
  }

  formItemPattern.lastIndex = 0;
  while ((match = formItemPattern.exec(code)) !== null) {
    const attrs = match[1];
    const labelMatch = attrs.match(/:label="(\w+Config)\.label"/);
    if (!labelMatch) continue;

    const propMatch = attrs.match(/\sprop="([^"]+)"/);
    if (!propMatch) continue;

    const configName = labelMatch[1];
    if (formItemConfigs.some((item) => item.configName === configName)) {
      continue;
    }
    formItemConfigs.push({
      propName: propMatch[1],
      configName,
      chLabel: "中文名称",
      otherLabelKey: null,
    });
  }

  // Step 4: 为 el-form-item 注入 displayNameConfig 初始化到 script
  if (formItemConfigs.length > 0) {
    formItemConfigs.forEach(({ configName, chLabel, otherLabelKey, propName }) => {
      // 幂等性：config 已存在时只尝试修复历史版本丢失的自定义 validator
      if (new RegExp(`this\\.${configName}\\b`).test(code)) {
        const repairResult = repairExistingDisplayNameConfigRules(
          code,
          configName,
          propName,
        );
        if (repairResult.changed) {
          code = repairResult.code;
          replacements += 1;
        }
        return;
      }

      const rulesInfo = extractPropRulesInfo(code, propName);
      let customRules = rulesInfo ? rulesInfo.customRules : [];
      const validatorNames = collectUnboundValidatorNames(customRules);

      // 当 prop 已在 rules 对象中定义，且 el-form-item 已改用 configName.rules 时，
      // 从 rules 对象中移除该 prop 的旧规则定义，并将自定义规则合并到 displayNameConfig
      if (rulesInfo) {
        code =
          code.slice(0, rulesInfo.removeStart) + code.slice(rulesInfo.removeEnd);
      }
      if (validatorNames.length > 0) {
        const promoteResult = promoteLocalValidatorsToMethods(code, validatorNames);
        code = promoteResult.code;
        replacements += promoteResult.movedCount;
        customRules = bindValidatorRulesToThis(customRules);
      }

      // 构建 config 初始化语句
      const configOptions = buildDisplayNameConfigOptions({
        required: !!(rulesInfo && rulesInfo.required),
        chLabel,
        otherLabelKey,
        customRules,
      });
      const cleanStmt = `this.${configName} = this.displayNameConfig(${configOptions});`;

      // 在 data() return 中添加 configName: {}
      const dataReturnPattern = /data\s*\(\s*\)\s*\{[\s\S]*?return\s*\{/;
      if (dataReturnPattern.test(code)) {
        code = code.replace(dataReturnPattern, (m) => `${m}\n      ${configName}: {},`);
      }

      // 在 created() 中添加 config 初始化
      const createdPattern = /created\s*\(\s*\)\s*\{/;
      if (createdPattern.test(code)) {
        code = code.replace(createdPattern, (m) => `${m}\n    ${cleanStmt}`);
      } else if (/\n\s*methods\s*:/.test(code)) {
        code = code.replace(
          /(\n\s*methods\s*:)/,
          `\n  created() {\n    ${cleanStmt}\n  },$1`,
        );
      } else if (/\n\s*computed\s*:/.test(code)) {
        code = code.replace(
          /(\n\s*computed\s*:)/,
          `\n  created() {\n    ${cleanStmt}\n  },$1`,
        );
      } else if (/\n\s*watch\s*:/.test(code)) {
        code = code.replace(
          /(\n\s*watch\s*:)/,
          `\n  created() {\n    ${cleanStmt}\n  },$1`,
        );
      } else {
        // 在 export default 的闭合 } 前添加 created()
        const scriptEndIdx = code.lastIndexOf("</script>");
        if (scriptEndIdx !== -1) {
          const beforeScript = code.substring(0, scriptEndIdx);
          const lastBraceIdx = beforeScript.lastIndexOf("}");
          if (lastBraceIdx !== -1) {
            code =
              code.substring(0, lastBraceIdx) +
              `  created() {\n    ${cleanStmt}\n  },\n  ` +
              code.substring(lastBraceIdx);
          }
        }
      }
    });
  }

  return { code, replacements };
}

/**
 * 变换 Vue 文件中的"中文名"接入模式
 * 在 t() 包裹之后执行，检测 t('...中文名...')/t('...中文名称...')（含子串匹配）及静态中文文本，
 * 转换为 displayNameLabel/displayNameConfig 调用
 *
 * 处理场景：
 * 1. t('含中文名的文本') → displayNameLabel(...)（精确匹配用默认 otherLabel，子串匹配生成 otherLabel）
 * 2. 静态 label="含中文名的文本" → :label="displayNameLabel(...)"
 * 3. el-form-item 的 displayNameLabel → displayNameConfig 模式（注入 data/created 配置）
 *
 * @param {string} code - Vue 文件完整源码（已经过 t() 包裹）
 * @param {object} sfc - @vue/compiler-sfc 解析结果
 * @returns {object} 变换结果 { changed, replacements, code }
 */
function transformDisplayName(code, sfc) {
  let result = code;
  let replacements = 0;

  const step1 = transformTCallDisplayName(result);
  result = step1.code;
  replacements += step1.replacements;

  const step2 = transformStaticLabelDisplayName(result);
  result = step2.code;
  replacements += step2.replacements;

  const step3 = transformFormItemDisplayNameConfig(result, sfc);
  result = step3.code;
  replacements += step3.replacements;

  return {
    changed: replacements > 0,
    replacements,
    code: result,
  };
}

module.exports = {
  transformDisplayName,
  isDisplayNameLabelCallee,
  DISPLAY_NAME_EXACT_KEYWORDS,
};
