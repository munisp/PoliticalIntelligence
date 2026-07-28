/**
 * OpenTelemetry tracing for the Node gateway (OBS-3) — env-gated, noop by
 * default, mirroring the Python services' setup_tracing.
 *
 * Enable with OTEL_SDK_ENABLED=true and install the optional OTel packages
 * (@opentelemetry/sdk-node, @opentelemetry/auto-instrumentations-node,
 * @opentelemetry/exporter-trace-otlp-http — NOT in package.json by default;
 * they are heavy and only needed in traced environments). Spans are
 * exported to OTEL_EXPORTER_OTLP_ENDPOINT (default
 * http://otel-collector:4318, matching infra/docker/otel-collector-config.yaml).
 *
 * The dynamic import guard means a missing package or an unreachable
 * collector never breaks boot — it logs and continues untraced.
 */
export async function setupNodeOtel(serviceName = "policy-twin-gateway"): Promise<boolean> {
  if (!/^(1|true|yes)$/i.test(process.env.OTEL_SDK_ENABLED ?? "")) return false;
  try {
    const endpoint = (
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://otel-collector:4318"
    ).replace(/\/$/, "");
    const [{ NodeSDK }, { getNodeAutoInstrumentations }, otlp] =
      await Promise.all([
        import("@opentelemetry/sdk-node" as string),
        import("@opentelemetry/auto-instrumentations-node" as string),
        import("@opentelemetry/exporter-trace-otlp-http" as string),
      ]);
    const sdk = new NodeSDK({
      serviceName,
      traceExporter: new otlp.OTLPTraceExporter({
        url: `${endpoint}/v1/traces`,
      }),
      instrumentations: [getNodeAutoInstrumentations()],
    });
    sdk.start();
    console.log(`[otel] Node SDK started, exporting to ${endpoint}`);
    return true;
  } catch (err) {
    console.warn(
      "[otel] OTEL_SDK_ENABLED but Node SDK setup failed (noop):",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
