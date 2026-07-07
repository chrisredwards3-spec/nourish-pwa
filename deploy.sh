#!/bin/sh
# Deploy to Cloudflare Pages. Stages app files into a temp dir first because
# `wrangler pages deploy` uploads everything in the directory it's given
# (including .git and .wrangler, which must not be served).
set -e
cd "$(dirname "$0")"
STAGE=$(mktemp -d)
cp index.html app.css app.js data.js manifest.json sw.js "$STAGE/"
mkdir "$STAGE/icons" && cp icons/*.png "$STAGE/icons/"
npx wrangler pages deploy "$STAGE" --project-name nourish --branch main
rm -rf "$STAGE"
