const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * 创建临时项目并写入 default.json
 * @param {object} translations - 翻译内容
 * @returns {string} 临时目录路径
 */
function createTempProject(translations = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-translate-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test" }),
  );
  const transPath = path.join(dir, "src/languages/translates/default.json");
  fs.mkdirSync(path.dirname(transPath), { recursive: true });
  fs.writeFileSync(transPath, JSON.stringify(translations, null, 2));
  return dir;
}

const CONFIG = {
  languages: ["zh", "en", "jp", "ar"],
  translationFile: "src/languages/translates/default.json",
  preset: "keendata-vue2-voerkai",
  translate: {
    provider: "glossary",
    useGlossaryFallback: true,
    useGlossaryPostProcess: true,
    strictPlaceholders: true,
  },
};

test("glossary provider 填充已知术语", async () => {
  const projectRoot = createTempProject({
    保存: { en: "", jp: "", ar: "" },
    未知文本: { en: "", jp: "", ar: "" },
  });

  const { translateTranslations } = require("../src/kit/translate");
  const result = await translateTranslations(projectRoot, CONFIG, {
    provider: "glossary",
  });

  const translations = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, "src/languages/translates/default.json"),
      "utf8",
    ),
  );

  assert.ok(translations["保存"].en === "Save", "保存应被翻译为 Save");
  assert.ok(translations["未知文本"].en === "", "未知文本应保持为空");
});

test("LLM_API_KEY 未设置时回退 glossary", async () => {
  const projectRoot = createTempProject({
    测试: { en: "", jp: "", ar: "" },
  });

  const oldKey = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;

  const { translateTranslations } = require("../src/kit/translate");
  const result = await translateTranslations(
    projectRoot,
    { ...CONFIG, translate: { ...CONFIG.translate, provider: "llm" } },
    {},
  );

  assert.ok(result.provider.used === "glossary", "应回退到 glossary");

  if (oldKey) process.env.LLM_API_KEY = oldKey;
});

test("占位符校验检测不匹配", async () => {
  const projectRoot = createTempProject({
    "操作{}失败": { en: "Operation failed", jp: "", ar: "" },
  });

  const { translateTranslations } = require("../src/kit/translate");
  const result = await translateTranslations(projectRoot, CONFIG, {
    provider: "glossary",
  });

  assert.ok(
    result.issues.some(
      (m) => m.key === "操作{}失败" && m.type === "placeholder",
    ),
    "应检测到占位符不匹配",
  );
});

test("源位置占位符 {} 翻译使用命名占位符 {variable} 视为兼容", () => {
  const { isPlaceholderCompatible } = require("../src/kit/validate");

  // 源 {} 翻译 {variable} — 数量一致即兼容
  assert.ok(
    isPlaceholderCompatible(["{}"], ["{variable}"], {
      strictPlaceholders: true,
    }),
    "源 {} 翻译 {variable} 应兼容",
  );
  assert.ok(
    isPlaceholderCompatible(["{}", "{}"], ["{a}", "{b}"], {
      strictPlaceholders: true,
    }),
    "多个位置占位符翻译为命名占位符应兼容",
  );
});

test("源命名占位符翻译使用不同命名占位符视为不兼容", () => {
  const { isPlaceholderCompatible } = require("../src/kit/validate");

  // 源 {name} 翻译 {variable} — strict 模式下不兼容
  assert.ok(
    !isPlaceholderCompatible(["{name}"], ["{variable}"], {
      strictPlaceholders: true,
    }),
    "源 {name} 翻译 {variable} 在 strict 模式下应不兼容",
  );
});

test("占位符数量不匹配视为不兼容", () => {
  const { isPlaceholderCompatible } = require("../src/kit/validate");

  assert.ok(
    !isPlaceholderCompatible(["{}"], ["{}", "{}"], {
      strictPlaceholders: false,
    }),
    "数量不一致应不兼容",
  );
  assert.ok(
    !isPlaceholderCompatible(["{}", "{}"], ["{a}"], {
      strictPlaceholders: true,
    }),
    "数量不一致应不兼容",
  );
});

test("字面量保留检查检测系统变量被替换", () => {
  const {
    extractLiterals,
    checkLiteralPreservation,
  } = require("../src/kit/validate");

  const source = "参数值为${#date(0,0,0):yyyyMMdd#}代表调度日期";
  const literals = extractLiterals(source);
  assert.ok(literals.length === 1, "应提取出 1 个字面量");
  assert.ok(literals[0] === "${#date(0,0,0):yyyyMMdd#}", "字面量内容应正确");

  const arText = "قيمة المعلمة $ { valiable } يمثل تاريخ الجدولة";
  const missing = checkLiteralPreservation(literals, arText);
  assert.ok(missing.length === 1, "应检测到字面量未被保留");

  const enText =
    "The parm value of ${#date(0,0,0):yyyyMMdd#} represents scheduling date";
  const missingEn = checkLiteralPreservation(literals, enText);
  assert.ok(missingEn.length === 0, "英语翻译保留了系统变量，不应报错");
});

