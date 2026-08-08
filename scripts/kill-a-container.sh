#!/usr/bin/env bash
# Part 1 vs Part 2 demo: kill the running container and see who (if anyone)
# brings it back.
#
#   Part 1 (plain docker on EC2):  nothing happens. It stays dead.
#   Part 2 (ECS on EC2):           ECS notices and starts a replacement.
set -euo pipefail

echo "==> Containers before:"
docker ps --format '  {{.Names}}  {{.Status}}'

ID="$(docker ps -q | head -n1)"
[ -z "$ID" ] && { echo "No running containers."; exit 1; }

echo "==> Killing ${ID}"
docker kill "$ID" >/dev/null

echo "==> Watching for 60 seconds..."
for i in $(seq 1 12); do
  sleep 5
  COUNT="$(docker ps -q | wc -l)"
  printf '  t+%-3ss  running containers: %s\n' "$((i*5))" "$COUNT"
done
