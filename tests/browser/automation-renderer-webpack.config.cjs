const path = require("node:path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const base = require("../../record-view/webpack.config.cjs");

module.exports = {
  ...base,
  mode: "development",
  entry: path.resolve(__dirname, "automation-renderer-engine.ts"),
  output: {
    path: path.resolve(__dirname, "../../artifacts/automation-renderer-engine"),
    filename: "[name].[contenthash:8].js",
    publicPath: "/",
    clean: true,
  },
  plugins: [new HtmlWebpackPlugin({
    template: path.resolve(__dirname, "automation-renderer-engine.html"),
  })],
  devServer: {
    host: "127.0.0.1",
    port: 4791,
    hot: false,
  },
};
