#!/usr/bin/env bash
# reset_install_video.sh — wipe a Part 1 production walkthrough on a throwaway host.
#
# Goal: leave the machine with Part 1 packages NOT installed and apt cache empty,
# so the next recording starts with the same apt install commands as a new EC2.
#
# This is still not identical to a brand-new AMI (cloud-init, machine-id, etc.).
# For a true “freshly deployed EC2” take, terminate and launch a new instance.
#
# Usage:
#   sudo bash scripts/reset_install_video.sh --domain kanban.example.com
#   sudo bash scripts/reset_install_video.sh -y --domain kanban.example.com --agila-dir /home/ubuntu/agila
#
# Destructive. Demo / video VMs only.

set -euo pipefail

DOMAIN=""
AGILA_DIR=""
ASSUME_YES=0
PURGE_BASE_UTILS=0

usage() {
  cat <<'EOF'
Usage: sudo bash reset_install_video.sh [options]

Options:
  --domain FQDN       Certificate name to delete before purging certbot
  --agila-dir PATH    Path to the cloned agila repo (default: detect or ~/agila)
  --purge-base-utils  Also apt-purge git curl ca-certificates openssl dnsutils
  -y, --yes           Skip the confirmation prompt
  -h, --help          Show this help

For a walkthrough that must look like a brand-new EC2, prefer launching a new
instance instead of resetting an existing one.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --agila-dir) AGILA_DIR="${2:-}"; shift 2 ;;
    --purge-base-utils) PURGE_BASE_UTILS=1; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." 2>/dev/null && pwd || true)"

if [[ -z "${AGILA_DIR}" ]]; then
  if [[ -f "${REPO_ROOT}/docker-compose-prod.yml" || -f "${REPO_ROOT}/docker-compose.yml" ]]; then
    AGILA_DIR="${REPO_ROOT}"
  elif [[ -d "${HOME}/agila" ]]; then
    AGILA_DIR="${HOME}/agila"
  elif [[ -d /home/ubuntu/agila ]]; then
    AGILA_DIR=/home/ubuntu/agila
  else
    AGILA_DIR=""
  fi
fi

if [[ -z "${DOMAIN}" ]]; then
  if [[ -f /etc/nginx/sites-available/agila ]]; then
    DOMAIN="$(awk '/server_name/ {print $2; exit}' /etc/nginx/sites-available/agila | tr -d '|;')"
  fi
  if [[ -z "${DOMAIN}" && -n "${AGILA_DIR}" && -f "${AGILA_DIR}/docker-compose.yml" ]]; then
    DOMAIN="$(grep -E 'ALLOWED_ORIGINS=' "${AGILA_DIR}/docker-compose.yml" | head -1 \
      | sed -E 's/.*ALLOWED_ORIGINS=([^[:space:]]+).*/\1/' | tr -d '"' || true)"
  fi
  if [[ -z "${DOMAIN}" || "${DOMAIN}" == "mydomainname.tld" ]]; then
    read -r -p "FQDN used for nginx / Let's Encrypt (blank to skip named cert delete): " DOMAIN
  fi
fi

echo
echo "=== Agila Part 1 video reset ==="
echo "  agila dir : ${AGILA_DIR:-"(none)"}"
echo "  domain    : ${DOMAIN:-"(none)"}"
echo
echo "Will remove: Compose stack, all Docker data, certs, Part 1 apt packages,"
echo "apt download cache, and the agila clone."
echo
echo "NOTE: A reset host is not the same as a newly launched EC2 AMI."
echo "      For the recording, prefer a new instance if you need that story."
echo

