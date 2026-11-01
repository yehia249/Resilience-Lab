# Deployment

No cloud deployment is claimed until STATUS.md records a verified public URL. The user currently has no Oracle account or spare host. See HUMAN_ACTIONS.md for the smallest personal steps. No paid alternative is provisioned automatically.

## Local

Requirements: Node 20.19+ (workstation Node 22 is also supported), pnpm 10.20, Docker Engine with Compose, kubectl and k3d for cluster verification. `pnpm install --frozen-lockfile`, `make dev`, `make smoke`, `pnpm test:e2e`. `make k3d-up` creates only the disposable resilience-lab local cluster, imports locally built images and deploys the local overlay at http://localhost:8089.

## OCI preparation and approval

OCI API configuration is read from ~/.oci/config using profile RESILIENCE_LAB. Keep the private API key in ~/.oci with owner-only permissions; never put its content into the chat or Git repository. Copy infra/terraform/terraform.tfvars.example to ignored terraform.tfvars and provide tenancy, home region, availability domain, Ubuntu ARM image ID, SSH public key and current IPv4 /32. Confirm there are no other A1 resources using the allowance and the image/shape are Always Free eligible. Only then set free_tier_reviewed=true.

Run `bash scripts/provision.sh plan`. This lists the actual resources and saves an ignored plan. Expected: one compartment, VCN, internet gateway, route table, security list, subnet and 2-OCPU/12-GB A1 VM with a 50-GB boot disk and ephemeral public IP. No apply occurs during planning. Review the entire plan and cost constraints. `bash scripts/provision.sh apply` requires typing APPLY and applies only that saved plan. Plan review and first apply approval are explicitly required by the user brief.

## Deploy reviewed images

The VM installs k3s and clones the public repo. CI must pass and publish public GHCR images for the exact commit SHA. If GHCR packages are private on first publication, set package visibility to public; no registry token is put into the VM. Create the production GitHub environment with required reviewers. Configure environment vars LAB_SSH (ubuntu@IP), LAB_HOST (IP.sslip.io), and secrets SSH_KEY, SSH_KNOWN_HOSTS (verify the host fingerprint independently before adding it). Never use ssh-keyscan without checking its result.

The VM needs Node and Python for the deploy helper, generated ignored .env, and kubectl access (sudo k3s kubectl). Cloud-init prepares OS/cluster; the deploy workflow runs `sudo LAB_HOST=... LAB_IMAGE_TAG=<full-green-SHA> bash scripts/deploy.sh`. The helper creates secrets without printing values, applies Kustomize, sets the free hostname, requests Traefik ACME TLS and waits for readiness. Configure a real ACME contact email in Traefik's HelmChartConfig before requesting production certificates. Then dispatch deploy.yml with the green SHA and approve the production environment. Smoke verifies the public API and failure triggers application rollback.

Cloudflare Pages is optional: the complete frontend can be served from the VM by default. Separate-origin Pages would require VITE_API_URL at build time plus matching SITE_ORIGIN/CSP; that path is not claimed as tested. No card or paid account is necessary for the VM-hosted frontend.

## Verification gates

Run smoke, dedicated chaos E2E, k6 baseline/spike/soak, benchmark runner and Lighthouse against the real target. Publish only real outputs. The benchmark runner preserves the public three-faults-per-ten-minutes rule, so forty runs take substantial time. Integration fixtures reset quotas only inside an isolated localhost Compose target; production benchmark runs do not. A recording still requires the owner's personal action.
