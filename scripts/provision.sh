#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../infra/terraform"
case "${1:-plan}" in
 plan)
  terraform init -input=false
  terraform plan -out=reviewed.tfplan
  terraform show -no-color reviewed.tfplan
  echo 'No resources created. Review the exact plan and free-tier eligibility before approving apply.'
  ;;
 apply)
  test -f reviewed.tfplan || { echo 'Create and review a saved plan first'; exit 1; }
  printf 'Approve ONLY the reviewed Always Free plan. Type APPLY: '
  read -r approval
  [[ "$approval" == APPLY ]] || exit 1
  terraform apply reviewed.tfplan
  ;;
 *) echo 'Usage: bash scripts/provision.sh plan|apply'; exit 1 ;;
esac
