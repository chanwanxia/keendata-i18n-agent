const { test } = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { runShellCommandCaptured } = require("../src/kit/shell");

test("捕获成功命令的 stdout", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-shell-"));
  const result = runShellCommandCaptured(
    "echo hello_world",
    dir,
    "test",
  );
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("hello_world"));
  assert.strictEqual(result.stderr, "");
});

test("捕获失败命令的 stderr 和非零退出码", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-shell-"));
  const result = runShellCommandCaptured(
    "nonexistent_command_xyz",
    dir,
    "test",
  );
  assert.strictEqual(result.status, 1);
  assert.ok(result.stderr.length > 0);
});

test("多行 stdout 完整捕获", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-shell-"));
  const result = runShellCommandCaptured(
    'printf "line1\\nline2\\nline3"',
    dir,
    "test",
  );
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("line1"));
  assert.ok(result.stdout.includes("line3"));
});

test("环境变量正确传递", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-shell-"));
  const result = runShellCommandCaptured(
    'echo $TEST_VAR',
    dir,
    "test",
    { env: { TEST_VAR: "env_value_123" } },
  );
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("env_value_123"));
});
