module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Add a fallback for the 'module' module, which is Node.js specific.
      // This prevents Webpack from trying to bundle it for the browser.
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        module: false, // or require.resolve('module') if a polyfill is needed
      };
      return webpackConfig;
    },
  },
};