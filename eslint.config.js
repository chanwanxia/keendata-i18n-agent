module.exports = [
  {
    ignores: ["node_modules/", "dist/", "src/kit/templates/"],
  },
  {
    files: ["src/**/*.js", "test/**/*.js", "bin/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-undef": "error",
      "no-redeclare": "error",
      "prefer-const": "warn",
      "no-var": "error",
      eqeqeq: ["warn", "smart"],
    },
  },
];
