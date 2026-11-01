# Actual Compose load measurements

Run: [GitHub Actions](https://github.com/yehia249/Resilience-Lab/actions/runs/41328919306). This is a separate local Compose stack inside an existing GitHub runner, not workstation k3d throughput. The exact source revision and image IDs are in the accompanying text files.

| Scenario | Requests | Achieved requests/s | HTTP failure % | Catalog p95 ms |
|---|---:|---:|---:|---:|
| baseline | 7501 | 25.003 | 0.000 | 29.034 |
| spike | 9749 | 108.322 | 0.000 | 67.450 |
| soak | 90000 | 25.000 | 0.000 | 23.884 |

Configured durations: baseline five minutes at 25 requests/s; spike ninety seconds with a ramp to 125 requests/s; soak one hour at 25 requests/s. The spike rate above is the observed average over the ramp, not an asserted sustained 125 requests/s. These requests read the catalog; they are not payment throughput. Synthetic shop traffic also runs in the stack. The summaries are real k6 outputs; no load values are generated.
