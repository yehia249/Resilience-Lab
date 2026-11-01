import { NodeSDK } from '@opentelemetry/sdk-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
const sdk = new NodeSDK({
  serviceName: process.env.SERVICE ?? 'gateway',
  traceExporter: new OTLPTraceExporter(),
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 10000,
    }),
  ],
  instrumentations: [
    new HttpInstrumentation(),
    new IORedisInstrumentation(),
    new PgInstrumentation(),
    new UndiciInstrumentation(),
  ],
});
sdk.start();
process.on('SIGTERM', () => {
  void sdk.shutdown();
});
