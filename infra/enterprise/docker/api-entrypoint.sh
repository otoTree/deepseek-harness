#!/bin/sh
set -eu

node apps/api/scripts/initialize-container.mjs &
initialization_pid=$!
trap 'kill -TERM "$initialization_pid" 2>/dev/null || true; wait "$initialization_pid" 2>/dev/null || true; exit 143' TERM INT
wait "$initialization_pid"
trap - TERM INT
unset ENTERPRISE_MIGRATION_URL ENTERPRISE_BOOTSTRAP_EMAIL ENTERPRISE_BOOTSTRAP_PASSWORD
exec "$@"
