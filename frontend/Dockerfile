# MineAssist · Frontend React + Vite · Dockerfile multi-stage
# Build: docker build -t mineassist-frontend ./frontend
# Run:   docker run -p 8080:80 mineassist-frontend

# ─── Stage 1 : build ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Variable injectable au build : URL backend
ARG VITE_API_BASE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# ─── Stage 2 : nginx serve ────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Config nginx personnalisée pour SPA (toutes routes -> index.html)
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    gzip on; \
    gzip_types text/plain application/json application/javascript text/css; \
    location / { try_files $uri $uri/ /index.html; } \
    location ~* \\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|eot|ico)$ { \
      expires 1y; \
      add_header Cache-Control "public, immutable"; \
    } \
}' > /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
