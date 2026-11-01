.PHONY: dev test deploy destroy smoke bench record replay k3d-up k3d-down
dev:
	node scripts/setup-env.mjs
	docker compose up -d --build
test:
	pnpm lint
	pnpm typecheck
	pnpm test
	pnpm build
deploy:
	@echo 'Push main to publish with .github/workflows/pages.yml.'
destroy:
	docker compose down
smoke:
	pnpm smoke
bench:
	pnpm exec tsx scripts/record.ts
record: bench
replay:
	VITE_LAB_MODE=replay pnpm dev
k3d-up:
	bash scripts/k3d-up.sh
k3d-down:
	k3d cluster delete resilience-lab
