const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");
const { collectTargetFiles, toRelative } = require("./files");
const { getPresetById } = require("./presets");

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
      replacements += 1;
      const trimmed = rawText.trim();
      const leading = rawText.match(/^\s*/)[0];
      const trailing = rawText.match(/\s*$/)[0];
      return `>${leading}{{ ${buildTranslateCallSource("t", trimmed)} }}${trailing}<`;
    },
  );

  return {
    changed: replacements > 0,
    replacements,
    code,
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
    return { changed: false, replacements: 0, code: source };
  }

  let code = applyPatches(source, patches);

  if (!options.vueComponent && needsTranslateImport(code)) {
    code = injectTranslateImport(code);
  }

  return {
    changed: true,
    replacements: patches.length,
    code,
  };
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
  } catch (error) {
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
          code: generate(callExpr, { jsescOption: { minimal: true } }).code,
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
 * @param {string} source - 源码
 * @returns {string} 注入后的源码
 */
function injectTranslateImport(source) {
  if (
    source.includes('from "@/languages"') ||
    source.includes("from '@/languages'")
  )
    return source;

  const importStatement = 'import { t } from "@/languages";\n';
  const importMatches = [...source.matchAll(/^import .+;$/gm)];
  if (importMatches.length === 0) return `${importStatement}${source}`;

  const lastImport = importMatches[importMatches.length - 1];
  const insertIndex = lastImport.index + lastImport[0].length + 1;
  return `${source.slice(0, insertIndex)}${importStatement}${source.slice(insertIndex)}`;
}

/**
 * 判断源码是否需要注入 t 的 import
 * @param {string} source - 源码
 * @returns {boolean} 是否需要注入
 */
function needsTranslateImport(source) {
  return /\bt\(/.test(source) && !/from ["']@\/languages["']/.test(source);
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

module.exports = {
  applyI18n,
};