test("voerkai18n 占位符正则不匹配系统变量", () => {
  const { extractPlaceholders } = require("../src/kit/validate");

  const source1 = "参数值为${#date(0,0,0):yyyyMMdd#}代表调度日期";
  assert.ok(extractPlaceholders(source1).length === 0, "${#...#} 不应是占位符");

  const source2 = "密码长度太短，至少需 {} 个字符";
  assert.ok(extractPlaceholders(source2).length === 1, "{} 应被提取为占位符");

  const source3 = "{envTypeName}连接失败：{failureReason}";
  assert.ok(
    extractPlaceholders(source3).length === 2,
    "{name} 应被提取为占位符",
  );
});

test("源文残留检查检测未翻译中文", () => {
  const { checkSourceTextLeakage } = require("../src/kit/validate");

  const leaked = checkSourceTextLeakage("删除数据后不可恢复", "en");
  assert.ok(leaked !== null, "英语翻译中的中文应被检测");

  const clean = checkSourceTextLeakage("Data deleted", "en");
  assert.ok(clean === null, "正常英语翻译不应报错");

  const jpText = checkSourceTextLeakage("データを削除後", "jp");
  assert.ok(jpText === null, "日文翻译不应检查源文残留");

  const withSysVar = checkSourceTextLeakage(
    "Enter ${#project.参数名称#} to reference",
    "en",
  );
  assert.ok(withSysVar === null, "系统变量内的中文不应误报");
});

test("占位式无效翻译被 validate 检测为问题", () => {
  const { validateTranslationObject } = require("../src/kit/validate");
  const config = { languages: ["zh", "en", "jp", "ar"] };
  const translations = {
    只读: { en: "Text 1", jp: "テキスト 1", ar: "نص 1" },
    用户: { en: "User", jp: "ユーザー", ar: "المستخدم" },
  };
  const report = validateTranslationObject(translations, config);
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.issues.length, 3);
  assert.strictEqual(report.issues[0].type, "placeholder_translation");
});

test("isPlaceholderTranslation 检测多种语言的占位式翻译", () => {
  const { isPlaceholderTranslation } = require("../src/kit/validate");
  assert.strictEqual(isPlaceholderTranslation("Text 1"), true);
  assert.strictEqual(isPlaceholderTranslation("テキスト 1"), true);
  assert.strictEqual(isPlaceholderTranslation("نص 1"), true);
  assert.strictEqual(isPlaceholderTranslation("Read Only"), false);
  assert.strictEqual(isPlaceholderTranslation("Delete succeeded"), false);
  assert.strictEqual(isPlaceholderTranslation(""), false);
});

// ===== fixIdMapKeys 测试 =====

const { fixIdMapKeys } = require("../src/kit/validate");

function createIdMapProject(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-idmap-"));
  const idMapPath = path.join(dir, "src/languages/idMap.js");
  fs.mkdirSync(path.dirname(idMapPath), { recursive: true });
  fs.writeFileSync(idMapPath, content, "utf8");
  return dir;
}

test("fixIdMapKeys 引号包裹未加引号的中文 key", () => {
  const dir = createIdMapProject(
    'export default {\n  只读: 1,\n  读写: 2,\n  "正常key": 3,\n};\n',
  );
  const result = fixIdMapKeys(dir);
  const content = fs.readFileSync(
    path.join(dir, "src/languages/idMap.js"),
    "utf8",
  );
  assert.ok(result.fixed, "应报告已修复");
  assert.ok(content.includes('"只读"'), "只读 应被引号包裹");
  assert.ok(content.includes('"读写"'), "读写 应被引号包裹");
  assert.ok(content.includes('"正常key"'), "已加引号的 key 应保持不变");
});

test("fixIdMapKeys 保留原有换行结构", () => {
  const dir = createIdMapProject(
    'export default {\n  只读: 1,\n  读写: 2,\n  最大重连次数: 1033,\n};\n',
  );
  fixIdMapKeys(dir);
  const content = fs.readFileSync(
    path.join(dir, "src/languages/idMap.js"),
    "utf8",
  );
  // 每个 key 应在单独的行上（不被合并为一行）
  assert.ok(content.includes('\n  "只读"'), "只读 应保留在独立行上");
  assert.ok(content.includes('\n  "读写"'), "读写 应保留在独立行上");
  assert.ok(content.includes('\n  "最大重连次数"'), "最大重连次数 应保留在独立行上");
});

