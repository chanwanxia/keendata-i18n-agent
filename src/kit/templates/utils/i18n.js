import { i18nScope, t } from "@/languages";

/**
 * 获取"中文名称"标签（非组件场景使用，组件内请使用 this.displayNameLabel）
 * 中文环境返回 chLabel，其他语言环境返回 otherLabel
 * @param {string} chLabel - 中文标签，默认"中文名称"
 * @param {string} otherLabel - 其他语言标签，默认 t("显示名称")
 * @returns {string} 当前语言对应的标签
 */
export function displayNameLabel(chLabel = "中文名称", otherLabel = t("显示名称")) {
  const activeLanguage = i18nScope.activeLanguage;
  const isZh = activeLanguage === "zh";
  if (isZh) {
    return chLabel;
  } else {
    return otherLabel;
  }
}
