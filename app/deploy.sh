#!/bin/bash

## Pull
git pull --force

## PM2 Delete
pm2 delete mail-forwarding-api

## PM2 Start
pm2 start ecosystem.config.cjs

## PM2 Save
pm2 save

## Join logs automatically
pm2 logs mail-forwarding-api