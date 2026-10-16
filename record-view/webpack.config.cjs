const path = require("node:path");
const webpack = require("webpack");

process.chdir(__dirname);

const HtmlWebpackPlugin = require("html-webpack-plugin");
const { VueLoaderPlugin } = require("vue-loader");
const {
  BitableAppWebpackPlugin,
  opdevMiddleware,
} = require("@lark-opdev/block-bitable-webpack-utils");

const projectRoot = path.resolve(__dirname, "..");
const isDevelopment = process.env.NODE_ENV !== "production";

module.exports = {
  context: projectRoot,
  mode: isDevelopment ? "development" : "production",
  entry: path.resolve(projectRoot, "src/main.ts"),
  devtool: isDevelopment ? "inline-source-map" : false,
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "assets/[name].[contenthash:8].js",
    clean: true,
    publicPath: isDevelopment ? "/" : "./",
  },
  resolve: {
    extensions: [".ts", ".js", ".vue"],
    alias: {
      "@lark-base-open/js-sdk$": "@lark-opdev/block-bitable-api",
    },
  },
  module: {
    rules: [
      {
        test: /web-component-.*\.js$/,
        include: /node_modules[\\/]vue-print-designer[\\/]dist[\\/]/,
        loader: path.resolve(projectRoot, "scripts/designer-table-loader.cjs"),
      },
      {
        test: /\.vue$/,
        loader: "vue-loader",
        options: {
          compilerOptions: {
            isCustomElement: (tag) => tag === "print-designer",
          },
        },
      },
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        loader: "ts-loader",
        options: {
          configFile: path.resolve(projectRoot, "tsconfig.app.json"),
          transpileOnly: true,
          appendTsSuffixTo: [/\.vue$/],
          compilerOptions: { noEmit: false, allowImportingTsExtensions: false },
        },
      },
      { test: /\.css$/, use: ["style-loader", "css-loader"] },
    ],
  },
  plugins: [
    new VueLoaderPlugin(),
    new webpack.DefinePlugin({
      __DUOWEI_TEMPLATE_SYNC_CONFIG__: JSON.stringify({
        authorizationEndpoint: process.env.DUOWEI_TEMPLATE_SYNC_AUTHORIZATION_ENDPOINT ?? "",
        registryEndpoint: process.env.DUOWEI_TEMPLATE_REGISTRY_WRITE_ENDPOINT ?? "",
        bridgeEndpoint: process.env.DUOWEI_TEMPLATE_SYNC_BRIDGE_ENDPOINT ?? "",
      }),
    }),
    new BitableAppWebpackPlugin({ open: false }),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, "index.html"),
      filename: "index.html",
      publicPath: "./",
    }),
  ],
  optimization: {
    splitChunks: { chunks: "all" },
  },
  devServer: isDevelopment ? {
    hot: true,
    setupMiddlewares(middlewares, devServer) {
      middlewares.push(opdevMiddleware(devServer));
      return middlewares;
    },
  } : undefined,
};
