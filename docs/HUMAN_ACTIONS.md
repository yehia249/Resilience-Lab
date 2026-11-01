# Personal steps — only when ready to deploy

1. Sign up for [Oracle Always Free](https://www.oracle.com/cloud/free/). Stay on the free account; do not upgrade. Oracle may request a card for identity verification: this must be your own decision and action. If you do not accept that requirement, no paid substitute is created.
2. In OCI: Profile → My profile → API keys → Add API key. Save the private key only in `%USERPROFILE%\.oci\resilience-lab-api.pem`. Save Oracle's generated config snippet under `[RESILIENCE_LAB]` in `%USERPROFILE%\.oci\config`. Do not paste keys into chat. In Linux/WSL the equivalent files are ~/.oci/config and ~/.oci/resilience-lab-api.pem with permissions 600.
3. Return to the engineer for the exact generated resource plan. Approve that plan before the first apply. The script is `bash scripts/provision.sh plan`, followed only after your review by `bash scripts/provision.sh apply` and typing APPLY. No resources have been created in advance.
4. Authenticate GitHub only if prompted, approve production/infrastructure environment protection, and record the 90-second demo using DEMO_SCRIPT.md. A domain is optional; the default is the VM's free IP.sslip.io hostname.

No other code-writing or installation work is assigned to you. Local verification and deployment automation are the engineer's responsibility. See STATUS.md for any unresolved verification before proceeding.
