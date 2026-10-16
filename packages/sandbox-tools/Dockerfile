# syntax=docker/dockerfile:1.7
FROM node:26.1.0-bookworm-slim@sha256:8c676dbdbfc322815df09c910e80685fc5de08baa21c3b6189627e302b1bf131 AS node
FROM emscripten/emsdk:6.0.11@sha256:cdefec943f04fd4b2b2fe23b0a1a346be9fc560ef5784a83faa27dd351381372 AS codecs
COPY --from=node /usr/local/ /usr/local/
RUN apt-get update && apt-get install -y --no-install-recommends autoconf automake libtool pkg-config nasm yasm git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global --ignore-scripts pnpm@12.9.1
WORKDIR /build/ffmpeg-wasm
RUN git init && git remote add origin https://github.com/openclaw/ffmpeg-wasm.git && git fetch --depth 1 origin 6242c7c0e4414fb352ac810237ce0594ffc8ec16 && git checkout --detach FETCH_HEAD
RUN --mount=type=cache,id=puddles-sandbox-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --store-dir /pnpm/store
ENV FFMPEG_VERSION=946fcce07b6dcd0331c8cc609192aeff5e1924f8 LAME_REF=2badea1974ae36cb8312afe99cff1e6b3b5decee LIBVPX_REF=6df3ec34557879fff673706f4a1d9fbd0f3a6f0e
RUN pnpm build

FROM node AS runtime
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates curl git jq python3 ripgrep imagemagick libheif-examples && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/sandbox-tools/runtime
COPY runtime/package.json runtime/package-lock.json ./
RUN --mount=type=cache,id=puddles-sandbox-npm,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=codecs /build/ffmpeg-wasm/package.json ./node_modules/@steipete/ffmpeg-wasm-local/package.json
COPY --from=codecs /build/ffmpeg-wasm/lib ./node_modules/@steipete/ffmpeg-wasm-local/lib
COPY --from=codecs /build/ffmpeg-wasm/dist ./node_modules/@steipete/ffmpeg-wasm-local/dist
COPY --from=codecs /build/ffmpeg-wasm/LICENSE ./node_modules/@steipete/ffmpeg-wasm-local/LICENSE
COPY runtime/register.mjs ./register.mjs
COPY bin /opt/sandbox-tools/bin
COPY SKILL.md /opt/sandbox-tools/SKILL.md
RUN chmod 755 /opt/sandbox-tools/bin/* && for tool in sandbox-node sandbox-tsx sandbox-image clawpdf ffmpeg-wasm ffprobe-wasm; do ln -s /opt/sandbox-tools/bin/$tool /usr/local/bin/$tool; done \
 && usermod --login sandbox --home /home/sandbox --move-home node \
 && groupmod --new-name sandbox node
USER sandbox
WORKDIR /home/sandbox
CMD ["sleep", "infinity"]
