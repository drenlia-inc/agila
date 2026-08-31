#!/usr/bin/env bash
# Dev/testing: point auth.agila.dev at the SAME nginx upstream as kanban.agila.dev.
# After the K8s build is live, change the proxy_pass / deploy.sh target to the cluster.
#
# On web03 (as root):
#   /root/bin/deploy.sh auth.agila.dev <same-ip:port-as-kanban>
# or run this script if you already have /etc/nginx/sites-dev/kanban.agila.dev*.
set -euo pipefail

KANBAN_HOST="${KANBAN_HOST:-kanban.agila.dev}"
AUTH_HOST="${AUTH_HOST:-auth.agila.dev}"
SITES_DIR="${SITES_DIR:-/etc/nginx/sites-dev}"

if [[ ! -d "$SITES_DIR" ]]; then
  echo "Expected $SITES_DIR on web03. Use: /root/bin/deploy.sh $AUTH_HOST <kanban-ip:port>" >&2
  exit 1
fi

src=""
for cand in "$SITES_DIR/${KANBAN_HOST}" "$SITES_DIR/${KANBAN_HOST}.conf" "$SITES_DIR/110-${KANBAN_HOST}.conf"; do
  if [[ -f "$cand" ]]; then
    src="$cand"
    break
  fi
done

if [[ -z "$src" ]]; then
  echo "Could not find a $KANBAN_HOST vhost under $SITES_DIR" >&2
  ls -1 "$SITES_DIR" >&2 || true
  exit 1
fi

dest="$SITES_DIR/${AUTH_HOST}.conf"
if [[ -f "$dest" ]]; then
  echo "Already exists: $dest" >&2
  exit 1
fi

sed "s/${KANBAN_HOST}/${AUTH_HOST}/g" "$src" > "$dest"
echo "Wrote $dest from $src (same upstream as $KANBAN_HOST)"

ln -sfn "$dest" "/etc/nginx/sites-enabled/${AUTH_HOST}.conf" 2>/dev/null || true
nginx -t
systemctl reload nginx

if command -v certbot >/dev/null 2>&1; then
  echo "Issuing cert for $AUTH_HOST (Cloudflare Access must bypass /.well-known/acme-challenge/*)"
  certbot --nginx -d "$AUTH_HOST" --non-interactive --agree-tos --redirect || true
fi

echo "Done. Retarget $AUTH_HOST to K8s later by changing proxy_pass in $dest (do not keep this clone forever)."
