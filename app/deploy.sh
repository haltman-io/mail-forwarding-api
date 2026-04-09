#!/bin/bash

set -euo pipefail

APP_NAME="mail-forwarding-api"

## Pull latest code
git pull --force

## Build before touching the running PM2 process
npm run build

## Reload in place when the app already exists; otherwise start it
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --only "$APP_NAME" --env production
else
  pm2 start ecosystem.config.cjs --only "$APP_NAME" --env production
fi

## Persist PM2 process list
pm2 save

## Join logs automatically
pm2 logs "$APP_NAME"
