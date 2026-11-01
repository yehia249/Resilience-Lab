#!/usr/bin/env bash
set -euo pipefail
[[ "$(kubectl config current-context)" == 'k3d-resilience-lab' ]] || { echo 'Quota reset is restricted to the named disposable local cluster'; exit 1; }
kubectl exec deployment/redis -n lab -- redis-cli EVAL "local keys=redis.call('KEYS','quota:*');for _,key in ipairs(keys) do redis.call('DEL',key) end;return #keys" 0
