const { test } = require("node:test");
const assert = require("node:assert");

const { resolveLlmMaxRetries } = require("../src/llm");
const { resolveLlmBatchConcurrency } = require("../src/kit/translate");

test("resolveLlmMaxRetries 默认降低 SDK 自动重试次数", () => {
  const oldValue = process.env.LLM_MAX_RETRIES;
  delete process.env.LLM_MAX_RETRIES;

  assert.strictEqual(resolveLlmMaxRetries(), 1);

  if (oldValue === undefined) {
    delete process.env.LLM_MAX_RETRIES;
  } else {
    process.env.LLM_MAX_RETRIES = oldValue;
  }
});

test("resolveLlmMaxRetries 支持环境变量覆盖", () => {
  const oldValue = process.env.LLM_MAX_RETRIES;
  process.env.LLM_MAX_RETRIES = "0";

  assert.strictEqual(resolveLlmMaxRetries(), 0);

  if (oldValue === undefined) {
    delete process.env.LLM_MAX_RETRIES;
  } else {
    process.env.LLM_MAX_RETRIES = oldValue;
  }
});

test("resolveLlmBatchConcurrency 默认串行处理翻译批次", () => {
  const oldValue = process.env.LLM_BATCH_CONCURRENCY;
  delete process.env.LLM_BATCH_CONCURRENCY;

  assert.strictEqual(resolveLlmBatchConcurrency(), 1);

  if (oldValue === undefined) {
    delete process.env.LLM_BATCH_CONCURRENCY;
  } else {
    process.env.LLM_BATCH_CONCURRENCY = oldValue;
  }
});

test("resolveLlmBatchConcurrency 忽略非法并发配置", () => {
  const oldValue = process.env.LLM_BATCH_CONCURRENCY;
  process.env.LLM_BATCH_CONCURRENCY = "0";

  assert.strictEqual(resolveLlmBatchConcurrency(), 1);

  if (oldValue === undefined) {
    delete process.env.LLM_BATCH_CONCURRENCY;
  } else {
    process.env.LLM_BATCH_CONCURRENCY = oldValue;
  }
});
