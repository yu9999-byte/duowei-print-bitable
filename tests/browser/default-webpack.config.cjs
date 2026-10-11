const path = require("node:path");
const fs = require("node:fs");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const base = require("../../record-view/webpack.config.cjs");

module.exports = {
  ...base,
  mode: "development",
  entry: path.resolve(__dirname, "default-engine.ts"),
  output: {
    path: path.resolve(__dirname, "../../artifacts/default-engine"),
    filename: "[name].[contenthash:8].js",
    publicPath: "/",
    clean: true,
  },
  plugins: [new HtmlWebpackPlugin({ template: path.resolve(__dirname, "default-engine.html") })],
  devServer: {
    host: "127.0.0.1", port: 4785, hot: false,
    setupMiddlewares(middlewares, server) {
      const saveArtifact = (kind, extension, limit) => (request, response) => {
        const requestUrl = new URL(request.url, "http://127.0.0.1");
        const count = Number(requestUrl.searchParams.get("count"));
        if (![1, 3, 10, 50].includes(count)) {
          response.sendStatus(400);
          return;
        }
        const chunks = [];
        let size = 0;
        request.on("data", (chunk) => {
          size += chunk.length;
          if (size > limit) request.destroy();
          else chunks.push(chunk);
        });
        request.on("end", () => {
          fs.writeFileSync(path.resolve(__dirname, `../../artifacts/default-${kind}-${count}.${extension}`), Buffer.concat(chunks));
          response.sendStatus(204);
        });
      };
      server.app.post("/__test/html", saveArtifact("print", "html", 20_000_000));
      server.app.post("/__test/pdf", saveArtifact("engine", "pdf", 20_000_000));
      return middlewares;
    },
  },
};
