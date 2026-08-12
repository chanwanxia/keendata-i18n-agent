export function i18nMixin() {
  return {
    provide() {
      return {
        htmlDir: this.htmlDir,
        isRtl: this.isRtl,
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
      activeLanguage: {
        get() {
          return this.getActiveLanguage();
        },
      },
      languages() {
        return VoerkaI18n.languages;
      },
      isRtl() {
        const lang = this.activeLanguage || localStorage.getItem("language") || "zh";
        return ["ar"].includes(lang);
      },
      htmlDirection() {
        return this.isRtl ? "rtl" : "ltr";
      },
    },
    methods: {
      changeLanguage(language) {
        localStorage.setItem("language", language);
        document.documentElement.setAttribute("dir", this.htmlDirection);
        location.reload();
      },
    },
  };
}
