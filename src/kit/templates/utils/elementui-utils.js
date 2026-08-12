import Vue from "vue";
import ElementUI from "element-ui";
import VueI18n from "vue-i18n";
import zh from "element-ui/lib/locale/lang/zh-CN";
import en from "element-ui/lib/locale/lang/en";
import ja from "element-ui/lib/locale/lang/ja";
import ar from "element-ui/lib/locale/lang/ar";
import KdZhCn from "@kd/components/dist/locale/lang/zh-cn";
import KdEn from "@kd/components/dist/locale/lang/en";
import KdJa from "@kd/components/dist/locale/lang/ja";
import KdAr from "@kd/components/dist/locale/lang/ar";

ElementUI.Form.props.labelWidth = { default: "auto" };
ElementUI.TableColumn.props.showOverflowTooltip = { default: true };

Vue.use(VueI18n);

const getLanguage = () => {
  let language = localStorage.getItem("language");
  if (!language) {
    localStorage.setItem("language", "zh");
    language = "zh";
  }
  switch (language) {
    case "jp":
      return "ja";
    case "en":
      return "en";
    case "ar":
      return "ar";
    default:
      return "zh";
  }
};

export const i18n = new VueI18n({
  locale: getLanguage(),
  messages: {
    en: {
      ...en,
      ...KdEn,
    },
    zh: {
      ...zh,
      ...KdZhCn,
    },
    ja: {
      ...ja,
      ...KdJa,
    },
    ar: {
      ...ar,
      ...KdAr,
    },
  },
});

Vue.use(ElementUI, {
  size: "small",
  i18n: (key, value) => i18n.t(key, value),
});
