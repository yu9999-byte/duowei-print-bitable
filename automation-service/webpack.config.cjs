const path = require("node:path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

const serviceRoot = __dirname;
const projectRoot = path.resolve(serviceRoot, "..");

module.exports = {
  context: projectRoot,
  mode: "production",
  entry: path.resolve(serviceRoot, "renderer/index.ts"),
  devtool: false,
  output: {
    path: path.resolve(serviceRoot, "dist/renderer"),
    filename: "renderer.[contenthash:8].js",
    publicPath: "./",
    clean: true,
  },
  resolve: { extensions: [".ts", ".js"] },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        loader: "ts-loader",
        options: {
          configFile: path.resolve(projectRoot, "tsconfig.app.json"),
          transpileOnly: true,
          compilerOptions: { noEmit: false, allowImportingTsExtensions: false },
        },
      },
      { test: /\.css$/, use: ["style-loader", "css-loader"] },
    ],
  },
  plugins: [new HtmlWebpackPlugin({
    template: path.resolve(serviceRoot, "renderer/index.html"),
    filename: "index.html",
  })],
  optimization: { splitChunks: false },
};
