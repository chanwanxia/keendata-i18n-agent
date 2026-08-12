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

test("OPENAI_API_KEY 未设置时回退 glossary", async () => {
  const projectRoot = createTempProject({
    测试: { en: "", jp: "", ar: "" },
  });

  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const { translateTranslations } = require("../src/kit/translate");
  const result = await translateTranslations(
    projectRoot,
    { ...CONFIG, translate: { ...CONFIG.translate, provider: "llm" } },
    {},
  );

  assert.ok(result.provider.used === "glossary", "应回退到 glossary");

  if (oldKey) process.env.OPENAI_API_KEY = oldKey;
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
