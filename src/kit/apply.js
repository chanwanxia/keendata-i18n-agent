const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const { parseComponent } = require("@vue/compiler-sfc");
const { collectTargetFiles, toRelative } = require("./files");
const { getPresetById } = require("./presets");
const { runEslintFix } = require("./eslint");
const { transformDisplayName, isDisplayNameLabelCallee } = require("./display-name");

const DEFAULT_TEMPLATE_ATTRIBUTES = [
  "placeholder",
  "title",
  "label",
  "content-text",
  "reference-text",
  "confirm-text",
  "confirmText",
  "cancel-text",
  "cancelText",
  "empty-text",
  "emptyText",
];

const JS_PARSE_PLUGINS = [
  "jsx",
  "classProperties",
  "decorators-legacy",
  "objectRestSpread",
  "optionalChaining",
  "nullishCoalescingOperator",
  "dynamicImport",
  "topLevelAwait",
  "typescript",
];

/**
 * 对目标项目执行 i18n 自动改写，将中文文案包裹为 t() 调用
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} config - i18n 配置
 * @param {object} options - 选项 { dryRun: boolean }
 * @returns {object} 改写报告
 */
function applyI18n(projectRoot, config, options = {}) {
  const preset = config.preset ? getPresetById(config.preset) : null;

  // 正式执行前先清理之前 run 可能遗留的问题（嵌套 t()、重复 import、
  // beforeRouteEnter/props 中的 this.t 误用等），保证幂等性
  if (!options.dryRun) {
    cleanupI18n(projectRoot, config);
  }

  const files = collectTargetFiles(projectRoot, config);
  const changedFiles = [];

  files.forEach((filePath) => {
    const relativePath = toRelative(projectRoot, filePath);
    if (shouldSkipFile(relativePath, config)) return;

    const original = fs.readFileSync(filePath, "utf8");
    const transformed = transformFile(
      original,
      filePath,
      relativePath,
      preset,
      config,
    );
    if (!transformed.changed) return;

    if (!options.dryRun) {
      fs.writeFileSync(filePath, transformed.code, "utf8");
    }

    changedFiles.push({
      file: relativePath,
      replacements: transformed.replacements,
      mode: options.dryRun ? "preview" : "write",
      preview: buildChangePreview(original, transformed.code),
    });
  });

  // 写入后自动执行 eslint --fix，修复 AST 生成引入的格式问题（多余空格等）
  if (!options.dryRun && changedFiles.length > 0) {
    const eslintResult = runEslintFix(
      projectRoot,
      changedFiles.map((f) => f.file),
    );
    if (eslintResult.fixedCount > 0) {
      console.log(
        `[i18n-apply] eslint --fix: 修复 ${eslintResult.fixedCount} 个文件`,
      );
    }
  }

  return {
    ok: true,
    summary: {
      changedFileCount: changedFiles.length,
      replacementCount: changedFiles.reduce(
        (sum, item) => sum + item.replacements,
        0,
      ),
      dryRun: !!options.dryRun,
    },
    changedFiles,
  };
}

/**
 * 根据文件扩展名分发到 Vue 或 JS 变换器
 * @param {string} source - 源码
 * @param {string} filePath - 文件路径
 * @param {string} relativePath - 相对路径
 * @param {object} preset - 预设规则
 * @param {object} config - i18n 配置
 * @returns {object} 变换结果 { changed, replacements, code }
 */
function transformFile(source, filePath, relativePath, preset, config) {
  const extension = path.extname(filePath);
  if (extension === ".vue") {
    return transformVueFile(source, preset, config);
  }
  if (extension === ".js") {
    const result = transformJsFile(source, {
      vueComponent: false,
      relativePath,
      preset,
      config,
    });
    // 国际化时区 JS 代码变换（Date.now/new Date/parseTime/dayjs）
    const tzResult = transformTimezoneJs(result.code);
    if (tzResult.changed) {
      return {
        changed: true,
        replacements: result.replacements + tzResult.replacements,
        code: tzResult.code,
      };
    }
    return result;
  }
  return { changed: false, replacements: 0, code: source };
}

/**
 * 变换 Vue 文件：分别处理 template 和 script 区域
 * @param {string} source - 源码
 * @param {object} preset - 预设规则
 * @param {object} config - i18n 配置
 * @returns {object} 变换结果
 */
function transformVueFile(source, preset, config) {
  let changed = false;
  let replacements = 0;
  let code = source;

  // 使用 @vue/compiler-sfc 的 parseComponent 正确切分 SFC 块，
  // 避免正则匹配 <template> 时误匹配内层嵌套的 <template> 标签
  let sfc;
  try {
    sfc = parseComponent(source);
  } catch (_e) {
    return transformVueFileFallback(source, preset, config);
  }

  if (sfc.template && sfc.template.content) {
    // 注意：sfc.template.content 是编译器规范化后的内容，可能与源码不完全一致。
    // 使用 start/end 位置从原始源码中提取真实内容，确保 code.replace 能正确匹配。
    const templateContent =
      sfc.template.start != null && sfc.template.end != null
        ? source.slice(sfc.template.start, sfc.template.end)
        : sfc.template.content;
    const transformed = transformTemplate(templateContent, preset, config);
    if (transformed.changed) {
      changed = true;
      replacements += transformed.replacements;
      code = code.replace(templateContent, transformed.code);
    }
  }

  if (sfc.script && sfc.script.content) {
    // 同样使用 start/end 位置提取真实 script 内容
    const scriptContent =
      sfc.script.start != null && sfc.script.end != null
        ? source.slice(sfc.script.start, sfc.script.end)
        : sfc.script.content;
    const transformed = transformJsFile(scriptContent, {
      vueComponent: true,
      preset,
      config,
    });
    if (transformed.changed) {
      changed = true;
      replacements += transformed.replacements;
      code = code.replace(scriptContent, transformed.code);
    }
  }

  // "中文名称"接入变换：检测 t('中文名称')/t('显示名称')/t('中文名') 并转换为 displayNameLabel/displayNameConfig
  const displayNameResult = transformDisplayName(code, sfc);
  if (displayNameResult.changed) {
    changed = true;
    replacements += displayNameResult.replacements;
    code = displayNameResult.code;
  }

  // JS 级别方向性赋值转换（如 style.cssFloat = "left" -> this.isRtl ? "right" : "left"）
  if (sfc.script && sfc.script.content) {
    const scriptContent =
      sfc.script.start != null && sfc.script.end != null
        ? code.slice(sfc.script.start, sfc.script.end)
        : null;
    if (scriptContent) {
      const rtlResult = transformRtlJsAssignments(scriptContent);
      if (rtlResult.changed) {
        changed = true;
        replacements += rtlResult.replacements;
        code = code.replace(scriptContent, rtlResult.code);
      }
      // 国际化时区 JS 代码变换（Date.now/new Date/parseTime/dayjs）
      const currentScript = rtlResult.changed ? rtlResult.code : scriptContent;
      const tzResult = transformTimezoneJs(currentScript);
      if (tzResult.changed) {
        changed = true;
        replacements += tzResult.replacements;
        code = code.replace(currentScript, tzResult.code);
      }
    }
  }

  // 清理旧版 inject/mixins/import（i18nMixin 已全局引入，无需单文件声明）
  const injectResult = cleanupLegacyInjects(code);
  if (injectResult.changed) {
    changed = true;
    code = injectResult.code;
  }

  // 还原 LLM write_file 可能引入的 \uXXXX 转义序列为实际中文字符
  const beforeDeescape = code;
  code = deescapeUnicode(code);
  if (code !== beforeDeescape) {
    changed = true;
  }

  return { changed, replacements, code };
}

/**
 * 正则回退方案：当 @vue/compiler-sfc 解析失败时使用
 * @param {string} source - 源码
 * @param {object} preset - 预设规则
 * @param {object} config - i18n 配置
 * @returns {object} 变换结果
 */
function transformVueFileFallback(source, preset, config) {
  let changed = false;
  let replacements = 0;
  let code = source;

  code = code.replace(
    /<template>([\s\S]*?)<\/template>/,
    (block, templateContent) => {
      const transformed = transformTemplate(templateContent, preset, config);
      if (!transformed.changed) return block;
      changed = true;
      replacements += transformed.replacements;
      return `<template>${transformed.code}</template>`;
    },
  );

  code = code.replace(
    /<script[^>]*>([\s\S]*?)<\/script>/,
    (block, scriptContent) => {
      const transformed = transformJsFile(scriptContent, {
        vueComponent: true,
        preset,
        config,
      });
      if (!transformed.changed) return block;
      changed = true;
      replacements += transformed.replacements;
     return block.replace(scriptContent, transformed.code);
   },
 );

  // JS 级别方向性赋值转换
  const rtlResult = transformRtlJsAssignments(code);
  if (rtlResult.changed) {
    changed = true;
    replacements += rtlResult.replacements;
    code = rtlResult.code;
  }

  // 国际化时区 JS 代码变换（Date.now/new Date/parseTime/dayjs）
  const tzResult = transformTimezoneJs(code);
  if (tzResult.changed) {
    changed = true;
    replacements += tzResult.replacements;
    code = tzResult.code;
  }

  // 清理旧版 inject/mixins/import（i18nMixin 已全局引入，无需单文件声明）
  const injectResult = cleanupLegacyInjects(code);
  if (injectResult.changed) {
    changed = true;
    code = injectResult.code;
  }

  return { changed, replacements, code };
}

