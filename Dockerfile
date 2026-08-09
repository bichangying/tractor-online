# 拖拉机 Online —— 生产镜像
# 用法：
#   docker build -t tractor-online .
#   docker run -p 3000:3000 tractor-online
FROM node:20-alpine

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 再拷源码
COPY . .

# 回放目录（运行时生成）
RUN mkdir -p data/replays

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server/index.js"]
