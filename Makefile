# Nemesis AI — one-command deployment shortcuts.
#
# Targets:
#   make secrets         Generate JWT_SECRET, ENCRYPTION_KEY, HEALTH_TOKEN, POSTGRES_PASSWORD into .env
#   make up              docker compose up -d --build
#   make down            docker compose down
#   make logs            docker compose logs -f
#   make ps              docker compose ps
#   make restart         docker compose restart
#   make build           Build server + client images without starting them
#   make migrate         Run Prisma migrations against the live DB
#   make seed            Seed dummy demo data
#   make backup-up       Start the optional restic backup sidecar
#   make k8s-apply       kubectl apply -k deploy/kubernetes/
#   make k8s-delete      kubectl delete -k deploy/kubernetes/
#   make helm-install    helm install nemesis ./deploy/helm/nemesis-ai
#   make tag REGISTRY=ghcr.io/your-org TAG=v1.0
#                        Tag local images for push to a registry
#   make push REGISTRY=ghcr.io/your-org TAG=v1.0
#                        Push tagged images to a registry
#   make clean           Stop everything and delete volumes (DESTROYS DATA)

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

COMPOSE ?= docker compose
ENV_FILE ?= .env
REGISTRY ?= nemesis-ai
TAG ?= local

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: secrets
secrets: ## Generate strong secrets and write .env (idempotent; skips if .env exists)
	@if [ -f $(ENV_FILE) ]; then \
	  echo "$(ENV_FILE) already exists — refusing to overwrite. Delete it first to regenerate."; \
	  exit 1; \
	fi
	@cp .env.example $(ENV_FILE)
	@JWT=$$(openssl rand -hex 48); \
	 ENC=$$(openssl rand -hex 32); \
	 HEALTH=$$(openssl rand -hex 16); \
	 PG=$$(openssl rand -hex 24); \
	 sed -i.bak \
	   -e "s|^JWT_SECRET=.*|JWT_SECRET=$$JWT|" \
	   -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$$ENC|" \
	   -e "s|^HEALTH_TOKEN=.*|HEALTH_TOKEN=$$HEALTH|" \
	   -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$PG|" \
	   $(ENV_FILE); \
	 rm -f $(ENV_FILE).bak
	@echo "Wrote $(ENV_FILE) with freshly-generated secrets."
	@echo "Edit it to set LLM_PROVIDER + LLM_API_KEY (or per-org via Settings)."

.PHONY: up
up: ## Build + start the whole stack (db, redis, server, client)
	@$(COMPOSE) up -d --build
	@echo ""
	@echo "Stack is up. Client at http://localhost:$${CLIENT_PORT:-8080}"
	@echo "Tail logs with: make logs"

.PHONY: down
down: ## Stop the stack (keeps data)
	@$(COMPOSE) down

.PHONY: ps
ps: ## Show container status
	@$(COMPOSE) ps

.PHONY: logs
logs: ## Tail logs from all services
	@$(COMPOSE) logs -f --tail=200

.PHONY: restart
restart: ## Restart all services
	@$(COMPOSE) restart

.PHONY: build
build: ## Build images without starting
	@$(COMPOSE) build

.PHONY: migrate
migrate: ## Run Prisma migrations in the running server container
	@$(COMPOSE) exec server npx prisma migrate deploy

.PHONY: seed
seed: ## Seed dummy demo data
	@$(COMPOSE) exec server npx tsx src/scripts/seedDummyData.ts

.PHONY: backup-up
backup-up: ## Start the restic backup sidecar (requires RESTIC_REPOSITORY + RESTIC_PASSWORD in .env)
	@$(COMPOSE) --profile backup up -d --build

.PHONY: k8s-apply
k8s-apply: ## Deploy to Kubernetes via plain manifests
	@kubectl apply -k deploy/kubernetes/

.PHONY: k8s-delete
k8s-delete: ## Tear down the Kubernetes deployment (keeps PVCs)
	@kubectl delete -k deploy/kubernetes/

.PHONY: helm-install
helm-install: ## Install via Helm with default values
	@helm install nemesis ./deploy/helm/nemesis-ai --create-namespace --namespace nemesis-ai

.PHONY: helm-upgrade
helm-upgrade: ## Upgrade the Helm release
	@helm upgrade nemesis ./deploy/helm/nemesis-ai --namespace nemesis-ai

.PHONY: tag
tag: ## Tag images for a registry. Usage: make tag REGISTRY=ghcr.io/your-org TAG=v1.0
	@docker tag $$($(COMPOSE) config --format json | jq -r '.services.server.image // empty') $(REGISTRY)/nemesis-ai-server:$(TAG) || \
	  docker tag nemesis-ai-server:latest $(REGISTRY)/nemesis-ai-server:$(TAG)
	@docker tag $$($(COMPOSE) config --format json | jq -r '.services.client.image // empty') $(REGISTRY)/nemesis-ai-client:$(TAG) || \
	  docker tag nemesis-ai-client:latest $(REGISTRY)/nemesis-ai-client:$(TAG)
	@echo "Tagged: $(REGISTRY)/nemesis-ai-{server,client}:$(TAG)"

.PHONY: push
push: ## Push tagged images. Run `make tag` first.
	@docker push $(REGISTRY)/nemesis-ai-server:$(TAG)
	@docker push $(REGISTRY)/nemesis-ai-client:$(TAG)

.PHONY: clean
clean: ## Stop everything and DELETE volumes (destroys all data)
	@read -p "This will delete all data (postgres, redis, branding). Type 'yes' to confirm: " confirm && [ "$$confirm" = "yes" ]
	@$(COMPOSE) down -v
