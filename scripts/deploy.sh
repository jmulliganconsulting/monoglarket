#!/bin/sh
# Blue/green deploy. Starts the idle app copy on the new image, waits until it passes /health, then stops the old copy. Caddy sends traffic to whichever copy is healthy.
# Usage: scripts/deploy.sh ghcr.io/owner/repo:sha   (run on the club host, from the repo folder)
# Rollback: run it again with the previous image tag.
set -eu
cd "$(dirname "$0")/.."
export APP_IMAGE=${1:?usage: scripts/deploy.sh <image>}

if [ -n "$(docker compose ps -q --status running app_blue)" ]; then OLD=blue NEW=red; else OLD=red NEW=blue; fi

docker compose up -d db caddy
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile # picks up Caddyfile changes

docker compose pull "app_$NEW"
docker compose up -d --no-deps "app_$NEW"

ID=$(docker compose ps -q "app_$NEW")
TRIES=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$ID")" = healthy ]; do
	TRIES=$((TRIES + 1))
	if [ "$TRIES" -gt 60 ]; then
		docker compose logs --tail 50 "app_$NEW" >&2
		docker compose stop "app_$NEW"
		echo "deploy: app_$NEW never became healthy; app_$OLD is still serving" >&2
		exit 1
	fi
	sleep 2
done

if [ -n "$(docker compose ps -q --status running "app_$OLD")" ]; then docker compose stop "app_$OLD"; fi # shortcut: stop is abrupt, so a request in flight on the old copy can fail; Caddy retries it on the new copy
docker image prune -f >/dev/null
echo "deploy: app_$NEW live on $APP_IMAGE"
