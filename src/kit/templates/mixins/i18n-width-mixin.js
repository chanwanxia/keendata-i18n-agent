import { i18nScope } from "@/languages";

export const i18nWidthMixin = {
  methods: {
    // 适用于el-table-column的width、el-form的label-width的宽度配置
    getI18nWidth(widthConfig) {
      let widths;
      if (typeof widthConfig === "string") {
        widths = widthConfig.split(",").map((val) => {
          return typeof parseInt(val) === "number" && !isNaN(parseInt(val)) ? `${parseInt(val)}px` : val;
        });
      } else if (typeof widthConfig === "object") {
        widths = {};
        for (const [key, val] of Object.entries(widthConfig)) {
          widths[key] = typeof parseInt(val) === "number" && !isNaN(parseInt(val)) ? `${parseInt(val)}px` : val;
        }
      }
      const lang = i18nScope.activeLanguage;
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
          case "ar":
            width = widths[3] || widths[0] || "auto";
            break;
          default:
            width = widths[0] || "auto";
        }
      }
      return width;
    },
  },
};
