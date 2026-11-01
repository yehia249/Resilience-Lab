# Local runtime and GitHub Pages

The backend runs locally only. Public visitors use static replay of recorded local experiments. No cloud credentials, infrastructure approvals or signups are required.

## This workstation

The isolated ResilienceLab WSL distribution contains Docker, Compose, kubectl and k3d. Keep the task-owned daemon running:

```powershell
wsl -d ResilienceLab --cd 'F:\resilience lab' -- sh scripts/docker-daemon.sh
```

In another terminal:

```powershell
wsl -d ResilienceLab --cd 'F:\resilience lab' -- sh scripts/start-local.sh
```

Open http://localhost:8088 for Live Compose. Generated .env stays ignored. For Kubernetes run bash scripts/k3d-up.sh in the same WSL distribution and open http://localhost:8089. Avoid restarting the cluster during recording.

## Public frontend

.github/workflows/pages.yml builds with VITE_LAB_MODE=replay and /Resilience-Lab/ as its base. It validates recordings, runs browser tests, uploads only apps/web/dist and deploys through GitHub Pages. No backend or secret is exposed.

Push reviewed code and recordings to main. The feature branch is also enabled during initial delivery. The workflow publishes https://yehia249.github.io/Resilience-Lab/. Workflow success and an HTTP check establish publication; a configured URL alone is not deployment evidence.

Engineering uses a hash route. The public Live control opens the local Compose address. Live use requires starting the local backend.

## Evidence

Forward Jaeger with kubectl port-forward -n lab service/jaeger 16687:16686, then make record. The recorder resumes its index, validates the local cluster, captures actual ordered snapshots and normalized OpenTelemetry traces, and writes both evidence and public assets. REQUIRE_FULL_RECORDINGS=true pnpm exec tsx scripts/validate-recordings.ts requires ten runs per fault.

Recorder revision identifies the capture tool; runtime image digest separately identifies the running service. One-second sampling can miss a short payment fault slot; its accepted response and actual error traces remain evidence. No artificial sample is inserted. Local fixture quota resets do not change the public three-faults-per-ten-minutes limit.
