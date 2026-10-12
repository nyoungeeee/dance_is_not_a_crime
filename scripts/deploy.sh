#!/usr/bin/env bash
# 서버에서 origin/main 최신 커밋으로 갱신한다.
# GitHub Actions 배포 키는 authorized_keys의 command= 옵션으로 이 스크립트만 실행할 수 있다.
# 새 버전이 헬스체크를 통과하지 못하면 직전 커밋으로 되돌려 다시 띄운다.
set -euo pipefail

# git이 실행 중에 이 파일을 바꿔도 안전하도록 전체를 함수로 읽은 뒤 실행한다.
main() {
  cd "$(dirname "$0")/.."
  exec 9>/tmp/dance-deploy.lock
  flock -n 9 || { echo "다른 배포가 진행 중이에요." >&2; exit 1; }

  local prev target port
  prev=$(git rev-parse HEAD)
  git fetch -q origin main
  target=$(git rev-parse origin/main)
  port=$(grep -sE '^HOST_PORT=' .env | cut -d= -f2 || true)
  port=${port:-3220}

  echo "현재 ${prev:0:7} → 대상 ${target:0:7}"
  test -f .env || { echo ".env가 없어요. .env.example을 복사해 채워주세요." >&2; exit 1; }
  docker compose exec -T web node dist/src/scripts/backup.js || echo "배포 전 백업 실패(계속 진행)" >&2
  git merge -q --ff-only origin/main

  if build_and_check "$port"; then
    docker image prune -f >/dev/null
    echo "배포 완료: $(git log --oneline -1)"
    return 0
  fi

  echo "헬스체크 실패. ${prev:0:7}로 되돌려요." >&2
  docker compose logs --tail 40 web >&2 || true
  git reset -q --hard "$prev"
  build_and_check "$port" || echo "되돌린 버전도 헬스체크 실패. 서버를 직접 확인해 주세요." >&2
  exit 1
}

build_and_check() {
  docker compose up -d --build --remove-orphans
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$1/api/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

main "$@"
exit
