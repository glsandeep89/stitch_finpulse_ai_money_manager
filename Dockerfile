# FinPulse API — backend only (see README for frontend static deploy)
FROM node:20-alpine
WORKDIR /app

COPY backend/package.json backend/tsconfig.json ./
RUN npm install

COPY backend/src ./src

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
