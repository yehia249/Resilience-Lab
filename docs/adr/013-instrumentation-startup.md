# ADR 013: Instrument the libraries actually used

Status: accepted.

The initial runtime loaded the complete Node auto-instrumentation bundle. Cold starts on the HDD-backed workstation became expensive during replica churn, and aggressive one-second probes amplified restarts. Use explicit automatic HTTP, Undici fetch, Postgres and ioredis instrumentation with the existing manual checkout spans. Unused framework instrumentations add no observability to this system.

Startup probes allow five minutes, with three-second timeouts. Runtime liveness tolerates six failed checks rather than restarting a CPU-starved process after three one-second checks. Readiness still removes unavailable replicas. Metric-based recovery requirements remain unchanged.

Earlier recordings retain their original runtime provenance. These changes are verified separately; historical measurements do not claim to measure the optimized image. A smoke trace check verifies spans actually reach Jaeger after changing instrumentation.
