const path = require("node:path");
const fs = require("node:fs");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const base = require("../../record-view/webpack.config.cjs");

module.exports = {
  ...base,
  mode: "development",
  entry: path.resolve(__dirname, "label-engine.ts"),
  output: {
    path: path.resolve(__dirname, "../../artifacts/label-engine"),
    filename: "[name].[contenthash:8].js",
    publicPath: "/",
    clean: true,
  },
  plugins: [new HtmlWebpackPlugin({ template: path.resolve(__dirname, "label-engine.html") })],
  devServer: {
    host: "127.0.0.1", port: 4783, hot: false,
    setupMiddlewares(middlewares, server) {
      server.app.post("/__test/pdf", (request, response) => {
        const chunks = [];
        let size = 0;
        request.on("data", (chunk) => {
          size += chunk.length;
          if (size > 2_000_000) request.destroy();
          else chunks.push(chunk);
        });
        request.on("end", () => {
          const output = path.resolve(__dirname, "../../artifacts/label-engine-test.pdf");
          fs.writeFileSync(output, Buffer.concat(chunks));
          response.sendStatus(204);
        });
      });
      return middlewares;
    },
  },
};
