import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
const sdk = new NodeSDK({
  serviceName: process.env.SERVICE ?? 'gateway',
  traceExporter: new OTLPTraceExporter(),
  metricReaders: [new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
    exportIntervalMillis: 10000,
  })],
  instrumentations: [
    getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
  ],
});
sdk.start();
process.on('SIGTERM', () => {
  void sdk.shutdown();
});
