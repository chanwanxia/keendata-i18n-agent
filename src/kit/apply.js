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
    return transformJsFile(source, {
      vueComponent: false,
      relativePath,
      preset,
      config,
    });
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

  // 先去除 HTML 注释，避免注释中的中文被误处理（保留占位以维持行号）
  code = code.replace(/<!--[\s\S]*?-->/g, (match) =>
    match.replace(/[^\n]/g, " "),
  );

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

  const cleanedCode = unwrapNestedTranslateCalls(code);
  return {
    changed: replacements > 0 || cleanedCode !== code,
    replacements,
    code: cleanedCode,
  };
}

/**
 * 用 Babel AST 变换 JS 文件中的中文字符串为 t() 调用
 * @param {string} source - 源码
 * @param {object} options - { vueComponent, relativePath, preset, config }
 * @returns {object} 变换结果
 */
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

  const translator = options.vueComponent ? "this.t" : "t";
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

  if (!options.vueComponent && needsTranslateImport(code)) {
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
        isConsoleCallee(parentPath.node.callee)),
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
        isConsoleCallee(parentPath.node.callee)),
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
  return /\bt\(/.test(source);
}

/**
 * 判断文件是否应该被跳过
 * @param {string} relativePath - 相对路径
 * @param {object} config - i18n 配置
 * @returns {boolean} 是否跳过
 */
function shouldSkipFile(relativePath, config) {
  return (config.excludeFiles || []).includes(relativePath);
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
 * 清理已国际化代码中的常见问题，用于重复 run 时的自动修复
 * - 展开嵌套的 t(t('...')) 为单层 t('...')
 * - 移除重复的 import { t } from "@/languages" 语句
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

module.exports = {
  applyI18n,
  cleanupI18n,
};
