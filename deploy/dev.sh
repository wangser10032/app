#!/usr/bin/env bash
# ResiHub 开发容器（Linux / macOS 宿主机，或 CI）
#   ./deploy/dev.sh up | shell | logs | ps | down | destroy | doctor
set -euo pipefail

ACTION="${1:-up}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$HERE/docker-compose.dev.yml"

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

assert_docker() {
  docker info >/dev/null 2>&1 || { echo "Docker 守护进程未运行" >&2; exit 1; }
}

case "$ACTION" in
  up)
    assert_docker
    docker image inspect resihub-dev:node20 >/dev/null 2>&1 || dc build
    dc up -d
    dc ps
    ;;
  build)   assert_docker; dc build ;;
  shell)   assert_docker; dc exec dev bash ;;
  logs)    dc logs -f --tail 100 ;;
  ps)      dc ps ;;
  restart) dc restart ;;
  down)    dc down ;;
  destroy) dc down -v ;;
  doctor)
    assert_docker
    echo "docker  : $(docker --version)"
    echo "compose : $(docker compose version --short)"
    echo "vm      : $(docker info --format '{{.OperatingSystem}} / {{.OSType}} / {{.ServerVersion}}')"
    dc ps
    ;;
  *)
    echo "用法: $0 {up|build|shell|logs|ps|restart|down|destroy|doctor}" >&2
    exit 1
    ;;
esac
