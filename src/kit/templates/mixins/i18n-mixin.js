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

    // 根据操作栏按钮文案自动计算 kd-column-action 宽度
    getActionColumnWidth(btnList = []) {
      const buttons = Array.isArray(btnList) ? btnList : [];
      const font = "12px PingFang SC, Microsoft YaHei, Arial, sans-serif";
      const buttonGap = 8;
      const cellPadding = 32;
      const dropdownIconWidth = 24;
      const fallbackLabelWidth = 48;
      const safetyWidth = 12;
      let contentWidth = 0;
      let visibleCount = 0;
      let hasDropdown = false;

      buttons.forEach((item) => {
        if (!item || item.show === false) return;
        if (item.dropdown) {
          hasDropdown = true;
          return;
        }
        contentWidth += this.measureActionColumnTextWidth(
          this.getActionColumnLabel(item),
          font,
          fallbackLabelWidth,
        );
        visibleCount += 1;
      });

      if (hasDropdown) {
        contentWidth += dropdownIconWidth;
        visibleCount += 1;
      }

      const gapWidth = Math.max(visibleCount - 1, 0) * buttonGap;
      const width = Math.ceil(contentWidth + gapWidth + cellPadding + safetyWidth);
      return `${ width }px`;
    },

    // 获取操作栏按钮用于宽度测量的文案，函数型 label 无法安全取值时使用兜底宽度
    getActionColumnLabel(item) {
      if (item.autoWidthLabel) return item.autoWidthLabel;
      if (typeof item.label !== "function") return item.label || "";
      try {
        return item.label(null, item) || "";
      } catch (error) {
        return "";
      }
    },

    // 使用 canvas 测量操作栏按钮文案宽度，非浏览器环境或空文案使用兜底宽度
    measureActionColumnTextWidth(label, font, fallbackWidth) {
      const text = String(label || "");
      if (!text) return fallbackWidth;
      if (typeof document === "undefined") return text.length * 12;
      if (!this.__actionColumnMeasureCanvas) {
        this.__actionColumnMeasureCanvas = document.createElement("canvas");
      }
      const context = this.__actionColumnMeasureCanvas.getContext("2d");
      if (!context) return fallbackWidth;
      context.font = font;
      return Math.ceil(context.measureText(text).width);
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
          rules: [],
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
      if (Array.isArray(c.rules) && c.rules.length > 0) {
        obj.rules = obj.rules.concat(c.rules);
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
