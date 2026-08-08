#!/usr/bin/env bash
# Build the QRHub image and push it to Amazon ECR.
# Usage: ./scripts/build-and-push.sh v1
set -euo pipefail

VERSION="${1:-v1}"
REGION="ap-south-1"
REPO="qrhub"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "==> Logging in to ECR: ${REGISTRY}"
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

echo "==> Building ${REPO}:${VERSION}"
docker build --platform linux/amd64 -t "${REPO}:${VERSION}" ./app

echo "==> Tagging and pushing"
docker tag "${REPO}:${VERSION}" "${REGISTRY}/${REPO}:${VERSION}"
docker tag "${REPO}:${VERSION}" "${REGISTRY}/${REPO}:latest"
docker push "${REGISTRY}/${REPO}:${VERSION}"
docker push "${REGISTRY}/${REPO}:latest"

echo "==> Done: ${REGISTRY}/${REPO}:${VERSION}"
