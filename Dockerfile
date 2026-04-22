FROM node:20-alpine

WORKDIR /app

# Environment o'zgaruvchilarini o'rnatish
ENV NODE_ENV=production

# package.json va package-lock.json ko'chirish
COPY package*.json ./

# Dependencies o'rnatish
RUN npm ci --only=production

# Qolgan kodlarni ko'chirish
COPY . .

# Health check (ixtiyoriy)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "console.log('ping')" || exit 1

# Bot ishga tushirish
CMD ["node", "index.js"]
