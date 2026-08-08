#!/usr/bin/env bash
# Watch the running task count while auto scaling does its thing.
# Usage: ./scripts/watch-tasks.sh qrhub-cluster qrhub-service
set -euo pipefail
CLUSTER="${1:-qrhub-cluster}"
SERVICE="${2:-qrhub-service}"

watch -n 5 "aws ecs describe-services \
  --cluster ${CLUSTER} --services ${SERVICE} --region ap-south-1 \
  --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount}' \
  --output table"
