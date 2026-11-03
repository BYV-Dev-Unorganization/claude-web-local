FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 build-essential ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 10001 --create-home --shell /usr/sbin/nologin sandbox

WORKDIR /workspace
USER sandbox
ENV HOME=/tmp
