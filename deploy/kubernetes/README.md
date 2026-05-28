# Plain Kubernetes manifests for Nemesis AI

An alternative to the Helm chart in `../helm/`. Use these if you don't run Helm
or want a small, fully-readable manifest set.

## Quick start

1. Build and push images to a registry your cluster can reach:

       docker compose build
       docker tag nemesis-ai-server:latest ghcr.io/your-org/nemesis-ai-server:v1.0.0
       docker tag nemesis-ai-client:latest ghcr.io/your-org/nemesis-ai-client:v1.0.0
       docker push ghcr.io/your-org/nemesis-ai-server:v1.0.0
       docker push ghcr.io/your-org/nemesis-ai-client:v1.0.0

2. Update image references in `30-server-deployment.yaml` and
   `31-client-deployment.yaml` to point at your registry.

3. Fill in secrets in `10-secret.yaml`:

       openssl rand -hex 48   # JWT_SECRET
       openssl rand -hex 32   # ENCRYPTION_KEY
       openssl rand -hex 24   # POSTGRES_PASSWORD
       openssl rand -hex 16   # HEALTH_TOKEN

   For production, replace the inline secret with a SealedSecret /
   ExternalSecret reference.

4. Update the ingress host in `40-ingress.yaml` and `CLIENT_ORIGIN` in
   `11-configmap.yaml`.

5. Apply:

       kubectl apply -k .

   …or from the repo root: `make k8s-apply`.

## What's included

| File | Resources |
|---|---|
| `00-namespace.yaml` | `Namespace nemesis-ai` |
| `10-secret.yaml` | `Secret nemesis-ai-secrets` (JWT, encryption key, DB password, LLM keys, SMTP) |
| `11-configmap.yaml` | `ConfigMap nemesis-ai-config` (non-secret env) |
| `20-postgres.yaml` | `StatefulSet` + `Service` + 20Gi PVC |
| `21-redis.yaml` | `StatefulSet` + `Service` + 5Gi PVC |
| `30-server-deployment.yaml` | `Deployment` + `Service` + 1Gi branding PVC |
| `31-client-deployment.yaml` | `Deployment` (2 replicas) + `Service` |
| `40-ingress.yaml` | nginx-ingress routing `/`, `/api`, `/health` |

The server runs `prisma migrate deploy` on container start, so the schema is
created on first boot.

## Production hardening checklist

- [ ] Replace `nemesis-postgres` with a managed Postgres (RDS, Cloud SQL).
      Point `DATABASE_URL` in the Secret at the managed URL.
- [ ] Replace `nemesis-redis` with managed Redis (ElastiCache, Memorystore).
- [ ] Set `replicas: 2` on the server Deployment (after enabling `RATE_LIMIT_REDIS=true` — already the default).
- [ ] Add `cert-manager.io/cluster-issuer` annotation to the Ingress for ACME TLS.
- [ ] Set resource `limits` matching your cluster capacity.
- [ ] Configure `SMTP_*` so verification, reset-password, and digest emails work.
- [ ] Configure `SENTRY_DSN` + `OTEL_EXPORTER_OTLP_ENDPOINT` for observability.
- [ ] Configure scheduled DB backups (the `restic` sidecar in `docker-compose.yml` is a
      pattern you can port to a CronJob).
