const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  checkDependencies,
  checkKdComponentsVersion,
} = require("../src/kit/doctor");

/**
 * 创建包含 package.json 的临时项目
 * @param {object} packageJson - package.json 内容
 * @returns {string} 临时项目路径
 */
function createTempProject(packageJson) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-doctor-"));
  fs.writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify(packageJson),
  );
  return projectRoot;
}

test("checkKdComponentsVersion 要求 5.2.2 及以上版本", () => {
  const oldProject = createTempProject({
    dependencies: { "@kd/components": "^5.2.1" },
  });
  const currentProject = createTempProject({
    dependencies: { "@kd/components": "^5.2.2" },
  });
  const nextPatchProject = createTempProject({
    dependencies: { "@kd/components": "^5.3.0" },
  });

  assert.strictEqual(checkKdComponentsVersion(oldProject).status, "fail");
  assert.strictEqual(checkKdComponentsVersion(currentProject).status, "pass");
  assert.strictEqual(checkKdComponentsVersion(nextPatchProject).status, "pass");
});

test("checkDependencies 缺少 @kd/components 时给出自动安装建议", () => {
  const projectRoot = createTempProject({
    dependencies: {
      "@voerkai18n/runtime": "^2.1.13",
      "@voerkai18n/vue2": "^2.1.13",
    },
    devDependencies: {
      "@voerkai18n/cli": "^2.1.13",
      "voerkai18n-loader": "^2.1.13",
      "postcss-rtlcss": "^6.0.0",
    },
  });

  const result = checkDependencies(projectRoot);

  assert.strictEqual(result.status, "fail");
  assert.match(result.suggestion, /@kd\/components@\^5\.2\.2 --save-prod/);
});
