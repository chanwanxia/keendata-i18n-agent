const PRESET_ID = "keendata-vue2-voerkai";

const preset = {
  id: PRESET_ID,
  title: "KeenData Vue2 + VoerkaI18n",
  rules: {
    projectType: "vue2-spa",
    translation: {
      sourceLanguage: "zh",
      languages: ["zh", "en", "jp", "ar"],
      storageKey: "language",
      runtimeModule: "@/languages",
      translateFunctions: ["t", "this.t"],
      businessTextDisallow: ["$t"],
      placeholderStyle: "{}",
      translationFile: "src/languages/translates/default.json",
      generatedFiles: [
        "src/languages/index.js",
        "src/languages/idMap.js",
        "src/languages/storage.js",
        "src/languages/zh.js",
        "src/languages/en.js",
        "src/languages/jp.js",
        "src/languages/ar.js",
      ],
      compileGeneratedImmutable: true,
      glossary: {
        "租户": {
          en: "Tenant",
          jp: "テナント",
          ar: "المستأجر"
        },
        "项目": {
          en: "Project",
          jp: "プロジェクト",
          ar: "المشروع"
        },
        "用户": {
          en: "User",
          jp: "ユーザー",
          ar: "المستخدم"
        },
        "管理员": {
          en: "Administrator",
          jp: "管理者",
          ar: "المسؤول"
        },
        "数据": {
          en: "Data",
          jp: "データ",
          ar: "البيانات"
        },
        "保存": {
          en: "Save",
          jp: "保存",
          ar: "حفظ"
        },
        "保存成功": {
          en: "Save succeeded",
          jp: "保存成功",
          ar: "تم الحفظ بنجاح"
        },
        "删除": {
          en: "Delete",
          jp: "削除",
          ar: "حذف"
        },
        "删除成功": {
          en: "Delete succeeded",
          jp: "削除成功",
          ar: "تم الحذف بنجاح"
        },
        "删除{}成功": {
          en: "Delete {} succeeded",
          jp: "{}を削除しました",
          ar: "تم حذف {} بنجاح"
        },
        "编辑": {
          en: "Edit",
          jp: "編集",
          ar: "تحرير"
        },
        "新建": {
          en: "Create",
          jp: "新規作成",
          ar: "إنشاء"
        },
        "搜索": {
          en: "Search",
          jp: "検索",
          ar: "بحث"
        },
        "登录名": {
          en: "Login Name",
          jp: "ログイン名",
          ar: "اسم تسجيل الدخول"
        },
        "请输入名称": {
          en: "Please enter a name",
          jp: "名前を入力してください",
          ar: "يرجى إدخال الاسم"
        },
        "用户名称": {
          en: "User Name",
          jp: "ユーザー名",
          ar: "اسم المستخدم"
        },
        "编辑用户": {
          en: "Edit User",
          jp: "ユーザーを編集",
          ar: "تحرير المستخدم"
        },
        "租户管理": {
          en: "Tenant Management",
          jp: "テナント管理",
          ar: "إدارة المستأجر"
        }
      }
    },
    bootstrap: {
      mainFile: "src/main.js",
      pluginPackage: "@voerkai18n/vue2",
      pluginSymbol: "i18nPlugin",
      scopeImport: "@/languages",
      scopeSymbol: "i18nScope",
      widthMixinImport: "@/mixins/i18n-width-mixin",
      widthMixinSymbol: "i18nWidthMixin",
      styleImports: ["@/styles/i18n-style.scss"],
      componentLocaleFile: "src/utils/elementui-utils.js",
    },
    componentLocale: {
      provider: "vue-i18n",
      file: "src/utils/elementui-utils.js",
      uiLibraries: ["element-ui", "@kd/components"],
      localeMap: {
        zh: "zh",
        en: "en",
        jp: "ja",
        ar: "ar",
      },
    },
    rtl: {
      enabledLanguages: ["ar"],
      dirAttributeTarget: "document.documentElement.dir",
      mixinFile: "src/languages/i18n-plugin/i18nMixin.js",
      styleFile: "src/styles/i18n-style.scss",
      reloadOnLanguageChange: true,
      logicalCssHelpers: ["margin-inline-start", "margin-inline-end", "overflow-wrap", "word-break"],
    },
   network: {
     file: "src/utils/interceptors-utils.js",
     acceptLanguageHeader: "Accept-Language",
     timezoneHeader: "X-Timezone",
     headerLanguageMap: {
       zh: "zh-CN",
       en: "en-US",
       jp: "ja-JP",
       ar: "ar",
     },
   },
   timezone: {
     storageKey: "i18n-tz",
     mixinFile: "src/languages/i18n-plugin/i18nMixin.js",
     componentReplacements: [
       {
         from: "el-date-picker",
         to: "kd-date-picker",
         condition: 'type="datetime"',
       },
     ],
     codeReplacements: [
       { from: "Date.now()", to: "this.tzDateNow()" },
       { from: "new Date()", to: "this.tzNewDate()" },
       { from: "parseTime()", to: "parseTime(this.tzNewDate())" },
       { from: "dayjs()", to: "this.$i18nNow()" },
     ],
   },
   widthAdaptation: {
      file: "src/mixins/i18n-width-mixin.js",
      helper: "getI18nWidth",
      languageOrder: ["zh", "en", "jp", "ar"],
      formats: ["comma-separated-sequence", "object-map"],
    },
    specialComponents: [
      {
        component: "kd-column-text",
        props: ["p-l"],
        strategy: "template-literal-label",
        example: "`field,${t('标签')}`",
      },
      {
        component: "kd-column-filter",
        props: ["p-l", "formatter"],
        strategy: "translate-prop-and-formatter",
      },
      {
        component: "kd-input",
        props: ["placeholder", "title"],
        strategy: "bind-with-t",
      },
    ],
    routeTitle: {
      file: "src/App.vue",
      translateMetaTitle: true,
      fallbackTitle: "数据中台",
    },
    layoutHeader: {
      file: "src/layout/layout-header/index.vue",
      requireMixin: true,
      requireLanguageSwitcher: true,
      languageSwitcherComponent: "kd-select",
      languageSwitcherProps: ["activeLanguage", "languages", "changeLanguage"],
    },
    validation: {
      hardcodedChineseScan: true,
      scanExcludePrefixes: ["src/languages/formatters/", "src/router/modules/"],
      placeholderStrictForNamedTokens: true,
      generatedFilesImmutable: true,
    },
  },
};

module.exports = preset;
