#!/bin/sh
# 数据库快照：在线备份 SQLite → 完整性校验 → 与 server/.env 一起打包 → 清理过期快照
# .env 中的 PROXY_CREDENTIAL_SECRET 用于解密租约凭据，必须与数据库一起保存。
#
#   APP_DIR=/workspace/app BACKUP_DIR=/workspace/backups KEEP_DAYS=14 sh deploy/backup-snapshot.sh
set -eu
APP_DIR="${APP_DIR:-/workspace/app}"
BACKUP_DIR="${BACKUP_DIR:-/workspace/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
NODE="${NODE:-node}"
umask 077
mkdir -p "$BACKUP_DIR"
stamp=$(date +%Y%m%d-%H%M%S)
work=$(mktemp -d "$BACKUP_DIR/.tmp-$stamp-XXXXXX")
trap 'rm -rf "$work"' EXIT
cd "$APP_DIR/server"
"$NODE" scripts/backup.js "$work/resihub.db" >/dev/null
result=$("$NODE" -e "const D=require('better-sqlite3');const d=new D(process.argv[1],{readonly:true});console.log(d.pragma('integrity_check',{simple:true}));d.close()" "$work/resihub.db")
[ "$result" = ok ] || { echo "integrity_check failed: $result" >&2; exit 1; }
cp .env "$work/server.env"
tar -czf "$BACKUP_DIR/resihub-$stamp.tar.gz" -C "$work" resihub.db server.env
find "$BACKUP_DIR" -maxdepth 1 -name 'resihub-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "snapshot: $BACKUP_DIR/resihub-$stamp.tar.gz ($(du -h "$BACKUP_DIR/resihub-$stamp.tar.gz" | cut -f1))"
