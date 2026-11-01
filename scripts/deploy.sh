#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
overlay="${OVERLAY:-prod}"
if [[ "$overlay" != local && "$overlay" != prod ]]; then echo 'Invalid overlay'; exit 1; fi
: "${LAB_HOST:?Set LAB_HOST to the public free hostname (or localhost for local)}"
[[ "$LAB_HOST" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo 'Invalid hostname'; exit 1; }
node scripts/setup-env.mjs
umask 077
task_secret_file=$(mktemp)
task_manifest_file=$(mktemp)
trap 'rm -f "$task_secret_file" "$task_manifest_file"' EXIT
node --input-type=module -e 'import {readFileSync} from "node:fs";const e=Object.fromEntries(readFileSync(".env","utf8").trim().split(/\r?\n/).map(l=>{const i=l.indexOf("=");return[l.slice(0,i),l.slice(i+1)];}));for(const k of ["POSTGRES_PASSWORD","INTERNAL_TOKEN","IP_HASH_SECRET","ADMIN_TOKEN"])console.log(k+"="+e[k]);console.log("DATABASE_URL=postgres://lab:"+e.POSTGRES_PASSWORD+"@postgres.lab.svc.cluster.local:5432/lab")' > "$task_secret_file"
kubectl apply -f <(printf 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: lab\n---\napiVersion: v1\nkind: Namespace\nmetadata:\n  name: lab-payment\n')
for ns in lab lab-payment; do kubectl create secret generic lab-secrets -n "$ns" --from-env-file="$task_secret_file" --dry-run=client -o yaml | kubectl apply -f -; done
kubectl kustomize "infra/k8s/overlays/$overlay" | sed "s/REPLACE_HOST/$LAB_HOST/g" > "$task_manifest_file"
# Resolve API-server addresses for NetworkPolicy under both service and endpoint DNAT behavior.
task_api_ip=$(kubectl get endpoints kubernetes -n default -o jsonpath='{.subsets[0].addresses[0].ip}')
task_api_service_ip=$(kubectl get service kubernetes -n default -o jsonpath='{.spec.clusterIP}')
[[ "$task_api_ip" =~ ^[0-9.]+$ && "$task_api_service_ip" =~ ^[0-9.]+$ ]] || exit 1
if [[ "$overlay" == prod ]]; then
  : "${LAB_IMAGE_TAG:?Set LAB_IMAGE_TAG to the reviewed Git commit SHA}"
  [[ "$LAB_IMAGE_TAG" =~ ^[a-f0-9]{40}$ ]] || { echo 'Image tag must be a full commit SHA'; exit 1; }
  sed -i "s/resilience-lab-service:main/resilience-lab-service:$LAB_IMAGE_TAG/g;s/resilience-lab-web:main/resilience-lab-web:$LAB_IMAGE_TAG/g" "$task_manifest_file"
fi
kubectl apply -f "$task_manifest_file"
for ns in lab lab-payment; do
 kubectl patch networkpolicy kube-api -n "$ns" --type=merge -p "{\"spec\":{\"egress\":[{\"to\":[{\"ipBlock\":{\"cidr\":\"$task_api_ip/32\"}},{\"ipBlock\":{\"cidr\":\"$task_api_service_ip/32\"}}],\"ports\":[{\"port\":443},{\"port\":6443}]}]}}"
done
if [[ "$overlay" == prod ]]; then
 kubectl annotate ingress web -n lab traefik.ingress.kubernetes.io/router.entrypoints=websecure traefik.ingress.kubernetes.io/router.tls=true traefik.ingress.kubernetes.io/router.tls.certresolver=lab --overwrite
fi
if ! kubectl rollout status deployment -n lab --timeout="${ROLLOUT_TIMEOUT:-600s}" || ! kubectl rollout status deployment -n lab-payment --timeout="${ROLLOUT_TIMEOUT:-600s}"; then
 echo 'Rollout failed; restoring previous application deployment revisions'; bash scripts/rollback.sh; exit 1
fi
echo "Deployed manifests for $LAB_HOST; run make smoke with BASE_URL to verify public routing."
