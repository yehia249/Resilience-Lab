# Zero-dollar boundary

No cloud resources have been created. The intended runtime is one Always Free-eligible VM.Standard.A1.Flex in the tenancy's home region, fixed at 2 OCPUs and 12 GB memory, with one 50 GB balanced boot volume. Network: one VCN, internet gateway, route table, security list and subnet. No managed databases, paid load balancers, reserved public IPs, NAT gateways or additional volumes are requested.

Oracle's current [Always Free resource documentation](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) lists 1,500 A1 OCPU-hours and 9,000 GB-hours per month, equivalent to 2 OCPUs and 12 GB. Checked 2026-11-01. An existing allocation elsewhere in the tenancy consumes that allowance. The account must stay unupgraded. Free eligibility and current limits must be rechecked before an apply; Terraform alone cannot guarantee a bill of zero.

Application CPU/memory requests and limits are defined in scripts/generate-k8s.ts and generated manifests. Postgres, Redis and Prometheus persist on the VM's boot disk via local-path. Prometheus retains six hours and caps its TSDB at 2 GB; Jaeger retains at most 20,000 traces in memory. Resource requests are scheduling budgets, not measured runtime usage. HPA can produce more total CPU requests than the host can schedule; pending replicas during a spike must be reported honestly and limits tuned from measurements.

Cloudflare Pages is optional. The default deploy serves the frontend on the same VM, using a free sslip.io hostname and Traefik ACME TLS, so no separate provider account is necessary. GitHub public repository Actions and GHCR are used only within the account's available free allowance; no billing method is added.

Synthetic shopping traffic is useful exercise load. It does not guarantee protection against Oracle's idle-reclamation policy. Oracle can reclaim idle Always Free VMs based on its utilization criteria; monitor the tenancy and keep source and records recoverable. Never generate waste solely to defeat a provider policy.

OCI signup may require a card for identity verification. The engineer will not add a card or upgrade the account. If verification is unacceptable or ARM capacity is unavailable, the original spare-machine fallback needs an actual machine; none is currently available.
