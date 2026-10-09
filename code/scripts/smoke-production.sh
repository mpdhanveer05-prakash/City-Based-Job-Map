#!/usr/bin/env bash
# Plain HTTP smoke checks of the production site, shared by deploy-production.yml and refresh-production-data.yml.
# The browser specs use the synthetic fixtures, which a real-data site does not have, so production gets these: the pages
# exist, carry a policy, say nothing about sample data, publish no /dev page, and build-info.json meets the deployment
# policy (lib/build-features.ts REQUIRED.production).
#
#   bash scripts/smoke-production.sh <site URL>
set -u
SITE="${1:?usage: smoke-production.sh <site URL>}"
SITE="${SITE%/}"
fail=0
for path in / /bangalore /chennai /suggest /sitemap.xml; do
  code=$(curl -s -o /tmp/page.html -w '%{http_code}' "$SITE$path")
  if [ "$code" != "200" ]; then echo "$path answered $code" >&2; fail=1; continue; fi
  case "$path" in
    /sitemap.xml) ;;
    *)
      grep -q 'http-equiv="Content-Security-Policy"' /tmp/page.html || { echo "$path has no Content-Security-Policy" >&2; fail=1; }
      # The sample-data notice and note, not the bare word: a real page's serialised props contain "synthetic":false.
      if grep -qE 'data-testid="(sample-data-notice|synthetic-note)"' /tmp/page.html; then echo "$path shows the sample-data notice" >&2; fail=1; fi
      if grep -q 'pilot-preview-banner' /tmp/page.html; then echo "$path is a pilot preview build" >&2; fail=1; fi
      ;;
  esac
done
code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/dev/tokens")
if [ "$code" = "200" ]; then echo "/dev/tokens is published" >&2; fail=1; fi
curl -s "$SITE/build-info.json" -o /tmp/build-info.json || true
python3 - <<'PY' || fail=1
import json, sys
try:
    info = json.load(open("/tmp/build-info.json"))
except Exception:
    sys.exit("build-info.json is missing from the production site")
missing = [f for f in ("basemap", "admin", "beacon", "feedback") if info.get("features", {}).get(f) is not True]
if info.get("target") != "production" or missing:
    sys.exit(f"production build-info.json: target {info.get('target')!r}, missing required features {missing}")
PY
exit $fail
