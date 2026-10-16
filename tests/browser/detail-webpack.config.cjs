const path = require("node:path");
const fs = require("node:fs");
const base = require("./linked-webpack.config.cjs");
module.exports = {
  ...base,
  output: { ...base.output, path: path.resolve(__dirname, "../../artifacts/detail-fields-2026-10-15/engine") },
  devServer: {
    host: "127.0.0.1", port: 4795, hot: false, client: { overlay: false },
    setupMiddlewares(middlewares, server) {
      server.app.post("/__test/artifact", (request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        const name = url.searchParams.get("name"); const kind = url.searchParams.get("kind");
        if (!["linked-long", "linked-batch", "detail-manual"].includes(name) || !["html", "pdf"].includes(kind)) return response.sendStatus(400);
        const chunks = []; let size = 0;
        request.on("data", (chunk) => { size += chunk.length; if (size > 30000000) request.destroy(); else chunks.push(chunk); });
        request.on("end", () => {
          fs.writeFileSync(path.resolve(__dirname, `../../artifacts/detail-fields-2026-10-15/${name}.${kind}`), Buffer.concat(chunks));
          response.sendStatus(204);
        });
      });
      return middlewares;
    },
  },
};
