# Build static assets, then serve with nginx (proxies API to orchestrator).
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json ./
RUN npm install --omit=dev=false
COPY tsconfig.json esbuild.mjs ./
COPY public ./public
COPY src ./src
COPY themes ./themes
ARG JARVIS_THEME=default
ENV JARVIS_THEME=$JARVIS_THEME
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/ /usr/share/nginx/html/
EXPOSE 8080
