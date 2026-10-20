const path = require("node:path");
const webpack = require("webpack");

const HtmlWebpackPlugin = require("html-webpack-plugin");
const { VueLoaderPlugin } = require("vue-loader");

const projectRoot = path.resolve(__dirname, "../..");

module.exports = {
  context: projectRoot,
  mode: "development",
  entry: path.resolve(projectRoot, "src/main.ts"),
  devtool: "inline-source-map",
  output: {
    path: path.resolve(__dirname, "dist-workspace"),
    filename: "assets/[name].[contenthash:8].js",
    clean: true,
    publicPath: "/",
  },
  resolve: {
    extensions: [".ts", ".js", ".vue"],
    alias: {
      "@lark-base-open/js-sdk$": path.resolve(__dirname, "workspace-host-mock.ts"),
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
    new webpack.DefinePlugin({ __DUOWEI_PLUGIN_HOST__: JSON.stringify(process.env.DUOWEI_PLUGIN_HOST === "table" ? "table" : "record") }),
    new VueLoaderPlugin(),
    new HtmlWebpackPlugin({
      template: path.resolve(projectRoot, "record-view/index.html"),
      filename: "index.html",
      publicPath: "/",
    }),
  ],
  optimization: {
    splitChunks: { chunks: "all" },
  },
  devServer: {
    host: "127.0.0.1",
    port: 8081,
    hot: false,
    client: {
      overlay: {
        runtimeErrors: (error) => !error.message.includes("ResizeObserver loop"),
      },
    },
    static: [
      {
        directory: __dirname,
        publicPath: "/__harness__",
        watch: false,
      },
    ],
  },
};
