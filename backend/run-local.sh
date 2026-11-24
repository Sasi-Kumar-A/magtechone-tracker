#!/usr/bin/env sh
# Run the API against the local data/ folder (no GitHub needed). Needs JDK 17+.
set -e
cd "$(dirname "$0")"
rm -rf out && javac -d out $(find src -name "*.java")
AUTH_SECRET=${AUTH_SECRET:-local-dev-secret} STORE=local DATA_DIR=../data PORT=8080 java -cp out com.magtech.tracker.Main
