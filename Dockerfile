FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends util-linux ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node dist ./dist
COPY --chown=node:node deploy/entrypoint.sh ./entrypoint.sh
RUN mkdir /data && chown node:node /data && chmod 755 /app/entrypoint.sh
USER node
ENV NODE_ENV=production DATA_DIR=/data HOST=0.0.0.0 PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok||!(await r.json()).ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/entrypoint.sh"]
