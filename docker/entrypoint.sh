#!/bin/sh
set -e
# Apply pending database migrations before starting (safe to run on every boot).
# Set RUN_MIGRATIONS=false when migrations are run by a separate release step.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations…"
  npx prisma migrate deploy
fi
exec "$@"