/**
 * 变换 Vue template 区域：将属性和文本节点中的中文包裹为 t()
 * @param {string} source - template 内容
 * @param {object} preset - 预设规则
 * @param {object} config - i18n 配置
 * @returns {object} 变换结果
 */
function transformTemplate(source, preset, config) {
  let code = source;
  let replacements = 0;

  // 临时遮蔽 HTML 注释，避免注释中的中文被误处理，变换完成后原样恢复
  // 使用 null 字节占位符确保不会被任何正则匹配误伤
  const commentPlaceholders = [];
  code = code.replace(/<!--[\s\S]*?-->/g, (match) => {
    const placeholder = `\x00CMT${commentPlaceholders.length}\x00`;
    commentPlaceholders.push(match);
    return placeholder;
  });

  const specialComponents = (preset && preset.rules.specialComponents) || [];
  const configuredAttributes =
    (config.apply && config.apply.templateAttributes) || [];
  const translateAttrs = new Set([
    ...DEFAULT_TEMPLATE_ATTRIBUTES,
    ...configuredAttributes,
    ...specialComponents.flatMap((item) => item.props || []),
  ]);

  code = code.replace(
    /(\s)([a-zA-Z-]+)="([^"]*[\u3400-\u9fff][^"]*)"/g,
    (match, prefix, attrName, attrValue) => {
      if (!translateAttrs.has(attrName)) return match;
      if (attrName === "p-l") return match;
      // 幂等性检查：已包含 t() 调用的属性值不再重复包裹
      if (/\bt\s*\(/.test(attrValue)) return match;
      replacements += 1;
      return `${prefix}:${attrName}="${buildTranslateCallSource("t", attrValue, [], true)}"`;
    },
  );

  code = code.replace(
    /(\s)p-l="([^",`]+),([^"]*[\u3400-\u9fff][^"]*)"/g,
    (match, prefix, fieldName, labelText) => {
      replacements += 1;
      return `${prefix}:p-l="\`${fieldName},\${${buildTranslateCallSource("t", labelText, [], true)}}\`"`;
    },
  );

  code = code.replace(
    /(\s(?:(?::|v-bind:)[\w-]+))="([^"]*)"/g,
    (match, attrPrefix, expressionSource) => {
      const attrName = attrPrefix.replace(/^\s(?::|v-bind:)/, "");
      // p-l 属性始终特殊处理，不受 translateAttrs 控制
      if (attrName === "p-l") {
        const p_lResult = transformPLAttribute(expressionSource);
        if (p_lResult) {
          replacements += p_lResult.replacements;
          return `${attrPrefix}="${p_lResult.code}"`;
        }
        return match;
      }

      if (!translateAttrs.has(attrName)) return match;

      const transformed = transformInlineExpression(
        expressionSource,
        "t",
        true,
      );
      if (!transformed.changed) return match;
      replacements += transformed.replacements;
      return `${attrPrefix}="${transformed.code}"`;
    },
  );

  code = code.replace(/\{\{([\s\S]*?)\}\}/g, (match, expressionSource) => {
    const transformed = transformInlineExpression(expressionSource, "t", true);
    if (!transformed.changed) return match;
    replacements += transformed.replacements;
    return `{{ ${transformed.code} }}`;
  });

  code = code.replace(
    /(?<!=)>([^<]*\{\{[\s\S]*?\}\}[^<]*)</g,
    (match, rawText) => {
      const transformed = convertInterpolatedTemplateText(rawText);
      if (!transformed.changed) return match;
      replacements += transformed.replacements;
      return `>${transformed.code}<`;
    },
  );

  code = code.replace(
    /(?<!=)>([^<]*[\u3400-\u9fff][^<{}]*)</g,
    (match, rawText) => {
      if (!rawText.trim()) return match;
      if (rawText.includes("{{") || rawText.includes("}}")) return match;
      // 跳过跨越属性边界的匹配：rawText 中包含 " 说明匹配了属性值中的 > 比较运算符
      if (rawText.includes('"')) return match;
      // 幂等性检查：已包含 t() 调用的文本不再重复包裹
      if (/\bt\s*\(/.test(rawText)) return match;
      replacements += 1;
      const trimmed = rawText.trim();
      const leading = rawText.match(/^\s*/)[0];
      const trailing = rawText.match(/\s*$/)[0];
      return `>${leading}{{ ${buildTranslateCallSource("t", trimmed)} }}${trailing}<`;
    },
  );
  // .meta.title 表达式自动 t() 包裹
  // 匹配 mustache 中的 <identifier>.meta.title 或 <identifier>.title（当 identifier 含 meta/Path 关键字时）
  // 已在 t() 内的跳过
  const metaTitleResult = wrapMetaTitleExpressions(code);
  if (metaTitleResult.changed) {
    replacements += metaTitleResult.replacements;
    code = metaTitleResult.code;
  }

  // isRtl 内联样式自动转换
  // 检测 :style 中的方向性属性（padding-left/right, margin-left/right 等），转换为 isRtl 条件表达式
  const rtlStyleResult = transformRtlInlineStyles(code);
  if (rtlStyleResult.changed) {
    replacements += rtlStyleResult.replacements;
    code = rtlStyleResult.code;
  }
  // isRtl 静态样式自动转换
  // 检测静态 style 中的方向性属性（padding-left/right, margin-left/right 等），转换为 :style isRtl 条件表达式
  const rtlStaticResult = transformRtlStaticStyles(code);
  if (rtlStaticResult.changed) {
    replacements += rtlStaticResult.replacements;
    code = rtlStaticResult.code;
  }

  // el-form label-width 自动适配：将固定 px 值改为 auto，让 Element UI 根据内容自动计算宽度
  // 保留 label-width="0" 和 label-width="0px"（特殊布局用途）
  const labelWidthResult = transformLabelWidthToAuto(code);
  if (labelWidthResult.changed) {
    replacements += labelWidthResult.replacements;
    code = labelWidthResult.code;
  }

  // el-date-picker type="datetime" → kd-date-picker（国际化时区组件替换）
  const datePickerResult = transformDatePickerComponent(code);
  if (datePickerResult.changed) {
    replacements += datePickerResult.replacements;
    code = datePickerResult.code;
  }

  const cleanedCode = unwrapNestedTranslateCalls(code);

  // 恢复被遮蔽的 HTML 注释（原样还原，不做任何修改）
  let finalCode = cleanedCode;
  commentPlaceholders.forEach((comment, i) => {
    finalCode = finalCode.replace(`\x00CMT${i}\x00`, comment);
  });

  return {
    changed: replacements > 0 || finalCode !== source,
    replacements,
    code: finalCode,
  };
}

/**
 * 将 template 中的 .meta.title 表达式自动包裹为 t() 调用
 * 匹配模式：{{ item.meta.title }} -> {{ t(item.meta.title) }}
 * 匹配模式：{{ currentPathMeta.title }} -> {{ t(currentPathMeta.title) }}（identifier 含 meta/Path 关键字时）
 * 幂等性：已在 t() 内的跳过
 * @param {string} code - template 源码
 * @returns {object} 变换结果 { changed, replacements, code }
 */
function wrapMetaTitleExpressions(code) {
  let replacements = 0;
  let result = code;

  // 匹配 mustache 中的 <identifier>.meta.title（可选链 ?. 也支持）
  // 排除已被 t() 包裹的情况
  result = result.replace(
    /\{\{\s*(?!.*\bt\s*\()(?:this\.)?(\w+(?:\.\w+)*\.meta\.title)\s*\}\}/g,
    (match, expr) => {
      replacements += 1;
      return `{{ t(${expr}) }}`;
    },
  );

  // 匹配 mustache 中的 <identifier>.title（当 identifier 含 meta 或 Path 关键字时）
  // 如 currentPathMeta.title, routeMeta.title 等
  result = result.replace(
    /\{\{\s*(?!.*\bt\s*\()(?:this\.)?(\w*(?:[Mm]eta|[Pp]ath)\w*\.title)\s*\}\}/g,
    (match, expr) => {
      replacements += 1;
      return `{{ t(${expr}) }}`;
    },
  );

  // 匹配 v-bind 属性中的 .meta.title（如 :title="item.meta.title"）
  result = result.replace(
    /(?::|v-bind:)([\w-]+)="([^"]*?\b\w+(?:\.\w+)*\.meta\.title\b[^"]*?)"/g,
    (match, attrName, expr) => {
      // 跳过已被 t() 包裹的
      if (/\bt\s*\(/.test(expr)) return match;
      replacements += 1;
      return `:${attrName}="t(${expr.trim()})"`;
    },
  );

  return {
    changed: replacements > 0,
    replacements,
    code: result,
  };
}

/**
 * 方向性 CSS 属性与其对应方向的映射表
 * postcss-rtlcss 无法处理内联 :style 样式，需手动用 isRtl 区分左右
 */
const RTL_STYLE_MAP = {
  "padding-left": "padding-right",
  "padding-right": "padding-left",
  "margin-left": "margin-right",
  "margin-right": "margin-left",
  left: "right",
  right: "left",
  "border-left": "border-right",
  "border-right": "border-left",
};

/**
 * 检测 :style 绑定中的方向性 CSS 属性，自动转换为 isRtl 条件表达式
 * 仅处理对象语法 :style="{ 'padding-right': '32px' }"
 * 转换为 :style="isRtl ? { 'padding-left': '32px' } : { 'padding-right': '32px' }"
 * @param {string} code - template 源码
 * @returns {object} 变换结果 { changed, replacements, code }
 */
function transformRtlInlineStyles(code) {
  let replacements = 0;
  let result = code;

  // 匹配 :style="{ ... }" 或 v-bind:style="{ ... }" 对象语法
  // 要求前缀必须是 : 或 v-bind:（不匹配纯 style="..."，那由 transformRtlStaticStyles 处理）
  // 使用大括号匹配算法提取完整对象内容，支持值中包含嵌套大括号
  const styleAttrPattern = /(?:v-bind:|:)style="(?=\{)/g;
  let match;
  while ((match = styleAttrPattern.exec(result)) !== null) {
    const attrStart = match.index;
    const braceStart = match.index + match[0].length;
    const extracted = extractBracedObject(result, braceStart);
    if (!extracted) continue;

    const styleObj = extracted.object;
    const braceEnd = extracted.endIndex;

    // 完整匹配为 :style="{...}"，闭合引号必须在 braceEnd+1
    if (result.charAt(braceEnd + 1) !== '"') continue;

    // 检测是否已包含 isRtl（幂等性）
    if (styleObj.includes("isRtl")) continue;

    // 解析对象中的属性
    const props = parseStyleObject(styleObj);
    if (!props) continue;

    // 检测是否有方向性属性
    const directionalProps = props.filter((p) =>
      Object.prototype.hasOwnProperty.call(RTL_STYLE_MAP, p.key),
    );
    if (directionalProps.length === 0) continue;

    // 构建两个分支：RTL 和 LTR
    const rtlProps = props.map((p) => {
      const mappedKey = RTL_STYLE_MAP[p.key];
      return mappedKey ? { key: mappedKey, value: p.value } : p;
    });
    const ltrProps = props;

    const rtlObj = `{ ${rtlProps.map((p) => `'${p.key}': ${p.value}`).join(", ")} }`;
    const ltrObj = `{ ${ltrProps.map((p) => `'${p.key}': ${p.value}`).join(", ")} }`;

    // 确定 :style 或 v-bind:style 前缀
    const attrPrefix = match[0].includes("v-bind:") ? "v-bind:style" : ":style";
    const fullEnd = braceEnd + 2; // 包含闭合 } 和 "
    const replacement = `${attrPrefix}="isRtl ? ${rtlObj} : ${ltrObj}"`;

    result = result.substring(0, attrStart) + replacement + result.substring(fullEnd);
    replacements += 1;
    // 调整 lastIndex 以继续搜索替换后的内容
    styleAttrPattern.lastIndex = attrStart + replacement.length;
  }

  return {
    changed: replacements > 0,
    replacements,
    code: result,
  };
}

/**
 * 使用大括号匹配算法从指定位置提取完整的 { ... } 对象
 * 支持嵌套大括号（如函数调用中的对象参数）
 * @param {string} code - 源码
 * @param {number} braceStart - 起始大括号 { 的索引
 * @returns {object|null} { object, endIndex } 或 null（匹配失败）
 */
function extractBracedObject(code, braceStart) {
  if (code[braceStart] !== "{") return null;
  let depth = 0;
  for (let i = braceStart; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { object: code.substring(braceStart, i + 1), endIndex: i };
      }
    }
  }
  return null;
}

/**
 * 将静态 style 属性中的方向性 CSS 转换为 :style isRtl 条件表达式
 * 如 style="padding-right: 32px;" 转换为 :style="isRtl ? { 'padding-left': '32px' } : { 'padding-right': '32px' }"
 * 仅转换含方向性属性的 style，非方向性 style 保持不变
 * @param {string} code - template 源码
 * @returns {object} 变换结果 { changed, replacements, code }
 */
function transformRtlStaticStyles(code) {
  let replacements = 0;
  let result = code;

  // 匹配静态 style="..." 属性（非 :style / v-bind:style）
  // 前瞻确保不是 :style 或 v-bind:style
  result = result.replace(
    /\sstyle="([^"]*)"/g,
    (match, styleValue) => {
      // 幂等性：已包含 isRtl 则跳过
      if (styleValue.includes("isRtl")) return match;

      // 解析 CSS 声明：key: value; key: value;
      const declarations = parseCssDeclarations(styleValue);
      if (!declarations || declarations.length === 0) return match;

      // 检测是否有方向性属性
      const hasDirectional = declarations.some((d) =>
        Object.prototype.hasOwnProperty.call(RTL_STYLE_MAP, d.key),
      );
      if (!hasDirectional) return match;

      // 构建两个分支：RTL 和 LTR
      const rtlProps = declarations.map((d) => {
        const mappedKey = RTL_STYLE_MAP[d.key];
        return mappedKey ? { key: mappedKey, value: d.value } : d;
      });
      const ltrProps = declarations;

      const rtlObj = `{ ${rtlProps.map((p) => `'${p.key}': ${p.value}`).join(", ")} }`;
      const ltrObj = `{ ${ltrProps.map((p) => `'${p.key}': ${p.value}`).join(", ")} }`;

      replacements += 1;
      return ` :style="isRtl ? ${rtlObj} : ${ltrObj}"`;
    },
  );

  return {
    changed: replacements > 0,
    replacements,
    code: result,
  };
}

/**
 * 解析 CSS 声明字符串，提取属性键值对
 * 支持格式：padding-right: 32px; margin-left: 10px; color: red
 * @param {string} cssText - CSS 声明字符串
 * @returns {array|null} 属性数组 [{ key, value }] 或 null（解析失败）
 */
function parseCssDeclarations(cssText) {
  const declarations = [];
  const parts = cssText.split(";").map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) continue;
    const key = part.substring(0, colonIdx).trim();
    let value = part.substring(colonIdx + 1).trim();
    // 将 CSS 值转换为 JS 字符串字面量（加引号）
    // 如 32px -> '32px', red -> 'red'
    if (!value.startsWith("'") && !value.startsWith('"')) {
      value = `'${value}'`;
    }
    declarations.push({ key, value });
  }

  return declarations.length > 0 ? declarations : null;
}

/**
 * 解析 :style 对象字符串，提取属性键值对
 * 支持格式：{ 'padding-right': '32px', color: 'red', width: getStyle({ active: true }) }
 * 使用大括号/括号感知的逗号分割，避免值中的嵌套大括号导致截断
 * @param {string} styleObj - 样式对象字符串（含大括号）
 * @returns {array|null} 属性数组 [{ key, value }] 或 null（解析失败）
 */
function parseStyleObject(styleObj) {
  // 去掉外层大括号
  const inner = styleObj.replace(/^\{|\}$/g, "").trim();
  if (!inner) return [];

  // 使用括号感知的逗号分割，避免值中的 { } ( ) [ ] 内的逗号被误分割
  const parts = splitByTopLevelCommas(inner);
  if (parts.length === 0) return null;

  const props = [];
  parts.forEach((part) => {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) return;
    const keyPart = part.substring(0, colonIdx).trim();
    const valuePart = part.substring(colonIdx + 1).trim();
    // 提取 key：去掉引号
    const key = keyPart.replace(/^['"]|['"]$/g, "");
    if (!key) return;
    props.push({ key, value: valuePart });
  });
  return props.length > 0 ? props : null;
}

/**
 * 按顶层逗号分割字符串，感知 { } ( ) [ ] 的嵌套深度
 * 不分割嵌套结构内部的逗号
 * @param {string} str - 待分割的字符串
 * @returns {string[]} 分割后的字符串数组
 */
function splitByTopLevelCommas(str) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * 将源码中的 \uXXXX Unicode 转义序列还原为实际字符
 * LLM agent 通过 write_file 写入文件时，可能将中文字符输出为 \uXXXX 转义序列，
 * 此函数将其还原为实际中文字符，保持源码可读性
 * @param {string} code - 源码
 * @returns {string} 还原后的源码
 */
function deescapeUnicode(code) {
  // 将字符串字面量中的 \uXXXX 转义还原为实际字符，但跳过正则表达式字面量
  // 正则中的 \u4e00 等是正则语法，还原为实际字符会改变其含义
  // 策略：按正则字面量 /.../ 分段，只处理非正则部分
  const parts = code.split(/(\/[^/\n]+\/[gimsuy]*)/);
  return parts
    .map((part, i) => {
      // 奇数索引为正则字面量，跳过
      if (i % 2 === 1) return part;
      return part.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
    })
    .join("");
}

/**
 * 清理旧版注入残留：inject: ["isRtl"]、import i18nMixin from i18n-plugin、mixins: [i18nMixin()]
 * i18nMixin 已在 main.js 中通过 Vue.mixin 全局引入，isRtl 作为计算属性全局可用，
 * 单文件无需 inject、import 或 mixins 声明
 * @param {string} code - Vue 文件完整源码
 * @returns {object} 变换结果 { changed, code }
 */
function cleanupLegacyInjects(code) {
  let result = code;
  let changed = false;

  // 移除旧版 import { i18nMixin } from "@/languages/i18n-plugin/i18nMixin"
  const oldImportPattern = /import\s*\{\s*i18nMixin\s*\}\s*from\s*["']@\/languages\/i18n-plugin\/i18nMixin["'];?\n?/;
  if (oldImportPattern.test(result)) {
    result = result.replace(oldImportPattern, "");
    changed = true;
  }

  // 移除 mixins 数组中的 i18nMixin()
  if (/mixins:\s*\[\s*i18nMixin\(\)\s*,?\s*\]/.test(result)) {
    result = result.replace(/\n\s*mixins:\s*\[\s*i18nMixin\(\)\s*,?\s*\],?/g, "");
    changed = true;
  } else if (/mixins:\s*\[/.test(result) && /i18nMixin\(\)/.test(result)) {
    result = result.replace(/,?\s*i18nMixin\(\)/g, "");
    result = result.replace(/mixins:\s*\[\s*,/, "mixins: [");
    changed = true;
  }

  // 移除 inject 中的 "isRtl"
  if (/inject\s*:\s*\[/.test(result) && /"isRtl"/.test(result)) {
    result = result.replace(/,?\s*"isRtl"/g, "");
    // inject 数组变空时移除整行
    result = result.replace(/\n\s*inject\s*:\s*\[\s*\],?/g, "");
    changed = true;
  }

  return { changed, code: result };
}

/**
 * 检测 script 中的 JS 级别方向性赋值，自动转换为 isRtl 三元表达式
 * 如 style.cssFloat = "left" -> style.cssFloat = this.isRtl ? "right" : "left"
 * @param {string} code - script 源码
 * @returns {object} 变换结果 { changed, replacements, code }
 */
function transformRtlJsAssignments(code) {
  let replacements = 0;
  let result = code;

  // 匹配 .style.left/right = "left"/"right" 或 .cssFloat/styleFloat = "left"/"right"
  const patterns = [
    // style.left = "left" / style.right = "right" 等
 /(\.\w*(?:left|right|cssFloat|styleFloat)\s*=\s*)"?(left|right)"?/g,
  ];

  patterns.forEach((pattern) => {
    result = result.replace(pattern, (match, prefix, value) => {
      // 跳过已包含 isRtl 的
      if (match.includes("isRtl")) return match;
      replacements += 1;
      const opposite = value === "left" ? "right" : "left";
      return `${prefix}this.isRtl ? "${opposite}" : "${value}"`;
    });
  });

  return {
    changed: replacements > 0,
    replacements,
    code: result,
  };
}

/**
 * 将 el-form 的 label-width 从固定 px 值改为 auto
 * 金标项目中所有 el-form 使用 label-width="auto"，让 Element UI 根据内容自动计算宽度
 * 保留 label-width="0" 和 label-width="0px"（特殊布局用途）
 * @param {string} code - template 源码
 * @returns {object} 变换结果 { changed, replacements, code }
 */
function transformLabelWidthToAuto(code) {
  let replacements = 0;
  let result = code;

  // 匹配 label-width="数字px" 但不匹配 label-width="0" 和 label-width="0px"
  result = result.replace(
    /label-width="(\d+)px"/g,
    (match, px) => {
      if (px === "0") return match;
      replacements += 1;
      return 'label-width="auto"';
    },
  );

  return {
    changed: replacements > 0,
    replacements,
    code: result,
  };
}

/**
 * 将 el-date-picker type="datetime" 替换为 kd-date-picker（国际化时区组件）
 * 仅替换 type="datetime" 的组件，其他 type 不处理
 * 支持自闭合标签和配对标签（含闭合标签）
 * @param {string} code - template 源码
 * @returns {object} 变换结果 { changed, replacements, code }
 */
function transformDatePickerComponent(code) {
  let replacements = 0;
  let result = code;

  // 匹配配对标签：<el-date-picker ... type="datetime" ...>...</el-date-picker>
  result = result.replace(
    /<el-date-picker\b([^>]*?)>([\s\S]*?)<\/el-date-picker>/g,
    (match, attrs, content) => {
      if (!/type=["']datetime["']/.test(attrs)) return match;
      replacements += 1;
      return `<kd-date-picker${attrs}>${content}</kd-date-picker>`;
    },
  );

  // 匹配自闭合标签：<el-date-picker ... type="datetime" ... />
  result = result.replace(
    /<el-date-picker\b([^>]*?)\/>/g,
    (match, attrs) => {
      if (!/type=["']datetime["']/.test(attrs)) return match;
      replacements += 1;
      return `<kd-date-picker${attrs}/>`;
    },
  );

  return {
    changed: replacements > 0,
    replacements,
    code: result,
  };
}

/**
 * 国际化时区 JS 代码变换：
 * - Date.now() → this.tzDateNow()
 * - new Date() → this.tzNewDate()（仅无参调用，new Date("xxx") 不处理）
 * - parseTime() → parseTime(this.tzNewDate())（仅无参调用）
 * - dayjs() → this.$i18nNow()（仅无参调用）
 * 以上替换均为幂等：已替换的不会再被匹配
 * @param {string} code - JS 源码
 * @returns {object} 变换结果 { changed, replacements, code }
 */
function transformTimezoneJs(code) {
  let replacements = 0;
  let result = code;

  // Date.now() → this.tzDateNow()
  result = result.replace(/\bDate\.now\(\)/g, () => {
    replacements += 1;
    return "this.tzDateNow()";
  });

  // new Date() → this.tzNewDate()（仅无参）
  result = result.replace(/\bnew\s+Date\(\)/g, () => {
    replacements += 1;
    return "this.tzNewDate()";
  });

  // parseTime() → parseTime(this.tzNewDate())（仅无参）
  result = result.replace(/\bparseTime\(\)/g, () => {
    replacements += 1;
    return "parseTime(this.tzNewDate())";
  });

  // dayjs() → this.$i18nNow()（仅无参）
  result = result.replace(/\bdayjs\(\)/g, () => {
    replacements += 1;
    return "this.$i18nNow()";
  });

  return {
    changed: replacements > 0,
    replacements,
    code: result,
  };
}

/**
 * 用 Babel AST 变换 JS 文件中的中文字符串为 t() 调用
 * @param {string} source - 源码
 * @param {object} options - { vueComponent, relativePath, preset, config }
 * @returns {object} 变换结果
 */
/**
 * 检测路径是否在 beforeRouteEnter 回调内部
 * beforeRouteEnter 中 this 不可用，需使用 t() 而非 this.t()
 * @param {object} pathRef - Babel 路径引用
 * @returns {boolean} 是否在 beforeRouteEnter 内
 */
function isInBeforeRouteEnter(pathRef) {
  return pathRef.findParent(
    (parentPath) =>
      parentPath.isObjectMethod() &&
      parentPath.node.key &&
      parentPath.node.key.name === "beforeRouteEnter",
  );
}

/**
 * 检测路径是否在 props 默认值内部
 * props 的 default 属性或函数中 this 不可用，需使用 t() 而非 this.t()
 * 匹配两种形式：default: "中文" 和 default() { return "中文" }
 * @param {object} pathRef - Babel 路径引用
 * @returns {boolean} 是否在 props default 内
 */
function isInPropsDefault(pathRef) {
  // 形式 1：default() { return "中文" } — ObjectMethod
  const asMethod = pathRef.findParent(
    (parentPath) =>
      parentPath.isObjectMethod() &&
      parentPath.node.key &&
      parentPath.node.key.name === "default" &&
      parentPath.parentPath &&
      parentPath.parentPath.isObjectProperty() &&
      parentPath.parentPath.node.key &&
      parentPath.parentPath.node.key.name !== "props" &&
      parentPath.parentPath.parentPath &&
      parentPath.parentPath.parentPath.isObjectExpression() &&
      parentPath.parentPath.parentPath.parentPath &&
      parentPath.parentPath.parentPath.parentPath.isObjectProperty() &&
      parentPath.parentPath.parentPath.parentPath.node.key &&
      parentPath.parentPath.parentPath.parentPath.node.key.name === "props",
  );
  if (asMethod) return true;

  // 形式 2：default: "中文" — ObjectProperty with key "default"
  // 直接检查父节点是否为 default 属性
  const propPath = pathRef.findParent(
    (parentPath) =>
      parentPath.isObjectProperty() &&
      parentPath.node.key &&
      parentPath.node.key.name === "default",
  );
  if (propPath) {
    // 确认这个 default 属性在某个 prop 定义对象中（在 props 下）
    const propOwner = propPath.parentPath; // ObjectExpression of the prop
    if (propOwner && propOwner.isObjectExpression()) {
      const propDef = propOwner.parentPath; // ObjectProperty of the prop name
      if (propDef && propDef.isObjectProperty()) {
        const propsObj = propDef.parentPath; // ObjectExpression of props
        if (propsObj && propsObj.isObjectExpression()) {
          const propsProp = propsObj.parentPath; // ObjectProperty "props"
          if (
            propsProp &&
            propsProp.isObjectProperty() &&
            propsProp.node.key &&
            propsProp.node.key.name === "props"
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * 检测路径是否在不可使用 this 的上下文中（beforeRouteEnter、props default）
 * @param {object} pathRef - Babel 路径引用
 * @returns {boolean} 是否在不可使用 this 的上下文
 */
function isNoThisContext(pathRef) {
  return isInBeforeRouteEnter(pathRef) || isInPropsDefault(pathRef);
}

function transformJsFile(source, options) {
  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: "unambiguous",
      plugins: JS_PARSE_PLUGINS,
    });
  } catch (error) {
    return {
      changed: false,
      replacements: 0,
      code: source,
      error: error.message,
    };
  }

  const defaultTranslator = options.vueComponent ? "this.t" : "t";
  const patches = [];
  let usedNoThisT = false;

  traverse(ast, {
    enter(pathRef) {
      if (isAlreadyTranslated(pathRef)) {
        pathRef.skip();
        return;
      }

      // Vue 组件中，beforeRouteEnter 和 props default 的 this 不可用
      // 这些上下文使用 t() 而非 this.t()，并需要 import { t } from "@/languages"
      const translator =
        options.vueComponent && isNoThisContext(pathRef) ? "t" : defaultTranslator;
      if (translator === "t" && options.vueComponent) {
        usedNoThisT = true;
      }

      if (pathRef.isBinaryExpression({ operator: "+" })) {
        const callExpression = buildTranslateCallFromConcatenation(
          pathRef.node,
          translator,
        );
        if (callExpression) {
          patches.push({
            start: pathRef.node.start,
            end: pathRef.node.end,
            code: generate(callExpression, { jsescOption: { minimal: true } })
              .code,
          });
          pathRef.skip();
          return;
        }
      }

      if (pathRef.isTemplateLiteral()) {
        const callExpression = buildTranslateCallFromTemplateLiteral(
          pathRef.node,
          translator,
        );
        if (callExpression) {
          patches.push({
            start: pathRef.node.start,
            end: pathRef.node.end,
            code: generate(callExpression, { jsescOption: { minimal: true } })
              .code,
          });
          pathRef.skip();
          return;
        }
      }

      if (pathRef.isStringLiteral() && shouldTransformStringLiteral(pathRef)) {
        if (!containsChinese(pathRef.node.value)) return;
        const callExpr = buildTranslateCallExpression(
          translator,
          pathRef.node.value,
        );
        patches.push({
          start: pathRef.node.start,
          end: pathRef.node.end,
          code: generate(callExpr, { jsescOption: { minimal: true } }).code,
        });
        pathRef.skip();
      }
    },
  });

  if (patches.length === 0) {
    const cleaned = unwrapNestedTranslateCalls(source);
    if (cleaned !== source) {
      return { changed: true, replacements: 0, code: cleaned };
    }
    return { changed: false, replacements: 0, code: source };
  }

  let code = applyPatches(source, patches);

  // Vue 组件中如果使用了 t()（beforeRouteEnter/props default 上下文），需要注入 import
  // 独立 JS 文件也需要注入 import
  if ((!options.vueComponent || usedNoThisT) && needsTranslateImport(code)) {
    code = injectTranslateImport(code);
  }

  code = unwrapNestedTranslateCalls(code);

  return {
    changed: true,
    replacements: patches.length,
    code,
  };
}

/**
 * 变换 p-l 绑定属性表达式，始终生成 `fieldName,${t('label')}` 格式的模板字面量
 * 处理以下输入形式：
 * - 'fieldName,' + t('中文')  → `fieldName,${t('中文')}`
 * - 'fieldName,' + '中文'     → `fieldName,${t('中文')}`
 * - t('中文')                  → `${t('中文')}`
 * - `fieldName,${t('中文')}`   → 保持不变
 * @param {string} expressionSource - 属性表达式源码
 * @returns {object|null} 变换结果 { code, replacements } 或 null（不匹配 p-l 模式）
 */
function transformPLAttribute(expressionSource) {
  const trimmed = expressionSource.trim();

  // 已经是模板字面量格式，无需处理
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) return null;

  let ast;
  try {
    ast = parser.parse(`(${trimmed})`, {
      sourceType: "module",
      plugins: JS_PARSE_PLUGINS,
    });
  } catch (_error) {
    return null;
  }

  let result = null;
  let replacements = 0;

  traverse(ast, {
    enter(pathRef) {
      if (result) {
        pathRef.skip();
        return;
      }

      // 处理字符串拼接：'fieldName,' + t('中文') 或 'fieldName,' + '中文'
      if (pathRef.isBinaryExpression({ operator: "+" })) {
        const parts = flattenConcatenation(pathRef.node);
        if (!parts) return;

        const templateParts = [];
        const exprParts = [];
        let hasChinese = false;

        parts.forEach((part) => {
          if (t.isStringLiteral(part)) {
            if (containsChinese(part.value)) {
              templateParts.push(
                "${" +
                  buildTranslateCallSource("t", part.value, [], true) +
                  "}",
              );
              exprParts.push(buildTranslateCallExpression("t", part.value));
              replacements += 1;
              hasChinese = true;
            } else {
              templateParts.push(part.value);
            }
            return;
          }

          // 已经是 t() 调用的部分保持不变
          if (t.isCallExpression(part) && isTranslateCallee(part.callee)) {
            const code = generate(part, {
              jsescOption: { minimal: true },
            }).code;
            templateParts.push("${" + code + "}");
            exprParts.push(part);
            replacements += 1;
            return;
          }

          // 其他表达式保持为插值
          const code = generate(part, { jsescOption: { minimal: true } }).code;
          templateParts.push("${" + code + "}");
          exprParts.push(part);
        });

        if (!hasChinese && replacements === 0) return;

        result = {
          code: "`" + templateParts.join("") + "`",
          replacements: Math.max(replacements, 1),
        };
        pathRef.skip();
        return;
      }

      // 处理单独的 t('中文') 调用
      if (
        pathRef.isCallExpression() &&
        isTranslateCallee(pathRef.node.callee)
      ) {
        const code = generate(pathRef.node, {
          jsescOption: { minimal: true },
        }).code;
        result = {
          code: "`${" + code + "}`",
          replacements: 1,
        };
        pathRef.skip();
        return;
      }

      // 处理单独的中文字符串字面量
      if (
        t.isStringLiteral(pathRef.node) &&
        containsChinese(pathRef.node.value) &&
        !pathRef.findParent(
          (p) => p.isCallExpression() && isTranslateCallee(p.node.callee),
        )
      ) {
        const callCode = buildTranslateCallSource(
          "t",
          pathRef.node.value,
          [],
          true,
        );
        result = {
          code: "`${" + callCode + "}`",
          replacements: 1,
        };
        pathRef.skip();
        return;
      }
    },
  });

  return result;
}

/**
 * 变换内联表达式中的中文字符串
 * @param {string} expressionSource - 表达式源码
 * @param {string} translator - 翻译函数名（t 或 this.t）
 * @param {boolean} singleQuote - 是否使用单引号
 * @returns {object} 变换结果
 */
function transformInlineExpression(
  expressionSource,
  translator,
  singleQuote = false,
) {
  let ast;
  try {
    ast = parser.parse(`(${expressionSource})`, {
      sourceType: "module",
      plugins: JS_PARSE_PLUGINS,
    });
  } catch (_error) {
    return { changed: false, replacements: 0, code: expressionSource };
  }

  const patches = [];

  traverse(ast, {
    enter(pathRef) {
      if (isAlreadyTranslated(pathRef)) {
        pathRef.skip();
        return;
      }

      if (pathRef.isBinaryExpression({ operator: "+" })) {
        const callExpression = buildTranslateCallFromConcatenation(
          pathRef.node,
          translator,
        );
        if (callExpression) {
          patches.push({
            start: pathRef.node.start,
            end: pathRef.node.end,
            code: generateCode(callExpression, singleQuote),
          });
          pathRef.skip();
          return;
        }
      }

      if (pathRef.isTemplateLiteral()) {
        const callExpression = buildTranslateCallFromTemplateLiteral(
          pathRef.node,
          translator,
        );
        if (callExpression) {
          patches.push({
            start: pathRef.node.start,
            end: pathRef.node.end,
            code: generateCode(callExpression, singleQuote),
          });
          pathRef.skip();
          return;
        }
      }

      if (
        pathRef.isStringLiteral() &&
        shouldTransformInlineStringLiteral(pathRef)
      ) {
        if (!containsChinese(pathRef.node.value)) return;
        const callExpr = buildTranslateCallExpression(
          translator,
          pathRef.node.value,
        );
        patches.push({
          start: pathRef.node.start,
          end: pathRef.node.end,
          code: generateCode(callExpr, singleQuote),
        });
        pathRef.skip();
      }
    },
  });

  if (patches.length === 0) {
    return { changed: false, replacements: 0, code: expressionSource };
  }

  // patches 中的位置是相对于 (expressionSource) 的，需要偏移 1（去掉外层括号）
  const adjustedPatches = patches.map((p) => ({
    start: p.start - 1,
    end: p.end - 1,
    code: p.code,
  }));

  return {
    changed: true,
    replacements: patches.length,
    code: applyPatches(expressionSource, adjustedPatches),
  };
}

/**
 * 将含插值表达式的模板文本转换为 t() 调用
 * @param {string} rawText - 原始文本
 * @returns {object} 变换结果
 */
function convertInterpolatedTemplateText(rawText) {
  if (!containsChinese(rawText))
    return { changed: false, replacements: 0, code: rawText };
  if (rawText.includes("t("))
    return { changed: false, replacements: 0, code: rawText };

  const parts = rawText.split(/(\{\{[\s\S]*?\}\})/g).filter(Boolean);
  const args = [];
  let templateText = "";
  let replacements = 0;

  parts.forEach((part) => {
    const interpolationMatch = part.match(/^\{\{\s*([\s\S]*?)\s*\}\}$/);
    if (interpolationMatch) {
      const transformed = transformInlineExpression(interpolationMatch[1], "t");
      args.push(transformed.code.trim());
      templateText += "{}";
      replacements += Math.max(transformed.replacements, 1);
      return;
    }

    templateText += part;
  });

  if (args.length === 0 || !containsChinese(templateText)) {
    return { changed: false, replacements: 0, code: rawText };
  }

  const leading = templateText.match(/^\s*/)[0];
  const trailing = templateText.match(/\s*$/)[0];
  const trimmed = templateText.trim();
  if (!trimmed) return { changed: false, replacements: 0, code: rawText };

  return {
    changed: true,
    replacements,
    code: `${leading}{{ ${buildTranslateCallSource("t", trimmed, args)} }}${trailing}`,
  };
}

/**
 * 将模板字面量转换为 t() 调用表达式
 * @param {object} node - Babel TemplateLiteral 节点
 * @param {string} translator - 翻译函数名
 * @returns {object|null} Babel CallExpression 或 null
 */
function buildTranslateCallFromTemplateLiteral(node, translator) {
  // 优先检测：如果模板中某个插值是三元表达式且分支为含中文字符串字面量，
  // 拆分为两个独立的 t() 调用
  for (let i = 0; i < node.expressions.length; i += 1) {
    const splitCall = buildTernarySplitTranslateCall(
      node,
      node.expressions[i],
      translator,
    );
    if (splitCall) return splitCall;
  }

  const textParts = [];
  const args = [];

  node.quasis.forEach((quasi, index) => {
    textParts.push(quasi.value.cooked || "");
    if (index < node.expressions.length) {
      textParts.push("{}");
      args.push(node.expressions[index]);
    }
  });

  const text = textParts.join("");
  if (!containsChinese(text)) return null;
  return buildTranslateCallExpression(translator, text, args);
}

/**
 * 当模板字面量中的插值表达式为三元条件表达式（a ? '中文1' : '中文2'）时，
 * 将模板拆分为两个独立的 t() 调用：condition ? t('完整中文1') : t('完整中文2')
 * @param {object} templateNode - 模板字面量节点
 * @param {object} exprNode - 当前插值表达式节点
 * @param {string} translator - 翻译函数名
 * @returns {object|null} Babel ConditionalExpression 或 null
 */
function buildTernarySplitTranslateCall(templateNode, exprNode, translator) {
  if (!t.isConditionalExpression(exprNode)) return null;
  const { consequent, alternate } = exprNode;
  if (!t.isStringLiteral(consequent) || !t.isStringLiteral(alternate))
    return null;

  // 找到当前表达式在模板中的位置索引
  const exprIndex = templateNode.expressions.indexOf(exprNode);
  if (exprIndex === -1) return null;

  // 构建两个完整的中文字符串：将三元分支的值代入模板
  const texts = [consequent.value, alternate.value].map((branchValue) => {
    const parts = [];
    templateNode.quasis.forEach((quasi, index) => {
      parts.push(quasi.value.cooked || "");
      if (index < templateNode.expressions.length) {
        if (index === exprIndex) {
          parts.push(branchValue);
        } else {
          parts.push("{}");
        }
      }
    });
    return parts.join("");
  });

  // 两个分支的文本都必须包含中文才进行拆分
  if (!containsChinese(texts[0]) || !containsChinese(texts[1])) return null;

  return t.conditionalExpression(
    exprNode.test,
    buildTranslateCallExpression(translator, texts[0]),
    buildTranslateCallExpression(translator, texts[1]),
  );
}

/**
 * 将字符串拼接表达式转换为 t() 调用
 * @param {object} node - Babel BinaryExpression 节点
 * @param {string} translator - 翻译函数名
 * @returns {object|null} Babel CallExpression 或 null
 */
function buildTranslateCallFromConcatenation(node, translator) {
  const parts = flattenConcatenation(node);
  if (!parts) return null;

  let text = "";
  const args = [];

  parts.forEach((part) => {
    if (t.isStringLiteral(part)) {
      text += part.value;
      return;
    }

    if (t.isTemplateLiteral(part)) {
      const converted = buildTranslateCallFromTemplateLiteral(part, translator);
      if (converted) {
        args.push(converted);
        text += "{}";
        return;
      }
    }

    args.push(part);
    text += "{}";
  });

  if (!containsChinese(text)) return null;
  return buildTranslateCallExpression(translator, text, args);
}

/**
 * 递归展开嵌套的字符串拼接表达式
 * @param {object} node - Babel BinaryExpression 节点
 * @returns {array|null} 展开后的节点数组
 */
function flattenConcatenation(node) {
  if (!t.isBinaryExpression(node, { operator: "+" })) return null;

  const leftParts = t.isBinaryExpression(node.left, { operator: "+" })
    ? flattenConcatenation(node.left)
    : [node.left];
  const rightParts = t.isBinaryExpression(node.right, { operator: "+" })
    ? flattenConcatenation(node.right)
    : [node.right];

  if (!leftParts || !rightParts) return null;
  return [...leftParts, ...rightParts];
}

/**
 * 构建 Babel t() 调用表达式节点
 * @param {string} translator - 翻译函数名
 * @param {string} text - 中文文本
 * @param {array} args - 额外参数节点数组
 * @returns {object} Babel CallExpression 节点
 */
function buildTranslateCallExpression(translator, text, args = []) {
  const callee =
    translator === "this.t"
      ? t.memberExpression(t.thisExpression(), t.identifier("t"))
      : t.identifier("t");
  return t.callExpression(callee, [t.stringLiteral(text), ...args]);
}

/**
 * 使用 Babel 生成代码，当 singleQuote 为 true 时将 t() 中的双引号转为单引号
 * 用于绑定属性上下文，避免双引号与属性值的双引号冲突
 * @param {object} node - Babel AST 节点
 * @param {boolean} singleQuote - 是否使用单引号
 * @returns {string} 生成的代码
 */
function generateCode(node, singleQuote = false) {
  const code = generate(node, {
    jsescOption: { minimal: true },
  }).code;
  if (!singleQuote) return code;
  // 将 t("...") 中的双引号替换为单引号，避免在双引号属性值中冲突
  return code.replace(/(\bt(?:his\.t)?\()"((?:[^"\\]|\\.)*)"/g, "$1'$2'");
}

/**
 * 生成 t() 调用的源码字符串
 * @param {string} translator - 翻译函数名
 * @param {string} text - 中文文本
 * @param {array} argSources - 参数源码数组
 * @param {boolean} singleQuote - 是否使用单引号
 * @returns {string} t() 调用源码
 */
function buildTranslateCallSource(
  translator,
  text,
  argSources = [],
  singleQuote = false,
) {
  if (singleQuote) {
    const escaped = escapeForSingleQuote(text);
    if (argSources.length === 0) return `${translator}('${escaped}')`;
    return `${translator}('${escaped}', ${argSources.join(", ")})`;
  }
  const escapedText = escapeForDoubleQuote(text);
  if (argSources.length === 0) return `${translator}("${escapedText}")`;
  return `${translator}("${escapedText}", ${argSources.join(", ")})`;
}

/**
 * 判断 StringLiteral 节点是否应该被转换为 t() 调用
 * @param {object} pathRef - Babel 路径引用
 * @returns {boolean} 是否应该转换
 */
function shouldTransformStringLiteral(pathRef) {
  if (pathRef.parentPath.isImportDeclaration()) return false;
  if (pathRef.parentPath.isExportDeclaration()) return false;
  // 正则表达式构造函数中的字符串不应被翻译（如 new RegExp("^[^一-龥 ]*$")）
  if (isRegExpConstructor(pathRef.parentPath)) return false;
  if (
    pathRef.parentPath.isObjectProperty({ key: pathRef.node }) &&
    !pathRef.parent.computed
  )
    return false;
  if (pathRef.parentPath.isObjectMethod()) return false;
  if (
    pathRef.parentPath.isMemberExpression({ property: pathRef.node }) &&
    !pathRef.parent.computed
  )
    return false;
  if (
    pathRef.parentPath.isCallExpression() &&
    pathRef.parent.callee === pathRef.node
  )
    return false;
  if (pathRef.parentPath.isDirective()) return false;
  if (pathRef.parentPath.isTSLiteralType()) return false;
  return !pathRef.findParent(
    (parentPath) =>
      parentPath.isCallExpression() &&
      (isTranslateCallee(parentPath.node.callee) ||
        isConsoleCallee(parentPath.node.callee) ||
        isDisplayNameLabelCallee(parentPath.node.callee)),
  );
}

/**
 * 判断内联表达式中的 StringLiteral 是否应该被转换
 * @param {object} pathRef - Babel 路径引用
 * @returns {boolean} 是否应该转换
 */
function shouldTransformInlineStringLiteral(pathRef) {
  // 正则表达式构造函数中的字符串不应被翻译
  if (isRegExpConstructor(pathRef.parentPath)) return false;
  if (
    pathRef.parentPath.isMemberExpression({ property: pathRef.node }) &&
    !pathRef.parent.computed
  )
    return false;
  if (
    pathRef.parentPath.isObjectProperty({ key: pathRef.node }) &&
    !pathRef.parent.computed
  )
    return false;
  return !pathRef.findParent(
    (parentPath) =>
      parentPath.isCallExpression() &&
      (isTranslateCallee(parentPath.node.callee) ||
        isConsoleCallee(parentPath.node.callee) ||
        isDisplayNameLabelCallee(parentPath.node.callee)),
  );
}

/**
 * 判断当前路径是否已在 t() 调用内部
 * @param {object} pathRef - Babel 路径引用
 * @returns {boolean} 是否已在 t() 内
 */
function isAlreadyTranslated(pathRef) {
  return pathRef.findParent(
    (parentPath) =>
      parentPath.isCallExpression() &&
      isTranslateCallee(parentPath.node.callee),
  );
}

/**
 * 判断调用表达式是否为 t 或 this.t
 * @param {object} callee - Babel callee 节点
 * @returns {boolean} 是否为翻译函数调用
 */
function isTranslateCallee(callee) {
  return (
    t.isIdentifier(callee, { name: "t" }) ||
    (t.isMemberExpression(callee) &&
      t.isIdentifier(callee.property, { name: "t" }))
  );
}

/**
 * 判断父路径是否为正则表达式构造函数调用（new RegExp(...) 或 RegExp(...)）
 * 正则表达式中的中文是字符集范围定义，不能被翻译
 * @param {object} parentPath - Babel 父路径
 * @returns {boolean} 是否为 RegExp 构造
 */
function isRegExpConstructor(parentPath) {
  if (!parentPath.isNewExpression() && !parentPath.isCallExpression())
    return false;
  const callee = parentPath.node.callee;
  return t.isIdentifier(callee, { name: "RegExp" });
}

/**
 * 判断调用表达式是否为 console.* 方法调用（如 console.log / console.warn 等）
 * console 调用属于调试日志，不纳入国际化范围
 * @param {object} callee - Babel callee 节点
 * @returns {boolean} 是否为 console 调用
 */
function isConsoleCallee(callee) {
  return (
    t.isMemberExpression(callee) &&
    t.isIdentifier(callee.object, { name: "console" })
  );
}

/**
 * 在 JS 文件顶部注入 import { t } from "@/languages"
 * 幂等性：已有相同 import 时跳过；已有 @/languages import 但缺少 t 时补充 t
 * @param {string} source - 源码
 * @returns {string} 注入后的源码
 */
function injectTranslateImport(source) {
  // 检查是否已存在 import { t } from "@/languages"
  const tImportRegex = /import\s*\{\s*t\s*\}\s*from\s*["']@\/languages["'];?/;
  if (tImportRegex.test(source)) return source;

  // 检查是否已有 from "@/languages" 但未导入 t —— 补充 t 到现有 import
  const languagesImportRegex =
    /(import\s*\{)([^}]*)(\}\s*from\s*["']@\/languages["'];?)/;
  const existingMatch = source.match(languagesImportRegex);
  if (existingMatch) {
    const importedNames = existingMatch[2].trim();
    // 如果 t 不在已有 import 中，添加它
    if (!/\bt\b/.test(importedNames)) {
      const newImport = `${existingMatch[1]} t, ${existingMatch[2]}${existingMatch[3]}`;
      return source.replace(existingMatch[0], newImport);
    }
    return source;
  }

  // 全新插入 import { t } from "@/languages"
  const importStatement = 'import { t } from "@/languages";\n';
  const importMatches = [...source.matchAll(/^import .+;$/gm)];
  if (importMatches.length === 0) return `${importStatement}${source}`;

  const lastImport = importMatches[importMatches.length - 1];
  const insertIndex = lastImport.index + lastImport[0].length + 1;
  return `${source.slice(0, insertIndex)}${importStatement}${source.slice(insertIndex)}`;
}

/**
 * 判断源码是否需要注入 t 的 import
 * 幂等性：已有 t 的 import 时不重复注入
 * @param {string} source - 源码
 * @returns {boolean} 是否需要注入
 */
function needsTranslateImport(source) {
  // 检查是否已有 import { t } from "@/languages"
  const tImportRegex = /import\s*\{\s*t\s*\}\s*from\s*["']@\/languages["'];?/;
  if (tImportRegex.test(source)) return false;
  // 仅匹配独立的 t() 调用，不匹配 this.t()（后者由 i18nPlugin 实例方法提供，无需 import）
  return /(?<!this\.)\bt\(/.test(source);
}

/**
 * 判断文件是否应该被跳过
 * @param {string} relativePath - 相对路径
 * @param {object} config - i18n 配置
 * @returns {boolean} 是否跳过
 */
function shouldSkipFile(relativePath, config) {
  // scaffold 生成的基础设施文件不应被 apply 处理，
  // 否则其中的中文常量（如 chLabel: "中文名称"）会被错误包裹为 t()
  const infrastructureFiles = [
    "src/mixins/i18n-mixin.js",
    "src/utils/i18n.js",
    "src/utils/elementui-utils.js",
    "src/styles/i18n-style.scss",
    "postcss.config.js",
  ];
  return (
    (config.excludeFiles || []).includes(relativePath) ||
    infrastructureFiles.includes(relativePath)
  );
}

/**
 * 检测文本中是否包含中文
 * @param {string} text - 文本
 * @returns {boolean} 是否包含中文
 */
function containsChinese(text) {
  return /[\u3400-\u9fff]/.test(text);
}

/**
 * 修复双重包裹的 t(t('...')) → t('...')，防止 LLM 手动修改或多次 apply 导致的重复包裹
 * 支持多重嵌套（t(t(t('...')))）和混合形式（t(this.t('...')) / this.t(t('...'))）
 * @param {string} code - 源码
 * @returns {string} 修复后的源码
 */
function unwrapNestedTranslateCalls(code) {
  let prev;
  do {
    prev = code;
    // 匹配 t(t('...')) / this.t(this.t('...')) / 混合形式（t(this.t('...')) 等）
    // 支持带参数的 t() 调用：t(t('...', arg1), arg2) → t('...', arg1, arg2)（保守策略：仅展开无额外外层参数的简单嵌套）
    code = code.replace(
      /\b(t|this\.t)\(\s*(t|this\.t)\(\s*(['"])((?:[^'"\\]|\\.)*?)\3\s*\)\s*\)/g,
      "$1($3$4$3)",
    );
  } while (code !== prev);
  return code;
}

/**
 * 转义文本中的双引号和反斜杠
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeForDoubleQuote(text) {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * 转义文本中的单引号和反斜杠
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeForSingleQuote(text) {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * 对源码按位置补丁进行定点替换，不影响补丁范围外的代码格式
 * @param {string} source - 原始源码
 * @param {array} patches - 补丁数组 [{ start, end, code }]，按位置降序应用
 * @returns {string} 替换后的源码
 */
function applyPatches(source, patches) {
  const sorted = [...patches].sort((a, b) => b.start - a.start);
  let result = source;
  sorted.forEach((patch) => {
    result =
      result.slice(0, patch.start) + patch.code + result.slice(patch.end);
  });
  return result;
}

/**
 * 生成文件变更预览（第一个差异行）
 * @param {string} beforeCode - 变更前源码
 * @param {string} afterCode - 变更后源码
 * @returns {object|null} 预览对象 { line, before, after }
 */
function buildChangePreview(beforeCode, afterCode) {
  const beforeLines = beforeCode.split(/\r?\n/);
  const afterLines = afterCode.split(/\r?\n/);
  const maxLength = Math.max(beforeLines.length, afterLines.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      return {
        line: index + 1,
        before: beforeLines[index] || "",
        after: afterLines[index] || "",
      };
    }
  }

  return null;
}

/**
/**
 * 从 Vue SFC 源码中提取 <script> 区域内容
 * @param {string} source - Vue 文件完整源码
 * @returns {string|null} script 内容，无 script 时返回 null
 */
function extractScriptContent(source) {
  let sfc;
  try {
    sfc = parseComponent(source);
  } catch {
    const match = source.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    return match ? match[1] : null;
  }
  if (!sfc.script || !sfc.script.content) return null;
  return sfc.script.start != null && sfc.script.end != null
    ? source.slice(sfc.script.start, sfc.script.end)
    : sfc.script.content;
}

/**
 * 清理已国际化代码中的常见问题，用于重复 run 时的自动修复
 * - 展开嵌套的 t(t('...')) 为单层 t('...')
 * - 移除重复的 import { t } from "@/languages" 语句
 * - 移除 Vue 文件中不必要的 import（script 无独立 t() 调用时）
 * - 修复多余的空格和格式问题（通过 eslint --fix）
 * @param {string} projectRoot - 目标项目根路径
 * @param {object} config - i18n 配置
 * @returns {object} 清理报告
 */
function cleanupI18n(projectRoot, config) {
  const files = collectTargetFiles(projectRoot, config);
  const cleanedFiles = [];

  files.forEach((filePath) => {
    const relativePath = toRelative(projectRoot, filePath);
    if (shouldSkipFile(relativePath, config)) return;

    const original = fs.readFileSync(filePath, "utf8");
    let code = original;
    let fixCount = 0;

    // 0. 修复 beforeRouteEnter/props default 上下文中错误使用的 this.t() -> t()
    // 这些上下文中 this 不可用，之前的 run 可能错误地包裹为 this.t()
    const ext = path.extname(filePath);
    const noThisResult =
      ext === ".vue"
        ? fixNoThisTranslateCallsInVue(code)
        : fixNoThisTranslateCalls(code);
    if (noThisResult.changed) {
      code = noThisResult.code;
      fixCount += noThisResult.fixCount;
    }

    // 1. 展开嵌套 t(t('...'))
    const beforeUnwrap = code;
    code = unwrapNestedTranslateCalls(code);
    if (code !== beforeUnwrap) fixCount += 1;

    // 2. 移除重复的 import { t } from "@/languages" 语句
    const importRegex =
      /import\s*\{\s*t\s*\}\s*from\s*["']@\/languages["'];?\n?/g;
    const importMatches = code.match(importRegex);
    if (importMatches && importMatches.length > 1) {
      // 保留第一个，移除其余
      let firstKept = false;
      code = code.replace(importRegex, (match) => {
        if (!firstKept) {
          firstKept = true;
          return match;
        }
        return "";
      });
      fixCount += importMatches.length - 1;
    }

    // 2.5 移除 Vue 文件中不必要的 import { t } from "@/languages"
    // Vue 文件 template 中的 t() 由 voerkai18n-loader autoImport 处理，
    // script 中的 this.t() 由 i18nPlugin 实例方法提供
    // 仅当 script 区域存在独立的 t() 调用（非 this.t()）时才需要 import
    if (ext === ".vue") {
      const scriptContent = extractScriptContent(code);
      const hasStandaloneT =
        scriptContent && /(?<!this\.)\bt\(/.test(scriptContent);
      const importCheckRegex =
        /import\s*\{\s*t\s*\}\s*from\s*["']@\/languages["'];?\n?/;
      if (!hasStandaloneT && importCheckRegex.test(code)) {
        code = code.replace(importCheckRegex, "").replace(/\n{3,}/g, "\n\n");
        fixCount += 1;
      }
    }

    if (fixCount > 0) {
      fs.writeFileSync(filePath, code, "utf8");
      cleanedFiles.push({ file: relativePath, fixCount });
    }
  });

  // 3. eslint --fix 修复格式
  if (cleanedFiles.length > 0) {
    runEslintFix(
      projectRoot,
      cleanedFiles.map((f) => f.file),
    );
  }

  return {
    ok: true,
    summary: {
      cleanedFileCount: cleanedFiles.length,
      totalFixes: cleanedFiles.reduce((sum, f) => sum + f.fixCount, 0),
    },
    cleanedFiles,
  };
}
function fixNoThisTranslateCalls(source) {
  // 快速检测：不含 this.t 则无需处理
  if (!/this\s*\.\s*t\s*\(/.test(source)) {
    return { changed: false, code: source, fixCount: 0 };
  }

  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: "unambiguous",
      plugins: JS_PARSE_PLUGINS,
    });
  } catch {
    return { changed: false, code: source, fixCount: 0 };
  }

  const patches = [];

  traverse(ast, {
    CallExpression(pathRef) {
      const callee = pathRef.node.callee;
      // 只处理 this.t() 形式的调用
      if (
        !t.isMemberExpression(callee) ||
        !t.isThisExpression(callee.object) ||
        !t.isIdentifier(callee.property, { name: "t" })
      ) {
        return;
      }

      // 只处理 beforeRouteEnter 和 props default 上下文中的 this.t()
      if (!isNoThisContext(pathRef)) return;

      // 用定点补丁移除 "this." 前缀，保留 "t(...)" 不变
      // callee.start 指向 "this"，callee.property.start 指向 "t"
      patches.push({
        start: callee.start,
        end: callee.property.start,
        code: "",
      });
    },
  });

  if (patches.length === 0) {
    return { changed: false, code: source, fixCount: 0 };
  }

  let code = applyPatches(source, patches);

  // 转换为 t() 后需要确保 import { t } from "@/languages" 存在
  if (needsTranslateImport(code)) {
    code = injectTranslateImport(code);
  }

  return { changed: true, code, fixCount: patches.length };
}

/**
 * 对 Vue SFC 文件的 script 区域执行 fixNoThisTranslateCalls
 * 提取 script 内容、修复、注入 import、替换回原文件
 * @param {string} source - Vue 文件完整源码
 * @returns {object} { changed, code, fixCount }
 */
function fixNoThisTranslateCallsInVue(source) {
  let sfc;
  try {
    sfc = parseComponent(source);
  } catch {
    return { changed: false, code: source, fixCount: 0 };
  }

  if (!sfc.script || !sfc.script.content) {
    return { changed: false, code: source, fixCount: 0 };
  }

  const scriptContent =
    sfc.script.start != null && sfc.script.end != null
      ? source.slice(sfc.script.start, sfc.script.end)
      : sfc.script.content;

  const result = fixNoThisTranslateCalls(scriptContent);
  if (!result.changed) {
    return { changed: false, code: source, fixCount: 0 };
  }

  const code = source.replace(scriptContent, result.code);
  return { changed: true, code, fixCount: result.fixCount };
}

module.exports = {
  applyI18n,
  cleanupI18n,
  deescapeUnicode,
};
