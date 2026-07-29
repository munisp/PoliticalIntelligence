# geo-rs — multi-stage build (rust:1-bookworm -> debian-slim).
# Static musl variant (optional):
#   docker build --build-arg TARGET=x86_64-unknown-linux-musl -t geo-rs:musl .
ARG TARGET=x86_64-unknown-linux-gnu

FROM rust:1-bookworm AS builder
ARG TARGET
WORKDIR /src
RUN rustup target add ${TARGET}
# Cache deps separately from source.
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && echo '' > src/lib.rs \
    && cargo build --release --target ${TARGET} \
    && rm -rf src
COPY src ./src
COPY tests ./tests
RUN cargo test --release --target ${TARGET} \
    && cargo build --release --target ${TARGET}

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 geo && mkdir -p /app && chown geo /app
USER geo
ARG TARGET
COPY --from=builder /src/target/${TARGET}/release/geo-rs /app/geo-rs
ENV PORT=8500
EXPOSE 8500
ENTRYPOINT ["/app/geo-rs"]
