FROM mcr.microsoft.com/playwright:v1.55.0-noble

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY automation-service/package.json automation-service/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY automation-service/dist ./dist

RUN mkdir -p /data && chown -R pwuser:pwuser /app /data
USER pwuser
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.mjs"]
