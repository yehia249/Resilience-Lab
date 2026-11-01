.PHONY: dev test deploy destroy smoke bench k3d-up k3d-down
dev:
	node scripts/setup-env.mjs
	docker compose up -d --build
test:
	pnpm lint
	pnpm typecheck
	pnpm test
	pnpm build
deploy:
	bash scripts/deploy.sh
destroy:
	@echo 'Destructive operation: review terraform plan -destroy first; no automatic destroy is performed.'
smoke:
	pnpm smoke
bench:
	pnpm bench
k3d-up:
	bash scripts/k3d-up.sh
k3d-down:
	k3d cluster delete resilience-lab
