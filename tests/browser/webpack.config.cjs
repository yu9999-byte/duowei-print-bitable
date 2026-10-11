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
      const saveArtifact = (kind, extension, limit) => (request, response) => {
        const requestUrl = new URL(request.url, "http://127.0.0.1");
        const count = Number(requestUrl.searchParams.get("count"));
        if (![3, 7].includes(count)) {
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
          const output = path.resolve(__dirname, `../../artifacts/label-${kind}-${count}.${extension}`);
          fs.writeFileSync(output, Buffer.concat(chunks));
          response.sendStatus(204);
        });
      };
      server.app.post("/__test/pdf", saveArtifact("engine", "pdf", 2_000_000));
      server.app.post("/__test/html", saveArtifact("print", "html", 20_000_000));
      return middlewares;
    },
  },
};
