# Benchmark status

No published performance benchmark runs yet. results.json is explicitly marked not_run. Do not infer production throughput, recovery, HPA or pod restart performance from unit tests or the frontend build.

Method: healthy synthetic-shopping baseline; inject one fault; sample Prometheus-based telemetry every second; require fault cleared, all measured deployments ready, error rate below 2% and p95 below 250 ms for ten consecutive samples. Record duration and peaks, preserve raw snapshots, and repeat at least ten times per fault. The runner respects visitor rate limits, so a full run is long. k6 scripts provide separate baseline (five minutes), spike (ninety seconds), and soak (one hour) tests.

The local Docker kill adapter deliberately holds the process stopped for twelve seconds before restart. Its timing is not Kubernetes pod restart performance. Histogram quantiles are estimates. Single-node results and synthetic processor behavior do not generalize to distributed production traffic. Actual completed checks and measurements belong in STATUS.md and integration.json; they do not substitute for the forty-run benchmark.
