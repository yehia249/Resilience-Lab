# 90-second demo

Use the public Pages site for a recording-based demonstration. Keep the Replay banner visible. Playback starts automatically and loops. For a live demonstration, start the local system and open localhost:8088; the public site has no Live/local tab or shop.

- 0–12 s: “This dashboard replays measurements captured from my real local Kubernetes system. Capture date and run ID are shown. The payment processor is simulated.”
- 12–30 s: Select Kill payment. Play at 2x or 4x and point to the actual service state, request metrics and event log.
- 30–45 s: Expand How does recovery work? Explain automatic fault expiry, the circuit breaker and the idempotent durable queue. Follow the recorded checkout waterfall as the experiment plays.
- 45–60 s: Show the recorded recovery duration. State only the displayed measured value and explain the ten-healthy-sample criterion.
- 60–75 s: Select Spike traffic and inspect the recorded request rate and replica counts. Only claim scaling if visible in this run.
- 75–90 s: Open Engineering and the raw benchmark report. “Clone the repository and run make dev for Live mode. This demonstrates service recovery on a single machine, not host-level high availability.”

Do not describe replay as live or insert generated measurements. Live faults run for their actual TTLs and cannot all fit into a ninety-second demonstration without a labelled time skip.
