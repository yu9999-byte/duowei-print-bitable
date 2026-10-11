const path = require("node:path");
const fs = require("node:fs");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const base = require("../../record-view/webpack.config.cjs");

module.exports = {
  ...base,
  mode: "development",
  entry: path.resolve(__dirname, "linked-engine.ts"),
  output: {
    path: path.resolve(__dirname, "../../artifacts/linked-engine"),
    filename: "[name].[contenthash:8].js",
    publicPath: "/",
    clean: true,
  },
  plugins: [new HtmlWebpackPlugin({ template: path.resolve(__dirname, "linked-engine.html") })],
  devServer: {
    host: "127.0.0.1",
    port: 4788,
    hot: false,
    setupMiddlewares(middlewares, server) {
      server.app.post("/__test/artifact", (request, response) => {
        const requestUrl = new URL(request.url, "http://127.0.0.1");
        const name = requestUrl.searchParams.get("name");
        const kind = requestUrl.searchParams.get("kind");
        if (!["linked-long", "linked-batch"].includes(name) || !["html", "pdf"].includes(kind)) {
          response.sendStatus(400);
          return;
        }
        const chunks = [];
        let size = 0;
        request.on("data", (chunk) => {
          size += chunk.length;
          if (size > 30_000_000) request.destroy();
          else chunks.push(chunk);
        });
        request.on("end", () => {
          fs.mkdirSync(path.resolve(__dirname, "../../artifacts/implementation-v16"), { recursive: true });
          fs.writeFileSync(
            path.resolve(__dirname, `../../artifacts/implementation-v16/${name}.${kind}`),
            Buffer.concat(chunks),
          );
          response.sendStatus(204);
        });
      });
      return middlewares;
    },
  },
};
