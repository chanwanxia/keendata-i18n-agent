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

  // Step 4: 为 el-form-item 注入 displayNameConfig 初始化到 script
  if (formItemConfigs.length > 0) {
    formItemConfigs.forEach(({ configName, chLabel, otherLabelKey, propName }) => {
      // 幂等性：config 已存在则跳过
      if (new RegExp(`this\\.${configName}\\b`).test(code)) return;

      // 检测 prop 是否在 rules 对象中有规则定义（用于判断 required）
      const hasRulesForProp = new RegExp(
        `rules\\s*:\\s*\\{[\\s\\S]*?\\b${propName}\\s*:`,
      ).test(code);
      const requiredParam = hasRulesForProp ? "required: true, " : "";

      // 当 prop 已在 rules 对象中定义，且 el-form-item 已改用 configName.rules 时，
      // 从 rules 对象中移除该 prop 的旧规则定义（避免重复校验）
      if (hasRulesForProp) {
        const propRulesPattern = new RegExp(
          `(\\n\\s*)${propName}\\s*:\\s*\\[[^\\]]*\\],?`,
        );
        code = code.replace(propRulesPattern, "");
      }

      // 构建 config 初始化语句
      let configStmt;
      if (chLabel === "中文名称" && !otherLabelKey) {
        configStmt = `this.${configName} = this.displayNameConfig({ ${requiredParam}});`;
      } else if (otherLabelKey) {
        configStmt = `this.${configName} = this.displayNameConfig({ ${requiredParam}chLabel: "${chLabel}", otherLabel: this.t("${otherLabelKey}") });`;
      } else {
        configStmt = `this.${configName} = this.displayNameConfig({ ${requiredParam}chLabel: "${chLabel}" });`;
      }
      const cleanStmt = configStmt.replace(/\{\s*,/, "{ ");

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
