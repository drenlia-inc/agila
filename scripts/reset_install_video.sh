#!/usr/bin/env bash
# reset_install_video.sh — wipe a Part 1 production walkthrough on a throwaway host.
#
# Goal: leave Part 1 packages fully absent (no ii/rc leftovers) and apt cache empty,
# so the next recording’s `apt install` recreates configs and log dirs like a new EC2.
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

# Package names we expect Part 1 to install (and this script to remove).
PART1_PKGS=(
  docker.io docker-compose-v2 docker-compose-plugin docker-buildx-plugin
  docker-ce docker-ce-cli containerd.io containerd runc
  python3-certbot-nginx certbot
  nginx nginx-core nginx-common
  ufw
)

if [[ "${PURGE_BASE_UTILS}" -eq 1 ]]; then
  PART1_PKGS+=(git curl ca-certificates openssl dnsutils)
fi

# True if any of the named packages are still installed (ii) or removed-but-config (rc).
packages_still_present() {
  local pkg status
  for pkg in "$@"; do
    status="$(dpkg-query -W -f='${Status}' "${pkg}" 2>/dev/null || true)"
    case "${status}" in
      *\ installed|*\ config-files) return 0 ;;
    esac
  done
  return 1
}

# List packages still in ii or rc state (for diagnostics).
list_present_packages() {
  local pkg status
  for pkg in "$@"; do
    status="$(dpkg-query -W -f='${Status}' "${pkg}" 2>/dev/null || true)"
    case "${status}" in
      *\ installed|*config-files*)
        printf '  - %s (%s)\n' "${pkg}" "${status}"
        ;;
    esac
  done
}

# Packages known to dpkg among PART1_PKGS (skip never-installed names).
installed_or_config_pkgs() {
  local pkg status
  for pkg in "$@"; do
    status="$(dpkg-query -W -f='${Status}' "${pkg}" 2>/dev/null || true)"
    case "${status}" in
      *\ installed|*config-files*)
        printf '%s\n' "${pkg}"
        ;;
    esac
  done
}

echo
echo "==> [1/7] Docker Compose down"
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

echo "==> [2/7] Stop services (before purge)"
systemctl stop nginx 2>/dev/null || true
systemctl stop certbot.timer certbot.service 2>/dev/null || true
if command -v docker >/dev/null 2>&1; then
  docker ps -aq 2>/dev/null | xargs -r docker rm -f 2>/dev/null || true
  docker system prune -a --volumes -f 2>/dev/null || true
  docker builder prune -a -f 2>/dev/null || true
  docker volume ls -q 2>/dev/null | xargs -r docker volume rm -f 2>/dev/null || true
  docker network ls -q --filter type=custom 2>/dev/null | xargs -r docker network rm 2>/dev/null || true
fi
systemctl stop docker.socket docker.service containerd 2>/dev/null || true

echo "==> [3/7] Let's Encrypt (while certbot is still installed)"
if [[ -n "${DOMAIN}" ]] && command -v certbot >/dev/null 2>&1; then
  certbot delete --cert-name "${DOMAIN}" --non-interactive 2>/dev/null \
    || certbot delete -d "${DOMAIN}" --non-interactive 2>/dev/null \
    || true
fi

echo "==> [4/7] UFW"
if command -v ufw >/dev/null 2>&1; then
  ufw --force delete allow 'Nginx Full' 2>/dev/null || true
  ufw --force delete allow 80/tcp 2>/dev/null || true
  ufw --force delete allow 443/tcp 2>/dev/null || true
  ufw --force disable 2>/dev/null || true
fi

echo "==> [5/7] apt purge Part 1 packages (must succeed)"
export DEBIAN_FRONTEND=noninteractive

# Do NOT delete package-owned paths (e.g. /var/log/nginx) while packages are
# still ii/rc — that leaves "already installed" packages with missing dirs and
# the next apt install will not recreate them. Purge first; reinstall recreates.

mapfile -t TO_PURGE < <(installed_or_config_pkgs "${PART1_PKGS[@]}")
if [[ "${#TO_PURGE[@]}" -gt 0 ]]; then
  echo "    Purging: ${TO_PURGE[*]}"
  apt-get purge -y "${TO_PURGE[@]}"
  apt-get autoremove -y --purge

  # Force-remove any leftover config-files (rc) rows for the Part 1 set
  mapfile -t STILL_RC < <(installed_or_config_pkgs "${PART1_PKGS[@]}")
  if [[ "${#STILL_RC[@]}" -gt 0 ]]; then
    echo "    dpkg --purge leftovers: ${STILL_RC[*]}"
    dpkg --purge "${STILL_RC[@]}"
  fi
else
  echo "    no Part 1 packages present"
fi

if packages_still_present "${PART1_PKGS[@]}"; then
  echo "ERROR: Part 1 packages still present after purge:" >&2
  list_present_packages "${PART1_PKGS[@]}" >&2
  echo "Fix package state before re-running Part 1 (do not mkdir log dirs by hand)." >&2
  exit 1
fi

echo "==> [6/7] Remove leftover data dirs (packages already gone)"
# Safe only after the verification above. Log dirs are intentionally omitted —
# the next apt install of nginx/certbot recreates /var/log/nginx and
# /var/log/letsencrypt via package postinst.
rm -rf /var/lib/docker /var/lib/containerd /etc/docker \
       /var/lib/letsencrypt /etc/letsencrypt \
       /var/cache/nginx /etc/nginx 2>/dev/null || true

rm -f /etc/apt/sources.list.d/docker*.list \
      /etc/apt/keyrings/docker.gpg \
      /etc/apt/keyrings/docker.asc 2>/dev/null || true

# Empty the package download cache so the next Part 1 install downloads again.
apt-get clean
rm -rf /var/cache/apt/archives/*.deb /var/cache/apt/archives/partial/* 2>/dev/null || true
apt-get update -y

echo "==> [7/7] Delete agila clone"
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

# Final sanity check
if packages_still_present "${PART1_PKGS[@]}"; then
  echo "ERROR: packages reappeared or were not fully removed:" >&2
  list_present_packages "${PART1_PKGS[@]}" >&2
  exit 1
fi

echo
echo "=== Reset complete ==="
echo "Part 1 packages are absent (no ii/rc leftovers); apt cache cleared."
echo "Next recording: follow DOCKER.md Part 1 from apt install onward."
echo "  apt install will recreate nginx/certbot configs and log directories."
echo "Preferred for 'new EC2' footage: launch a new instance instead of reuse."
echo
