const path = require("node:path");

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
