# Cost boundary

All backend services run on the existing workstation. The only public host is GitHub Pages using the existing public repository and GitHub account. No new account, payment method, paid resource or signup is required. Terraform and cloud workflows were removed when scope changed.

Local execution consumes electricity, disk, CPU and memory. The isolated WSL VM is configured for four CPUs, 5 GB memory and 2 GB swap on F:. These are machine limits, not a claim that all workloads fit a smaller budget. Dashboard CPU percentages explicitly use a two-core reference budget.

Pages serves static frontend assets and recordings. It cannot execute faults or transactions. Live use requires local Docker; autoscaling requires k3d. GitHub service limits apply, and no paid fallback is configured.
