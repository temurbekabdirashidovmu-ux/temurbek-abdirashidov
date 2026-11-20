FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends stockfish && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production STOCKFISH_PATH=/usr/games/stockfish
EXPOSE 10000
CMD ["npm","start"]