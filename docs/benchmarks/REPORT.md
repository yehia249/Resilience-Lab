# Real local recordings

Captured on 2026-11-01T17:14:58.795Z. Completed 30/40 required runs. Target: http://localhost:8089 (k3d).

| Fault | Runs | Median recovery s | Sample p95 recovery s |
|---|---:|---:|---:|
| KILL_PAYMENT | 8 | 51.219 | 118.945 |
| ADD_CATALOG_LATENCY | 8 | 55.462 | 120.572 |
| SPIKE_TRAFFIC | 7 | 70.798 | 99.808 |
| SLOW_DATABASE | 7 | 53.205 | 245.202 |

Every JSON file contains actual timestamped metrics, topology, request timings, events and retrieved normalized OpenTelemetry spans. Payment processing is deliberately simulated; requests, faults, persistence and timings are real. No missing measurements are filled with generated values.

Method: wait for a healthy baseline; capture baseline frames; inject exactly one normal-TTL fault; wait for the system recovery event (ten consecutive healthy samples and ready replicas); capture the result. The local administrative fixture resets only the visitor quota between runs; the global fault slot, TTL and cooldown remain enforced. Payment-kill runs include a real checkout burst to exercise each gateway replica's breaker before pods recover.

Raw evidence is in recordings/ and apps/web/public/recordings/. Runtime image digest, runtime Node version and recorder revision are embedded. Recordings describe their captured image, not a later build. Replay is labelled and never presented as a current live system.

Caveats: one shared Windows/WSL machine; CPU-driven HPA; histogram percentile estimates; deliberately synthetic shoppers; no external payment network; local background test activity can affect timings. These are local observations, not production or cloud claims.
