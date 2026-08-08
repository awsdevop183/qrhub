#!/usr/bin/env bash
# Hammer the CPU-burn endpoint so the ECS service scales out on camera.
# Usage: ./scripts/load-test.sh https://ecs.aws365.shop 40
set -euo pipefail

URL="${1:?usage: ./load-test.sh <alb-url> [concurrency]}"
CONCURRENCY="${2:-40}"

echo "==> Sending sustained CPU load to ${URL} with ${CONCURRENCY} workers"
echo "==> Press Ctrl+C to stop"

for i in $(seq 1 "${CONCURRENCY}"); do
  ( while true; do curl -s -o /dev/null "${URL}/api/load?ms=4000"; done ) &
done
wait
