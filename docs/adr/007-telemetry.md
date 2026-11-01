# ADR 007: Prometheus and OpenTelemetry

Status: accepted for implementation; verification is tracked in STATUS.md.

## Decision

Use directly scraped service histograms for dashboard quantiles; propagate W3C context through HTTP and streams; export traces via collector to Jaeger.

## Reason

Rates and histogram estimates should come from an observable running system, not from browser-generated models.

## Consequences

Absent series are null. The checkout waterfall records real step timings, distinct from querying stored Jaeger spans. In-memory trace retention is intentionally limited.