if [[ "${ASSUME_YES}" -ne 1 ]]; then
  read -r -p "Type RESET to continue: " confirm
  if [[ "${confirm}" != "RESET" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

run_as_invoke_user() {
  local user="${SUDO_USER:-}"
  if [[ -n "${user}" && "${user}" != "root" ]]; then
    sudo -u "${user}" -H "$@"
  else
    "$@"
  fi
}

echo
echo "==> [1/6] Docker Compose down"
if [[ -n "${AGILA_DIR}" && -d "${AGILA_DIR}" && -f "${AGILA_DIR}/docker-compose.yml" ]]; then
  (
    cd "${AGILA_DIR}"
    if command -v docker >/dev/null 2>&1; then
      run_as_invoke_user docker compose down -v --remove-orphans 2>/dev/null \
        || docker compose down -v --remove-orphans 2>/dev/null \
        || true
    fi
  )
else
  echo "    skip"
fi

echo "==> [2/6] Remove all Docker engine data"
if command -v docker >/dev/null 2>&1; then
  docker ps -aq 2>/dev/null | xargs -r docker rm -f 2>/dev/null || true
  docker system prune -a --volumes -f 2>/dev/null || true
  docker builder prune -a -f 2>/dev/null || true
  docker volume ls -q 2>/dev/null | xargs -r docker volume rm -f 2>/dev/null || true
  docker network ls -q --filter type=custom 2>/dev/null | xargs -r docker network rm 2>/dev/null || true
fi
systemctl stop docker.socket docker.service containerd 2>/dev/null || true

echo "==> [3/6] Let's Encrypt (before purging certbot)"
if [[ -n "${DOMAIN}" ]] && command -v certbot >/dev/null 2>&1; then
  certbot delete --cert-name "${DOMAIN}" --non-interactive 2>/dev/null \
    || certbot delete -d "${DOMAIN}" --non-interactive 2>/dev/null \
    || true
fi

echo "==> [4/6] UFW"
if command -v ufw >/dev/null 2>&1; then
  ufw --force delete allow 'Nginx Full' 2>/dev/null || true
  ufw --force delete allow 80/tcp 2>/dev/null || true
  ufw --force delete allow 443/tcp 2>/dev/null || true
  ufw --force disable 2>/dev/null || true
fi

echo "==> [5/6] apt purge Part 1 packages + clear apt cache"
export DEBIAN_FRONTEND=noninteractive

# Do NOT manually delete /etc/nginx (or other conffiles) while packages are
# still installed — that makes the next "apt install nginx" skip restoring
# those paths. Let purge remove packages and their conffiles cleanly.

PKGS=(
  docker.io docker-compose-v2 docker-compose-plugin docker-buildx-plugin
  docker-ce docker-ce-cli containerd.io containerd runc
  python3-certbot-nginx certbot
  nginx nginx-core nginx-common
  ufw
)

if [[ "${PURGE_BASE_UTILS}" -eq 1 ]]; then
  PKGS+=(git curl ca-certificates openssl dnsutils)
fi

apt-get purge -y "${PKGS[@]}" 2>/dev/null || true
apt-get autoremove -y --purge 2>/dev/null || true

# Engine / cert leftovers that packages may leave behind after purge
rm -rf /var/lib/docker /var/lib/containerd /etc/docker \
       /var/lib/letsencrypt /etc/letsencrypt /var/log/letsencrypt \
       /var/log/nginx /var/cache/nginx 2>/dev/null || true

# Only remove nginx/letsencrypt config dirs if packages are actually gone
if ! dpkg -l nginx nginx-common 2>/dev/null | grep -q '^ii'; then
  rm -rf /etc/nginx 2>/dev/null || true
fi

rm -f /etc/apt/sources.list.d/docker*.list \
      /etc/apt/keyrings/docker.gpg \
      /etc/apt/keyrings/docker.asc 2>/dev/null || true

# Empty the package download cache so the next Part 1 install is not served
# only from local .debs (downloads again like a new instance).
apt-get clean
rm -rf /var/cache/apt/archives/*.deb /var/cache/apt/archives/partial/* 2>/dev/null || true
apt-get update -y 2>/dev/null || true

echo "==> [6/6] Delete agila clone"
if [[ -n "${AGILA_DIR}" && -d "${AGILA_DIR}" ]]; then
  if [[ -f "${AGILA_DIR}/docker-compose-prod.yml" \
     || -f "${AGILA_DIR}/Dockerfile.prod" \
     || -f "${AGILA_DIR}/package.json" ]]; then
    rm -rf "${AGILA_DIR}"
    echo "    Removed ${AGILA_DIR}"
  else
    echo "    Refusing to delete ${AGILA_DIR} (does not look like agila)"
  fi
fi

if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  gpasswd -d "${SUDO_USER}" docker 2>/dev/null || true
fi

echo
echo "=== Reset complete ==="
echo "Part 1 packages should be absent; apt cache cleared."
echo "Next recording: follow DOCKER.md Part 1 from apt install onward."
echo "Preferred for 'new EC2' footage: launch a new instance instead of reuse."
echo
