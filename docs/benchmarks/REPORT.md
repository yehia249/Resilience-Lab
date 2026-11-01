# Measured local fault experiments

Captured through 2026-11-01T17:54:12.346Z. **40/40 required runs; ten or more per fault, complete.** Target: local k3d on the existing Windows/WSL workstation. No production throughput or availability claim is made.

| Fault | Runs | Median recovery s | Sample p95 recovery s | Median peak p95 ms | Max observed p99 ms |
|---|---:|---:|---:|---:|---:|
| KILL_PAYMENT | 10 | 51.219 | 118.945 | 3499.586 | 5000.000 |
| ADD_CATALOG_LATENCY | 10 | 54.433 | 120.572 | 1408.293 | 4867.187 |
| SPIKE_TRAFFIC | 10 | 70.703 | 99.808 | 134.223 | 5000.000 |
| SLOW_DATABASE | 10 | 53.186 | 245.202 | 870.643 | 4828.745 |

Recovery requires fault clearance, ready replicas, p95 below 250 ms and HTTP error rate below 2% for ten consecutive samples. The sample p95 is nearest rank; at ten samples it equals the largest observed duration. Request p95/p99 are Prometheus histogram estimates, distinct from the distribution of recovery durations.

## Autoscaling observations during recorded spikes

| Run | Service | Initial desired | First desired increase s | First ready increase s |
|---|---|---:|---:|---:|
| spike_traffic-01 | catalog | 2 | 34.749 | 69.678 |
| spike_traffic-02 | catalog | 2 | 32.208 | 48.196 |
| spike_traffic-03 | gateway | 4 | 39.884 | 55.789 |
| spike_traffic-03 | catalog | 2 | 16.728 | 31.726 |
| spike_traffic-05 | catalog | 3 | 24.683 | 37.629 |
| spike_traffic-06 | catalog | 2 | 28.949 | 63.219 |
| spike_traffic-07 | gateway | 4 | 32.701 | 76.681 |
| spike_traffic-07 | catalog | 2 | 32.701 | 76.681 |
| spike_traffic-08 | gateway | 4 | 37.894 | 49.138 |
| spike_traffic-08 | catalog | 3 | 53.406 | 59.526 |
| spike_traffic-08 | cart | 1 | 50.109 | 81.712 |
| spike_traffic-09 | gateway | 3 | 28.537 | 44.695 |
| spike_traffic-09 | catalog | 2 | 28.537 | 48.903 |
| spike_traffic-10 | gateway | 4 | 37.297 | 48.300 |
| spike_traffic-10 | catalog | 2 | 22.289 | 33.373 |

Times above start at accepted fault injection, using the first actual one-second snapshot showing an increase. This is sampled observation latency, not an exact HPA-controller timestamp. Runs without an observed increase retain null in analysis.json; an already scaled service may remain at its ceiling. Only these observed increases are counted as scale-up evidence.

## Method and raw evidence

Wait for healthy metrics, no active fault, expired cooldown and ready replicas. Capture the baseline, inject one normal-duration fault, submit real shop traffic and wait for the persisted recovery record. Payment-kill experiments include a real checkout burst to exercise independently scoped gateway breakers. The privileged local fixture resets visitor quota between experiments; the global slot, TTL and cooldown are unchanged.

Raw JSON is duplicated in [recordings/](recordings/) and apps/web/public/recordings/. It includes actual metrics, topology, events, checkout timings and normalized OpenTelemetry spans. [analysis.json](analysis.json) derives per-run p99, HPA observations and observed payment unready-to-ready intervals. Missing observations stay null. The latter intervals are not exact pod scheduling durations.

Total captured: 2550 snapshots, 119 traces and 2169 spans. Collection errors: 62; timestamps and errors are preserved rather than filled.

## Limits and interruptions

One shared HDD-backed Windows/WSL machine, four virtual CPUs and 5 GB VM memory. Dashboard CPU percentages use a two-core reference budget. Synthetic shoppers create real HTTP/SQL/queue work; payment processor behavior is deliberately simulated. Database slowdown is an explicit query-wrapper delay. These are local observations subject to host contention, histogram bucket precision and one-second sampling.

Completed-recovery statistics exclude interrupted attempts and are not an experiment success rate. See [capture provenance](PROVENANCE.md) and [the interrupted build-contention attempt](interrupted-build-contention.json). Initial runtime identifier limitations are documented there. The running-image identifier and recorder revision describe different artifacts; recordings do not claim to measure a later image build.

Baseline, spike and one-hour soak measurements from the separate Compose CI environment are kept separately under load/ when available. Lighthouse reports measure the public static frontend. Neither dataset is presented as local k3d throughput.
