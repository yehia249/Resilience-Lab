#!/usr/bin/env bash
set -euo pipefail
k3d cluster create resilience-lab --servers 1 --agents 0 --image rancher/k3s:v1.33.5-k3s1 --port '127.0.0.1:8089:80@loadbalancer' --wait
k3d image import resilience-lab/service:local resilience-lab/web:local -c resilience-lab
OVERLAY=local LAB_HOST=localhost bash scripts/deploy.sh
