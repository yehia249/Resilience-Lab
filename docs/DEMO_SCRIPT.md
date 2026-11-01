# 90-second demo

Record only after the backend is healthy and public smoke tests pass. Do not edit in fabricated metrics or conceal failed experiments.

- 0–12 s: Open the lab. “This is a real shop on a single-node Kubernetes cluster. These are live Prometheus measurements; the payment processor is simulated.”
- 12–25 s: Add a keyboard. Click Kill payment service. Point out ready replicas falling and the event log reporting the fault.
- 25–45 s: After breaker opens, click Checkout. Read the queued result: “The order is durable; the worker retries it with the same idempotency key.”
- 45–60 s: Watch pod readiness, breaker probes and the actual recovered banner. State only the displayed measured duration.
- 60–75 s: After cooldown, click Spike traffic. Show actual request rate and HPA scale-up if it occurs; do not claim it scaled if the cluster did not.
- 75–90 s: Open Engineering. Show the architecture, ADRs and measured benchmark report. “This demonstrates application recovery, not host-level high availability.”

Suggested title: “Resilience Lab: real faults, measured recovery.” Publish the recording only after reviewing it and set a real video URL before adding an embed. Until then, the site honestly reports that the recording is unavailable.
