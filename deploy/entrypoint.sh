#!/bin/sh
set -eu
mkdir -p "${DATA_DIR:-/data}"
export OIL_EXTERNAL_LOCK=1
exec flock --no-fork --nonblock "${DATA_DIR:-/data}/instance.lock" node /app/server/index.mjs