test("fixIdMapKeys 保留 key 中合法的空格（不 trim）", () => {
  const dir = createIdMapProject(
    'export default {\n  "只读": 1,\n  "只读 ": 65,\n  "正常key": 3,\n};\n',
  );
  fixIdMapKeys(dir);
  const content = fs.readFileSync(
    path.join(dir, "src/languages/idMap.js"),
    "utf8",
  );
  // "只读" 和 "只读 " 是两个不同的 key，不应被合并
  assert.ok(content.includes('"只读"'), "只读 应保持不变");
  assert.ok(content.includes('"只读 "'), "只读 (带空格) 应保持不变，不被 trim");
});

test("fixIdMapKeys 保留值中间的空格", () => {
  const dir = createIdMapProject(
    'export default {\n  "含 空格的 正常key": 1,\n};\n',
  );
  fixIdMapKeys(dir);
  const content = fs.readFileSync(
    path.join(dir, "src/languages/idMap.js"),
    "utf8",
  );
  assert.ok(
    content.includes('"含 空格的 正常key"'),
    "值中间的空格应保留",
  );
});

test("fixIdMapKeys 移除尾部分号和逗号", () => {
  const dir = createIdMapProject(
    'export default {\n  "key": 1,\n};\n',
  );
  fixIdMapKeys(dir);
  const content = fs.readFileSync(
    path.join(dir, "src/languages/idMap.js"),
    "utf8",
  );
  assert.ok(!content.match(/}\s*;/), "不应有尾部分号");
});

test("fixIdMapKeys 幂等：重复执行不产生变化", () => {
  const dir = createIdMapProject(
    'export default {\n  只读: 1,\n  "正常key": 2,\n};\n',
  );
  fixIdMapKeys(dir);
  const afterFirst = fs.readFileSync(
    path.join(dir, "src/languages/idMap.js"),
    "utf8",
  );
  const result = fixIdMapKeys(dir);
  const afterSecond = fs.readFileSync(
    path.join(dir, "src/languages/idMap.js"),
    "utf8",
  );
  assert.ok(!result.fixed, "第二次执行应报告未修复");
  assert.strictEqual(afterFirst, afterSecond, "内容不应变化");
});

test("fixIdMapKeys 混合场景：未加引号 + 带空格 + 正常 key", () => {
  const dir = createIdMapProject(
    'export default {\n  只读: 1,\n  "读写 ": 2,\n  最大重连次数: 3,\n  "正常key": 4,\n  "含 空格的 key": 5,\n};\n',
  );
  fixIdMapKeys(dir);
  const content = fs.readFileSync(
    path.join(dir, "src/languages/idMap.js"),
    "utf8",
  );
  assert.ok(content.includes('"只读"'), "未加引号的 key 应被包裹");
  assert.ok(content.includes('"读写 "'), "带尾随空格的 key 应保持不变（不 trim）");
  assert.ok(content.includes('"最大重连次数"'), "另一个未加引号的 key 应被包裹");
  assert.ok(content.includes('"正常key"'), "正常 key 应保持不变");
  assert.ok(content.includes('"含 空格的 key"'), "中间空格应保留");
});

// ===== ensurePrettierIgnore 测试 =====

const { ensurePrettierIgnore } = require("../src/kit/validate");

function createIgnoreProject(generatedFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-prettier-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test" }),
  );
  return { dir, config: { generatedFiles } };
}

test("ensurePrettierIgnore 创建 .prettierignore 并写入生成文件", () => {
  const { dir, config } = createIgnoreProject([
    "src/languages/idMap.js",
    "src/languages/zh.js",
  ]);
  const result = ensurePrettierIgnore(dir, config);
  const content = fs.readFileSync(path.join(dir, ".prettierignore"), "utf8");
  assert.ok(result.updated, "应报告已更新");
  assert.ok(content.includes("src/languages/idMap.js"), "应包含 idMap.js");
  assert.ok(content.includes("src/languages/zh.js"), "应包含 zh.js");
});

test("ensurePrettierIgnore 幂等：已存在时不重复追加", () => {
  const { dir, config } = createIgnoreProject(["src/languages/idMap.js"]);
  ensurePrettierIgnore(dir, config);
  const result2 = ensurePrettierIgnore(dir, config);
  assert.ok(!result2.updated, "第二次应报告未更新");
});

test("ensurePrettierIgnore 追加到已有 .prettierignore", () => {
  const { dir, config } = createIgnoreProject(["src/languages/idMap.js"]);
  fs.writeFileSync(path.join(dir, ".prettierignore"), "node_modules\n", "utf8");
  const result = ensurePrettierIgnore(dir, config);
  const content = fs.readFileSync(path.join(dir, ".prettierignore"), "utf8");
  assert.ok(result.updated, "应报告已更新");
  assert.ok(content.includes("node_modules"), "应保留原有内容");
  assert.ok(content.includes("src/languages/idMap.js"), "应追加 idMap.js");
});
