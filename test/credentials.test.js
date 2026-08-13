const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { loadCredentials, saveCredentials, clearCredentials, getCredentialsFile } = require("../src/credentials");

const TMP_HOME = path.join(os.tmpdir(), "i18n-cred-test-" + Date.now());

before(() => {
  process.env.HOME = TMP_HOME;
  process.env.USERPROFILE = TMP_HOME;
});

after(() => {
  if (fs.existsSync(TMP_HOME)) {
    fs.rmSync(TMP_HOME, { recursive: true, force: true });
  }
});

test("saveCredentials 写入文件", () => {
  saveCredentials({
    apiKey: "sk-test-123",
    baseUrl: "http://example.com/v1",
    model: "test-model",
  });

  const credPath = getCredentialsFile();
  assert.ok(fs.existsSync(credPath));

  const stored = JSON.parse(fs.readFileSync(credPath, "utf8"));
  assert.strictEqual(stored.apiKey, "sk-test-123");
  assert.strictEqual(stored.baseUrl, "http://example.com/v1");
  assert.strictEqual(stored.model, "test-model");
});

test("loadCredentials 读取已保存的凭证", () => {
  saveCredentials({
    apiKey: "sk-load-test",
    baseUrl: "http://load.example.com/v1",
    model: "load-model",
  });

  const creds = loadCredentials();
  assert.ok(creds);
  assert.strictEqual(creds.apiKey, "sk-load-test");
});

test("loadCredentials 文件不存在时返回 null", () => {
  clearCredentials();
  const creds = loadCredentials();
  assert.strictEqual(creds, null);
});

test("clearCredentials 删除凭证文件", () => {
  saveCredentials({ apiKey: "sk-del", baseUrl: "", model: "" });
  const credPath = getCredentialsFile();
  assert.ok(fs.existsSync(credPath));

  clearCredentials();
  assert.ok(!fs.existsSync(credPath));
});

test("clearCredentials 文件不存在时不报错", () => {
  clearCredentials();
  // 不抛异常即通过
});

test("loadCredentials 损坏文件返回 null", () => {
  const credDir = path.join(TMP_HOME, ".kd-i18n");
  fs.mkdirSync(credDir, { recursive: true });
  fs.writeFileSync(
    path.join(credDir, "credentials.json"),
    "not valid json{{{",
    "utf8",
  );

  const creds = loadCredentials();
  assert.strictEqual(creds, null);
});

test("saveCredentials 覆盖更新已存在的凭证", () => {
  saveCredentials({ apiKey: "sk-old", baseUrl: "http://old/v1", model: "old" });
  saveCredentials({ apiKey: "sk-new", baseUrl: "http://new/v1", model: "new" });

  const creds = loadCredentials();
  assert.strictEqual(creds.apiKey, "sk-new");
  assert.strictEqual(creds.baseUrl, "http://new/v1");
  assert.strictEqual(creds.model, "new");
});
