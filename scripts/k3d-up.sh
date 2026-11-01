#!/usr/bin/env bash
set -euo pipefail
if ! k3d cluster list -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.exit(JSON.parse(s).some(c=>c.name==="resilience-lab")?0:1))'; then
  k3d cluster create resilience-lab --servers 1 --agents 0 --image rancher/k3s:v1.33.5-k3s1 --port '127.0.0.1:8089:80@loadbalancer' --wait
else
  k3d cluster start resilience-lab --wait
fi
kubectl config use-context k3d-resilience-lab
k3d image import resilience-lab/service:local resilience-lab/web:local -c resilience-lab
OVERLAY=local LAB_HOST=localhost bash scripts/deploy.sh
