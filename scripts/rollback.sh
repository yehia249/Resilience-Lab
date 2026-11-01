#!/usr/bin/env bash
set -uo pipefail
# Data stores are deliberately excluded; image rollback cannot reverse SQL changes.
for task_deployment in gateway catalog cart order-worker telemetry-api chaos-controller traffic-generator web; do
 kubectl rollout undo "deployment/$task_deployment" -n lab || true
done
for task_deployment in payment pod-kill-proxy; do
 kubectl rollout undo "deployment/$task_deployment" -n lab-payment || true
done
