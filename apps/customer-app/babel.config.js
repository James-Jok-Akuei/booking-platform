module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Every sentence the app shows goes through the translations (§308).
    plugins: ['@lingui/babel-plugin-lingui-macro'],
  };
};
