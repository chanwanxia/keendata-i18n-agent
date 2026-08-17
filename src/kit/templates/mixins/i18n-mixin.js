// i18nMixin 是 @voerkai18n/vue2 的 mixin，用于处理国际化
// 包含 activeLanguage-当前语言计算属性、changeLanguage-切换语言方法、languages-语言列表计算属性
import { i18nMixin as voerkai18nMixin } from "@voerkai18n/vue2";

export const i18nMixin = {
  mixins: [voerkai18nMixin()],
  provide() {
    return {
      htmlDir: this.htmlDir,
    };
  },
  mounted() {
    document.documentElement.setAttribute("dir", this.htmlDirection);
  },
  watch: {
    htmlDirection(dir) {
      document.documentElement.setAttribute("dir", dir);
    },
  },
  computed: {
    isRtl() {
      const lang = this.activeLanguage || localStorage.getItem("language") || "zh";
      return ["ar"].includes(lang);
    },
    htmlDirection() {
      return this.isRtl ? "rtl" : "ltr";
    },
    isZh() {
      return this.activeLanguage === "zh";
    },
  },
  methods: {
    languageChange(language) {
      this.changeLanguage(language);
      document.documentElement.setAttribute("dir", this.htmlDirection);
      localStorage.setItem("language", language);
      location.reload();
    },

    // 适用于el-table-column的width、el-form的label-width的宽度配置
    getI18nWidth(widthConfig) {
      let widths;
      if (typeof widthConfig === "string") {
        widths = widthConfig.split(",").map((val) => {
          return typeof parseInt(val) === "number" && !isNaN(parseInt(val)) ? `${ parseInt(val) }px` : val;
        });
      } else if (typeof widthConfig === "object") {
        widths = {};
        for (const [key, val] of Object.entries(widthConfig)) {
          widths[key] = typeof parseInt(val) === "number" && !isNaN(parseInt(val)) ? `${ parseInt(val) }px` : val;
        }
      }
      const lang = this.activeLanguage;
      let width;

      if (typeof widths === "object" && !Array.isArray(widths)) {
        width = widths[lang] || widths["zh"] || "auto";
      } else {
        switch (lang) {
          case "zh":
            width = widths[0] || "auto";
            break;
          case "en":
            width = widths[1] || widths[0] || "auto";
            break;
          case "jp":
            width = widths[2] || widths[0] || "auto";
            break;
          default:
            width = widths[0] || "auto";
        }
      }
      return width;
    },

    // "中文名称"接入配置
    displayNameConfig(config) {
      const c = Object.assign(
        {},
        {
          chLabel: "中文名称",
          otherLabel: this.t("显示名称"),
          chPlaceholder: "请输入中文名称",
          otherPlaceholder: this.t("请输入显示名称"),
          chTip: "请输入中文名称",
          otherTip: this.t("请输入显示名称"),
          required: false,
          debug: false,
        },
        config,
      );
      const obj = {
        isZh: this.isZh,
        label: this.isZh ? c.chLabel : c.otherLabel,
        placeholder: this.isZh ? c.chPlaceholder : c.otherPlaceholder,
        rules: [],
      };
      if (c.required) {
        if (this.isZh) {
          obj.rules = [this.mBlurRequired(c.chTip), this.mValidateChinese()];
        } else {
          obj.rules = [this.mBlurRequired(c.otherTip)];
        }
      }
      return obj;
    },
    displayNameLabel(chLabel = "中文名称", otherLabel = this.t("显示名称")) {
      if (this.isZh) {
        return chLabel;
      } else {
        return otherLabel;
      }
    },
  },
};
