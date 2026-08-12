module.exports = {
  plugins: {
    autoprefixer: {},
    "postcss-rtlcss": {
      enabled: true,
      autoRename: true,
      ignoreImportant: true,
      processRoot: true,
      processKeyFrames: false,
      processUrls: false,
    },
  },
};
