#!/usr/bin/env node
/**
 * LLM 接口连通性测试脚本
 * 验证 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL 配置是否正常工作
 * 用法: node scripts/test-llm.js
 */
const { OpenAI } = require("openai");

const apiKey = "sk-a6778cf4b0b3d68418d7a335a470846feefd922c356a9ab986873daf572c8b79";
const baseUrl =
  process.env.LLM_BASE_URL || "http://router.keendata.net:5343/v1";
const model = "gpt-5.5";

console.log("=== LLM 接口连通性测试 ===");
console.log(`Base URL: ${baseUrl}`);
console.log(`Model:    ${model}`);
console.log(`API Key:  ${apiKey ? "***" + apiKey.slice(-4) : "(未设置)"}`);
console.log();

if (!apiKey) {
  console.error("FAIL: LLM_API_KEY 环境变量未设置");
  process.exit(1);
}

const client = new OpenAI({ baseURL: baseUrl, apiKey });

/**
 * 测试 chat completions 基础调用
 * @returns {Promise<boolean>} 是否成功
 */
async function testChat() {
  console.log("[1/2] 测试 chat completions 基础调用...");
  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: "你是一个测试助手，只返回 JSON。" },
        { role: "user", content: '请返回 {"status":"ok"}' },
      ],
    });
    const content = response.choices?.[0]?.message?.content || "(空)";
    console.log(`  响应: ${content}`);
    console.log("  PASS\n");
  } catch (error) {
    console.error(`  FAIL: ${error.message}`);
    if (error.status) console.error(`  HTTP 状态码: ${error.status}`);
    return false;
  }
  return true;
}

/**
 * 测试翻译功能（json_object 响应格式）
 * @returns {Promise<boolean>} 是否成功
 */
async function testTranslation() {
  console.log("[2/2] 测试翻译功能（json_object 响应格式）...");
  const systemMessage = [
    "你是翻译引擎。将中文翻译为指定语言，保持 {} 占位符不变。只返回 JSON。",
    '返回格式: { "translations": [{ "source": "中文", "en": "English", "jp": "日本語", "ar": "العربية" }] }',
  ].join("\n");

  const userMessage = JSON.stringify({
    targetLanguages: ["en", "jp", "ar"],
    texts: ["删除成功", "已选{}列表", "星际穿越"],
  });

  try {
    const response = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage },
      ],
    });

    const content = response.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    const translations = parsed.translations || [];

    if (translations.length === 0) {
      console.error("  FAIL: 返回的 translations 数组为空");
      return false;
    }

    console.log("  翻译结果:");
    translations.forEach((item) => {
      console.log(
        `    ${item.source} -> en: ${item.en}, jp: ${item.jp}, ar: ${item.ar}`,
      );
    });

    // 检查是否为占位式无效翻译
    const placeholderRegex = /^(Text|テキスト|نص)\s*\d+/i;
    const hasPlaceholder = translations.some((item) =>
      ["en", "jp", "ar"].some(
        (lang) => item[lang] && placeholderRegex.test(item[lang].trim()),
      ),
    );
    if (hasPlaceholder) {
      console.error(
        "  WARN: 检测到占位式翻译（如 Text 123），模型可能未正确理解指令",
      );
    }

    console.log("  PASS\n");
  } catch (error) {
    console.error(`  FAIL: ${error.message}`);
    if (error.status) console.error(`  HTTP 状态码: ${error.status}`);
    return false;
  }
  return true;
}

async function main() {
  const chatOk = await testChat();
  if (!chatOk) {
    console.error("\n基础调用失败，跳过翻译测试。");
    process.exit(1);
  }

  const translateOk = await testTranslation();
  if (!translateOk) {
    console.error("\n翻译测试失败。");
    process.exit(1);
  }

  console.log("=== 全部测试通过 ===");
}

main().catch((err) => {
  console.error(`未捕获异常: ${err.message}`);
  process.exit(1);
});
