FROM oven/bun:1.3.5-alpine

# The MCP server cuts still frames from recorded videos (get_video_frames).
RUN apk add --no-cache ffmpeg

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock turbo.json tsconfig.json biome.jsonc ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile
RUN bun run --filter server build

EXPOSE 3000

CMD ["bun", "/app/apps/server/dist/index.mjs"]
