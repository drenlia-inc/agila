#!/bin/bash

# Easy Kanban PostgreSQL Multi-Tenant Kubernetes Deployment Script

set -e

# Function to display usage
usage() {
    echo "Usage: $0 <instance_name> <plan> [--i-understand-shared-crypto]"
    echo ""
    echo "Parameters:"
    echo "  instance_name  - The instance hostname (e.g., my-instance-name)"
    echo "  plan          - License plan: 'basic' or 'pro'"
    echo "  --i-understand-shared-crypto"
    echo "      Required only when this run would change shared JWT_SECRET or"
    echo "      SETTINGS_ENCRYPTION_KEY vs what is already live (affects ALL tenants)."
    echo ""
    echo "Example:"
    echo "  $0 my-company basic"
    echo "  $0 enterprise pro"
    echo ""
    echo "This will deploy Easy Kanban accessible at: https://my-company.\${TENANT_DOMAIN}"
    echo ""
    echo "Note: Instance token is automatically generated on first deployment"
    echo "      and preserved for all subsequent deployments."
    echo "      First-time setup (no live ConfigMap) does not require crypto confirmation."
    exit 1
}

# Function to generate a secure random token
generate_instance_token() {
    # Generate a 64-character hexadecimal token (256 bits of entropy)
    if command -v openssl &> /dev/null; then
        openssl rand -hex 32
    elif command -v shuf &> /dev/null; then
        # Fallback: use /dev/urandom with shuf
        cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 64 | head -n 1
    else
        # Last resort: use /dev/urandom with od
        od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    fi
}

# Check parameters (optional crypto override flag)
FORCE_SHARED_CRYPTO_IMPACT=false
POSITIONAL_ARGS=()
for arg in "$@"; do
    case "$arg" in
        --i-understand-shared-crypto)
            FORCE_SHARED_CRYPTO_IMPACT=true
            ;;
        -h|--help)
            usage
            ;;
        *)
            POSITIONAL_ARGS+=("$arg")
            ;;
    esac
done

if [ ${#POSITIONAL_ARGS[@]} -ne 2 ]; then
    echo "❌ Error: Missing required parameters"
    usage
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCE_NAME="${POSITIONAL_ARGS[0]}"
PLAN="${POSITIONAL_ARGS[1]}"
# Use pg namespace for PostgreSQL deployments
NAMESPACE="easy-kanban-pg"
# TENANT_DOMAIN: explicit env > live ConfigMap > local configmap-pg.yaml > agila.dev
DOMAIN="${TENANT_DOMAIN:-}"
# Tenant ID is the instance name (extracted from hostname by middleware)
TENANT_ID="${INSTANCE_NAME}"

# PostgreSQL password (hardcoded for now, will use vault later)
POSTGRES_PASSWORD="kanban_password"

# Validate instance name (alphanumeric and hyphens only)
if [[ ! "$INSTANCE_NAME" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
    echo "❌ Error: Instance name must contain only lowercase letters, numbers, and hyphens"
    echo "   Must start and end with alphanumeric characters"
    exit 1
fi

# Validate plan
if [[ "$PLAN" != "basic" && "$PLAN" != "pro" ]]; then
    echo "❌ Error: Plan must be 'basic' or 'pro'"
    exit 1
fi

# Set license configuration based on plan (must match admin plan_features catalog)
if [[ "$PLAN" == "basic" ]]; then
    USER_LIMIT="5"
    TASK_LIMIT="-1"  # unlimited
    BOARD_LIMIT="10"
    STORAGE_LIMIT="107374182400"  # 100 GiB in bytes
    SUPPORT_LEVEL="basic"
    AI_TIER="off"
else
    USER_LIMIT="50"
    TASK_LIMIT="-1"  # unlimited
    BOARD_LIMIT="-1" # unlimited
    STORAGE_LIMIT="-1"  # unlimited* (soft fair-use enforced in app)
    SUPPORT_LEVEL="pro"
    AI_TIER="full"
fi

# Generate random JWT secret (overwritten from local configmap-pg.yaml when present)
JWT_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
# Shared app ↔ runner bearer (preserved if secret already exists — see ensure block)
RUNNER_TOKEN=$(openssl rand -hex 32)
# Dedicated settings-at-rest key (independent of JWT; preserved if Secret already exists)
SETTINGS_ENCRYPTION_KEY=$(openssl rand -hex 32)

# Initialize RECOVERED_TOKEN variable
RECOVERED_TOKEN=""

echo "🚀 Deploying Easy Kanban PostgreSQL instance: ${INSTANCE_NAME}"
echo "📍 Namespace: ${NAMESPACE}"
echo "📋 Plan: ${PLAN} (${SUPPORT_LEVEL})"
echo "👥 User Limit: ${USER_LIMIT}"
echo "📝 Task Limit: ${TASK_LIMIT}"
echo "📊 Board Limit: ${BOARD_LIMIT}"
echo "💾 Storage Limit: ${STORAGE_LIMIT}"

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed or not in PATH"
    exit 1
fi

# Check if cluster is accessible
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster"
    exit 1
fi

echo "✅ Kubernetes cluster is accessible"

# Prefer local (gitignored) manifests with real secrets; fall back to *.example templates
resolve_manifest() {
    local base="$1"
    if [ -f "${SCRIPT_DIR}/${base}" ]; then
        echo "${SCRIPT_DIR}/${base}"
    elif [ -f "${SCRIPT_DIR}/${base}.example" ]; then
        echo "   ℹ️  Using ${base}.example (copy to ${base} for local secrets)" >&2
        echo "${SCRIPT_DIR}/${base}.example"
    else
        echo "❌ Missing ${SCRIPT_DIR}/${base} or ${base}.example" >&2
        exit 1
    fi
}

# Resolve shared tenant DNS suffix (e.g. agila.dev)
if [ -z "${DOMAIN}" ]; then
    DOMAIN=$(kubectl get configmap easy-kanban-config-pg -n "${NAMESPACE}" -o jsonpath='{.data.TENANT_DOMAIN}' 2>/dev/null || true)
fi
if [ -z "${DOMAIN}" ]; then
    DOMAIN=$(python3 - "$(resolve_manifest configmap-pg.yaml)" <<'PY' 2>/dev/null || true
import sys
try:
    import yaml
except ImportError:
    sys.exit(0)
with open(sys.argv[1]) as f:
    doc = yaml.safe_load(f) or {}
print((doc.get("data") or {}).get("TENANT_DOMAIN") or "", end="")
PY
)
fi
DOMAIN="${DOMAIN:-agila.dev}"
FULL_HOSTNAME="${INSTANCE_NAME}.${DOMAIN}"
echo "🌐 Hostname: ${FULL_HOSTNAME} (TENANT_DOMAIN=${DOMAIN})"

# Read a data./stringData. value from a simple ConfigMap/Secret YAML (python3 + PyYAML).
yaml_string_field() {
    local file="$1"
    local section="$2" # data | stringData
    local key="$3"
    python3 - "$file" "$section" "$key" <<'PY'
import sys
try:
    import yaml
except ImportError:
    sys.exit(0)
path, section, key = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    doc = yaml.safe_load(f) or {}
val = (doc.get(section) or {}).get(key)
if val is None:
    sys.exit(0)
print(val, end="")
PY
}

# Shared JWT / SETTINGS_ENCRYPTION_KEY affect every tenant. Interrupt only when a live
# key would change vs local manifests (first-time setup = no live ConfigMap → no prompt).
validate_shared_crypto_keys() {
    echo ""
    echo "🔐 Shared crypto preflight (all tenants)..."

    local local_cm
    local_cm="$(resolve_manifest configmap-pg.yaml)"
    local local_jwt
    local_jwt="$(yaml_string_field "${local_cm}" data JWT_SECRET || true)"

    local local_crypto_src=""
    if [ -f "${SCRIPT_DIR}/settings-crypto-secret-pg.yaml" ]; then
        local_crypto_src="${SCRIPT_DIR}/settings-crypto-secret-pg.yaml"
    elif [ -f "${SCRIPT_DIR}/settings-crypto-secret-pg.yaml.example" ]; then
        local_crypto_src="${SCRIPT_DIR}/settings-crypto-secret-pg.yaml.example"
    fi
    local local_settings_key=""
    if [ -n "${local_crypto_src}" ]; then
        local_settings_key="$(yaml_string_field "${local_crypto_src}" stringData SETTINGS_ENCRYPTION_KEY || true)"
        if [ -z "${local_settings_key}" ]; then
            local_settings_key="$(yaml_string_field "${local_crypto_src}" data SETTINGS_ENCRYPTION_KEY || true)"
        fi
    fi

    local live_jwt=""
    local live_settings_key=""
    local live_pod_settings=""
    local has_live_cm=false

    if kubectl get configmap easy-kanban-config-pg -n "${NAMESPACE}" &>/dev/null; then
        has_live_cm=true
        live_jwt=$(kubectl get configmap easy-kanban-config-pg -n "${NAMESPACE}" -o jsonpath='{.data.JWT_SECRET}' 2>/dev/null || true)
    fi
    if kubectl get secret easy-kanban-settings-crypto -n "${NAMESPACE}" &>/dev/null; then
        live_settings_key=$(kubectl get secret easy-kanban-settings-crypto -n "${NAMESPACE}" -o jsonpath='{.data.SETTINGS_ENCRYPTION_KEY}' 2>/dev/null | base64 -d 2>/dev/null || true)
    fi
    local pod_name
    pod_name=$(kubectl get pods -n "${NAMESPACE}" -l app=easy-kanban -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
    if [ -n "${pod_name}" ]; then
        live_pod_settings=$(kubectl exec -n "${NAMESPACE}" "${pod_name}" -c easy-kanban -- printenv SETTINGS_ENCRYPTION_KEY 2>/dev/null || true)
    fi

    # Effective key pods use for enc:v1 (explicit SETTINGS_ENCRYPTION_KEY, else JWT fallback)
    local live_effective="${live_pod_settings}"
    if [ -z "${live_effective}" ]; then
        live_effective="${live_jwt}"
    fi

    echo "   Local ConfigMap source: ${local_cm}"
    echo "   Live ConfigMap:         ${has_live_cm}"
    echo "   Pod SETTINGS_ENCRYPTION_KEY set: $([ -n "${live_pod_settings}" ] && echo yes || echo no)"

    if [ "${has_live_cm}" != "true" ]; then
        echo "   ✅ No live shared ConfigMap — first-time setup, no crypto confirmation needed"
        return 0
    fi

    local impacts=()

    # JWT: local file has a real value different from live
    if [ -n "${local_jwt}" ] && [ "${local_jwt}" != "JWT_SECRET_PLACEHOLDER" ] \
        && [ -n "${live_jwt}" ] && [ "${local_jwt}" != "${live_jwt}" ]; then
        impacts+=("JWT_SECRET: local configmap-pg.yaml differs from live ConfigMap (would re-key ALL tenants)")
    fi

    # SETTINGS_ENCRYPTION_KEY: local secret file has a real value different from live Secret
    if [ -n "${local_settings_key}" ] && [ "${local_settings_key}" != "SETTINGS_ENCRYPTION_KEY_PLACEHOLDER" ] \
        && [ -n "${live_settings_key}" ] && [ "${live_settings_key}" != "SETTINGS_ENCRYPTION_KEY_PLACEHOLDER" ] \
        && [ "${local_settings_key}" != "${live_settings_key}" ]; then
        impacts+=("SETTINGS_ENCRYPTION_KEY: local settings-crypto-secret-pg.yaml differs from live Secret")
    fi

    # Mounting a Secret that differs from the effective in-pod key (usually JWT fallback today)
    if [ -n "${live_settings_key}" ] && [ "${live_settings_key}" != "SETTINGS_ENCRYPTION_KEY_PLACEHOLDER" ] \
        && [ -n "${live_effective}" ] && [ "${live_settings_key}" != "${live_effective}" ]; then
        impacts+=("SETTINGS_ENCRYPTION_KEY: live Secret differs from effective in-pod key — mounting it would change decrypt for ALL tenants")
    fi

    if [ ${#impacts[@]} -eq 0 ]; then
        echo "   ✅ Local crypto keys match live (or no conflicting local override) — continuing"
        return 0
    fi

    echo ""
    echo "⚠️  Shared crypto impact detected (affects EVERY tenant in ${NAMESPACE}):"
    local i
    for i in "${impacts[@]}"; do
        echo "   - ${i}"
    done
    echo ""
    echo "   After a key change you must re-enter encrypted Admin secrets"
    echo "   (SMTP / Google SSO / S3 / AI) for each tenant."
    echo ""

    if [ "${FORCE_SHARED_CRYPTO_IMPACT}" = "true" ]; then
        echo "   ✅ Continuing because --i-understand-shared-crypto was set"
        return 0
    fi

    echo "   Re-run with --i-understand-shared-crypto to proceed, or sync local"
    echo "   configmap-pg.yaml / settings-crypto-secret-pg.yaml to the live values."
    exit 1
}

validate_shared_crypto_keys

# Create temporary directory for generated manifests
TEMP_DIR=$(mktemp -d)
echo "📁 Using temporary directory: ${TEMP_DIR}"

# Function to generate manifests
generate_manifests() {
    echo ""
    echo "🔧 Generating Kubernetes manifests..."
    echo "   📝 Creating deployment manifests in ${TEMP_DIR}..."

    # Ensure namespace exists
    if ! kubectl get namespace "${NAMESPACE}" &>/dev/null; then
        echo "   📦 Creating namespace..."
        kubectl apply -f "${SCRIPT_DIR}/namespace-pg.yaml"
    fi
    
    # Ensure PostgreSQL secret exists (create only — never overwrite live password)
    echo "   🔐 Ensuring PostgreSQL secret exists..."
    if kubectl get secret postgres-secret -n "${NAMESPACE}" &>/dev/null; then
        echo "   ✅ PostgreSQL secret already exists"
    else
        # Create secret from template
        sed -e "s/easy-kanban-pg/${NAMESPACE}/g" \
            -e "s/change-me-in-production/${POSTGRES_PASSWORD}/g" \
            -e "s/POSTGRES_PASSWORD_PLACEHOLDER/${POSTGRES_PASSWORD}/g" \
            "$(resolve_manifest postgres-secret-pg.yaml)" > "${TEMP_DIR}/postgres-secret.yaml"
        kubectl apply -f "${TEMP_DIR}/postgres-secret.yaml"
        echo "   ✅ PostgreSQL secret created"
    fi
    
    # Ensure PostgreSQL is deployed
    echo "   🐘 Ensuring PostgreSQL is deployed..."
    if ! kubectl get deployment postgres -n "${NAMESPACE}" &>/dev/null; then
        echo "   🐘 Deploying PostgreSQL..."
        kubectl apply -f "${SCRIPT_DIR}/postgres-pvc-pg.yaml"
        kubectl apply -f "${SCRIPT_DIR}/postgres-deployment-pg.yaml"
        kubectl apply -f "${SCRIPT_DIR}/postgres-service-pg.yaml"
        echo "   ⏳ Waiting for PostgreSQL to be ready..."
        kubectl wait --for=condition=available --timeout=300s deployment/postgres -n "${NAMESPACE}" || {
            echo "   ⚠️  PostgreSQL may still be starting"
        }
    else
        echo "   ✅ PostgreSQL already deployed"
    fi
    
    # Ensure Redis is deployed (required for Socket.IO session sharing)
    echo "   🗄️  Ensuring Redis is deployed..."
    if ! kubectl get deployment redis -n "${NAMESPACE}" &>/dev/null; then
        echo "   🗄️  Deploying Redis (required for Socket.IO session sharing)..."
        kubectl apply -f "${SCRIPT_DIR}/redis-deployment-pg.yaml"
        echo "   ⏳ Waiting for Redis to be ready..."
        kubectl wait --for=condition=available --timeout=300s deployment/redis -n "${NAMESPACE}" || {
            echo "   ⚠️  Redis may still be starting"
        }
    else
        echo "   ✅ Redis already deployed"
    fi

    # Shared agent runner (one for all tenants, like postgres/redis)
    echo "   🤖 Ensuring kanban-runner is deployed..."
    if kubectl get secret kanban-runner-secret -n "${NAMESPACE}" &>/dev/null; then
        EXISTING_RUNNER_TOKEN=$(kubectl get secret kanban-runner-secret -n "${NAMESPACE}" -o jsonpath='{.data.RUNNER_TOKEN}' 2>/dev/null | base64 -d 2>/dev/null || true)
        if [ -n "${EXISTING_RUNNER_TOKEN}" ]; then
            RUNNER_TOKEN="${EXISTING_RUNNER_TOKEN}"
            echo "   ✅ Reusing existing kanban-runner-secret"
        fi
    fi
    sed -e "s/easy-kanban-pg/${NAMESPACE}/g" \
        -e "s/RUNNER_TOKEN_PLACEHOLDER/${RUNNER_TOKEN}/g" \
        "$(resolve_manifest runner-secret-pg.yaml)" > "${TEMP_DIR}/runner-secret.yaml"
    kubectl apply -f "${TEMP_DIR}/runner-secret.yaml"

    # Settings encryption key (independent of JWT; never change if Secret already set)
    echo "   🔐 Ensuring easy-kanban-settings-crypto Secret..."
    SETTINGS_CRYPTO_SKIP_APPLY=false
    if kubectl get secret easy-kanban-settings-crypto -n "${NAMESPACE}" &>/dev/null; then
        EXISTING_SETTINGS_KEY=$(kubectl get secret easy-kanban-settings-crypto -n "${NAMESPACE}" -o jsonpath='{.data.SETTINGS_ENCRYPTION_KEY}' 2>/dev/null | base64 -d 2>/dev/null || true)
        if [ -n "${EXISTING_SETTINGS_KEY}" ] && [ "${EXISTING_SETTINGS_KEY}" != "SETTINGS_ENCRYPTION_KEY_PLACEHOLDER" ]; then
            SETTINGS_ENCRYPTION_KEY="${EXISTING_SETTINGS_KEY}"
            SETTINGS_CRYPTO_SKIP_APPLY=true
            echo "   ✅ SETTINGS_ENCRYPTION_KEY already set — leaving Secret unchanged"
        fi
    fi
    if [ "${SETTINGS_CRYPTO_SKIP_APPLY}" != "true" ]; then
        # Prefer a real value from local settings-crypto-secret-pg.yaml when present
        LOCAL_CRYPTO_SRC="$(resolve_manifest settings-crypto-secret-pg.yaml)"
        LOCAL_SETTINGS_KEY="$(yaml_string_field "${LOCAL_CRYPTO_SRC}" stringData SETTINGS_ENCRYPTION_KEY || true)"
        if [ -z "${LOCAL_SETTINGS_KEY}" ]; then
            LOCAL_SETTINGS_KEY="$(yaml_string_field "${LOCAL_CRYPTO_SRC}" data SETTINGS_ENCRYPTION_KEY || true)"
        fi
        if [ -n "${LOCAL_SETTINGS_KEY}" ] && [ "${LOCAL_SETTINGS_KEY}" != "SETTINGS_ENCRYPTION_KEY_PLACEHOLDER" ]; then
            SETTINGS_ENCRYPTION_KEY="${LOCAL_SETTINGS_KEY}"
            echo "   ✅ Creating SETTINGS_ENCRYPTION_KEY from local settings-crypto secret manifest"
        else
            echo "   ✅ Creating new random SETTINGS_ENCRYPTION_KEY"
        fi
        SETTINGS_CRYPTO_SRC="${SCRIPT_DIR}/settings-crypto-secret-pg.yaml.example"
        if [ ! -f "${SETTINGS_CRYPTO_SRC}" ]; then
            SETTINGS_CRYPTO_SRC="$(resolve_manifest settings-crypto-secret-pg.yaml)"
        fi
        SETTINGS_KEY_ESC=$(printf '%s' "${SETTINGS_ENCRYPTION_KEY}" | sed -e 's/[\/&]/\\&/g')
        sed -e "s/easy-kanban-pg/${NAMESPACE}/g" \
            -e "s/SETTINGS_ENCRYPTION_KEY_PLACEHOLDER/${SETTINGS_KEY_ESC}/g" \
            "${SETTINGS_CRYPTO_SRC}" > "${TEMP_DIR}/settings-crypto-secret.yaml"
        kubectl apply -f "${TEMP_DIR}/settings-crypto-secret.yaml"
    fi

    # Platform-managed S3 credentials (optional; preserve existing values on redeploy)
    echo "   🔐 Ensuring easy-kanban-managed-s3 Secret..."
    MANAGED_S3_ACCESS_KEY_ID="${MANAGED_S3_ACCESS_KEY_ID:-MANAGED_S3_ACCESS_KEY_ID_PLACEHOLDER}"
    MANAGED_S3_SECRET_ACCESS_KEY="${MANAGED_S3_SECRET_ACCESS_KEY:-MANAGED_S3_SECRET_ACCESS_KEY_PLACEHOLDER}"
    if kubectl get secret easy-kanban-managed-s3 -n "${NAMESPACE}" &>/dev/null; then
        EXISTING_S3_AK=$(kubectl get secret easy-kanban-managed-s3 -n "${NAMESPACE}" -o jsonpath='{.data.MANAGED_S3_ACCESS_KEY_ID}' 2>/dev/null | base64 -d 2>/dev/null || true)
        EXISTING_S3_SK=$(kubectl get secret easy-kanban-managed-s3 -n "${NAMESPACE}" -o jsonpath='{.data.MANAGED_S3_SECRET_ACCESS_KEY}' 2>/dev/null | base64 -d 2>/dev/null || true)
        if [ -n "${EXISTING_S3_AK}" ] && [ "${EXISTING_S3_AK}" != "MANAGED_S3_ACCESS_KEY_ID_PLACEHOLDER" ]; then
            MANAGED_S3_ACCESS_KEY_ID="${EXISTING_S3_AK}"
            echo "   ✅ Reusing existing MANAGED_S3_ACCESS_KEY_ID"
        fi
        if [ -n "${EXISTING_S3_SK}" ] && [ "${EXISTING_S3_SK}" != "MANAGED_S3_SECRET_ACCESS_KEY_PLACEHOLDER" ]; then
            MANAGED_S3_SECRET_ACCESS_KEY="${EXISTING_S3_SK}"
            echo "   ✅ Reusing existing MANAGED_S3_SECRET_ACCESS_KEY"
        fi
    fi
    # Escape sed special chars in secret values (& and \)
    MANAGED_S3_AK_ESC=$(printf '%s' "${MANAGED_S3_ACCESS_KEY_ID}" | sed -e 's/[\/&]/\\&/g')
    MANAGED_S3_SK_ESC=$(printf '%s' "${MANAGED_S3_SECRET_ACCESS_KEY}" | sed -e 's/[\/&]/\\&/g')
    sed -e "s/easy-kanban-pg/${NAMESPACE}/g" \
        -e "s/MANAGED_S3_ACCESS_KEY_ID_PLACEHOLDER/${MANAGED_S3_AK_ESC}/g" \
        -e "s/MANAGED_S3_SECRET_ACCESS_KEY_PLACEHOLDER/${MANAGED_S3_SK_ESC}/g" \
        "$(resolve_manifest managed-s3-secret-pg.yaml)" > "${TEMP_DIR}/managed-s3-secret.yaml"
    kubectl apply -f "${TEMP_DIR}/managed-s3-secret.yaml"

    if ! kubectl get deployment kanban-runner -n "${NAMESPACE}" &>/dev/null; then
        echo "   🤖 Deploying kanban-runner..."
        sed -e "s/easy-kanban-pg/${NAMESPACE}/g" \
            "${SCRIPT_DIR}/runner-deployment-pg.yaml" > "${TEMP_DIR}/runner-deployment.yaml"
        kubectl apply -f "${TEMP_DIR}/runner-deployment.yaml"
        kubectl wait --for=condition=available --timeout=180s deployment/kanban-runner -n "${NAMESPACE}" || {
            echo "   ⚠️  kanban-runner may still be starting (image must be pushed first)"
        }
    else
        echo "   ✅ kanban-runner already deployed"
        sed -e "s/easy-kanban-pg/${NAMESPACE}/g" \
            "${SCRIPT_DIR}/runner-deployment-pg.yaml" > "${TEMP_DIR}/runner-deployment.yaml"
        kubectl apply -f "${TEMP_DIR}/runner-deployment.yaml"
    fi
    
    # Generate ConfigMap for PostgreSQL
    # All tenants share the same ConfigMap with MULTI_TENANT=true
    # Prefer local configmap-pg.yaml (gitignored secrets); fall back to example template
    # NOTE: INSTANCE_TOKEN_PLACEHOLDER will be replaced later after checking existing ConfigMap
    CONFIGMAP_SRC="$(resolve_manifest configmap-pg.yaml)"
    # Leave STARTUP_TENANT_ID empty in the generated ConfigMap. Pre-init of one
    # tenant on a shared multi-tenant Deployment races across replicas and can
    # pollute public after DROP SCHEMA. Tenants are created on first request.
    sed -e "s/easy-kanban-pg/${NAMESPACE}/g" \
        -e "s/JWT_SECRET_PLACEHOLDER/${JWT_SECRET}/g" \
        -e "s/APP_VERSION_PLACEHOLDER//g" \
        "${CONFIGMAP_SRC}" > "${TEMP_DIR}/configmap.yaml"
    
    # Generate app deployment (shared for all tenants)
    sed -e "s/easy-kanban-pg/${NAMESPACE}/g" \
        "${SCRIPT_DIR}/app-deployment-pg.yaml" > "${TEMP_DIR}/app-deployment.yaml"
    
    # Generate services (shared for all tenants) - both ClusterIP and NodePort
    sed -e "s/easy-kanban-pg/${NAMESPACE}/g" \
        "${SCRIPT_DIR}/service-pg.yaml" > "${TEMP_DIR}/service.yaml"
    
    # Generate ingress rule for this specific tenant hostname
    # ingress.yaml defaults to namespace easy-kanban; PG services live in easy-kanban-pg only.
    sed -e "s/easy-kanban-pg/${NAMESPACE}/g" \
        -e "s/^  namespace: easy-kanban$/  namespace: ${NAMESPACE}/g" \
        -e "s/easy-kanban.local/${FULL_HOSTNAME}/g" \
        -e "s/name: easy-kanban-ingress/name: easy-kanban-ingress-${INSTANCE_NAME}/g" \
        "${SCRIPT_DIR}/ingress.yaml" > "${TEMP_DIR}/ingress.yaml"
    
    echo "   ✅ Manifests generated successfully"
}

# Generate manifests
generate_manifests

# Apply shared ConfigMap (only if it doesn't exist)
echo ""
echo "📦 Step 1/7: Applying ConfigMap..."
if kubectl get configmap easy-kanban-config-pg -n "${NAMESPACE}" &>/dev/null; then
    echo "   ⚙️  Shared ConfigMap already exists"
    # Check if STARTUP_TENANT_ID is already set
    CURRENT_STARTUP_TENANT=$(kubectl get configmap easy-kanban-config-pg -n "${NAMESPACE}" -o jsonpath='{.data.STARTUP_TENANT_ID}' 2>/dev/null || echo "")
    CURRENT_INSTANCE_TOKEN=$(kubectl get configmap easy-kanban-config-pg -n "${NAMESPACE}" -o jsonpath='{.data.INSTANCE_TOKEN}' 2>/dev/null || echo "")
    CURRENT_JWT_SECRET=$(kubectl get configmap easy-kanban-config-pg -n "${NAMESPACE}" -o jsonpath='{.data.JWT_SECRET}' 2>/dev/null || echo "")
    LOCAL_JWT_FROM_FILE="$(yaml_string_field "$(resolve_manifest configmap-pg.yaml)" data JWT_SECRET || true)"

    # Preserve live JWT unless operator confirmed applying a different local value
    if [ -n "$CURRENT_JWT_SECRET" ] && [ "$CURRENT_JWT_SECRET" != "JWT_SECRET_PLACEHOLDER" ]; then
        if [ "${FORCE_SHARED_CRYPTO_IMPACT}" = "true" ] \
            && [ -n "${LOCAL_JWT_FROM_FILE}" ] \
            && [ "${LOCAL_JWT_FROM_FILE}" != "JWT_SECRET_PLACEHOLDER" ] \
            && [ "${LOCAL_JWT_FROM_FILE}" != "${CURRENT_JWT_SECRET}" ]; then
            echo "   ⚠️  Applying local JWT_SECRET from configmap-pg.yaml (--i-understand-shared-crypto)"
            JWT_SECRET="${LOCAL_JWT_FROM_FILE}"
        else
            echo "   ℹ️  JWT_SECRET already set — leaving unchanged"
            JWT_SECRET="$CURRENT_JWT_SECRET"
            python3 - "$TEMP_DIR/configmap.yaml" "$CURRENT_JWT_SECRET" <<'PY' || true
import sys
path, jwt = sys.argv[1], sys.argv[2]
try:
    import yaml
except ImportError:
    sys.exit(0)
with open(path) as f:
    doc = yaml.safe_load(f)
if not doc or "data" not in doc:
    sys.exit(0)
doc["data"]["JWT_SECRET"] = jwt
with open(path, "w") as f:
    yaml.safe_dump(doc, f, default_flow_style=False, sort_keys=False)
PY
        fi
    fi
    
    # Preserve existing INSTANCE_TOKEN to avoid pod restart
    if [ -n "$CURRENT_INSTANCE_TOKEN" ] && [ "$CURRENT_INSTANCE_TOKEN" != "" ] && [ "$CURRENT_INSTANCE_TOKEN" != '""' ]; then
        echo "   ℹ️  INSTANCE_TOKEN already set (shared for all tenants, preserving to avoid pod restart)"
        ESCAPED_TOKEN=$(echo "$CURRENT_INSTANCE_TOKEN" | sed 's/[[\.*^$()+?{|]/\\&/g')
        sed -i "s/INSTANCE_TOKEN_PLACEHOLDER/${ESCAPED_TOKEN}/g" "${TEMP_DIR}/configmap.yaml"
        RECOVERED_TOKEN="$CURRENT_INSTANCE_TOKEN"
    else
        # ConfigMap exists but token is missing - check if pod exists
        if kubectl get deployment easy-kanban -n "${NAMESPACE}" &>/dev/null; then
            echo "   🔍 Attempting to recover INSTANCE_TOKEN from running pod..."
            POD_NAME=$(kubectl get pods -n "${NAMESPACE}" -l app=easy-kanban -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
            if [ -n "$POD_NAME" ]; then
                POD_TOKEN=$(kubectl exec -n "${NAMESPACE}" "${POD_NAME}" -- printenv INSTANCE_TOKEN 2>/dev/null || echo "")
                if [ -n "$POD_TOKEN" ] && [ "$POD_TOKEN" != "" ]; then
                    echo "   ✅ Recovered INSTANCE_TOKEN from pod environment: ${POD_TOKEN:0:20}..."
                    ESCAPED_TOKEN=$(echo "$POD_TOKEN" | sed 's/[[\.*^$()+?{|]/\\&/g')
                    sed -i "s/INSTANCE_TOKEN_PLACEHOLDER/${ESCAPED_TOKEN}/g" "${TEMP_DIR}/configmap.yaml"
                    RECOVERED_TOKEN="$POD_TOKEN"
                else
                    echo "   ⚠️  Could not recover token - generating new one"
                    GENERATED_TOKEN=$(generate_instance_token)
                    ESCAPED_TOKEN=$(echo "$GENERATED_TOKEN" | sed 's/[[\.*^$()+?{|]/\\&/g')
                    sed -i "s/INSTANCE_TOKEN_PLACEHOLDER/${ESCAPED_TOKEN}/g" "${TEMP_DIR}/configmap.yaml"
                    RECOVERED_TOKEN="$GENERATED_TOKEN"
                fi
            else
                echo "   ⚠️  No running pod found - generating new token"
                GENERATED_TOKEN=$(generate_instance_token)
                ESCAPED_TOKEN=$(echo "$GENERATED_TOKEN" | sed 's/[[\.*^$()+?{|]/\\&/g')
                sed -i "s/INSTANCE_TOKEN_PLACEHOLDER/${ESCAPED_TOKEN}/g" "${TEMP_DIR}/configmap.yaml"
                RECOVERED_TOKEN="$GENERATED_TOKEN"
            fi
        else
            echo "   🔑 Generating new INSTANCE_TOKEN (new deployment)"
            GENERATED_TOKEN=$(generate_instance_token)
            ESCAPED_TOKEN=$(echo "$GENERATED_TOKEN" | sed 's/[[\.*^$()+?{|]/\\&/g')
            sed -i "s/INSTANCE_TOKEN_PLACEHOLDER/${ESCAPED_TOKEN}/g" "${TEMP_DIR}/configmap.yaml"
            RECOVERED_TOKEN="$GENERATED_TOKEN"
        fi
    fi
    
    # STARTUP_TENANT_ID: keep empty (or preserve existing empty). Never point the
    # shared Deployment at the tenant being deployed — that races 3 replicas and
    # leaves stale dbCache after destroy.
    if [ -n "$CURRENT_STARTUP_TENANT" ]; then
        echo "   ℹ️  Clearing STARTUP_TENANT_ID (was '${CURRENT_STARTUP_TENANT}') — tenants init on first request"
    else
        echo "   ℹ️  STARTUP_TENANT_ID left empty (tenants init on first request)"
    fi
    # Generated manifest already has STARTUP_TENANT_ID: ""
    kubectl apply -f "${TEMP_DIR}/configmap.yaml"
    if [ -n "$CURRENT_STARTUP_TENANT" ]; then
        CONFIGMAP_UPDATED=true
    else
        CONFIGMAP_UPDATED=false
    fi
else
    echo "   ⚙️  Creating shared ConfigMap..."
    GENERATED_TOKEN=$(generate_instance_token)
    ESCAPED_TOKEN=$(echo "$GENERATED_TOKEN" | sed 's/[[\.*^$()+?{|]/\\&/g')
    sed -i "s/INSTANCE_TOKEN_PLACEHOLDER/${ESCAPED_TOKEN}/g" "${TEMP_DIR}/configmap.yaml"
    RECOVERED_TOKEN="$GENERATED_TOKEN"
    kubectl apply -f "${TEMP_DIR}/configmap.yaml"
    CONFIGMAP_UPDATED=false
fi
echo "   ✅ ConfigMap ready"

# Get actual token from ConfigMap
ACTUAL_INSTANCE_TOKEN_FROM_CONFIGMAP=$(kubectl get configmap easy-kanban-config-pg -n "${NAMESPACE}" -o jsonpath='{.data.INSTANCE_TOKEN}' 2>/dev/null || echo "")
if [ -n "$ACTUAL_INSTANCE_TOKEN_FROM_CONFIGMAP" ] && [ "$ACTUAL_INSTANCE_TOKEN_FROM_CONFIGMAP" != "" ]; then
    ACTUAL_INSTANCE_TOKEN="$ACTUAL_INSTANCE_TOKEN_FROM_CONFIGMAP"
elif [ -n "$RECOVERED_TOKEN" ] && [ "$RECOVERED_TOKEN" != "" ]; then
    ACTUAL_INSTANCE_TOKEN="$RECOVERED_TOKEN"
else
    ACTUAL_INSTANCE_TOKEN=$(generate_instance_token)
fi

# Check storage (NFS for attachments/avatars)
echo ""
echo "📦 Step 2/7: Checking storage..."
echo "   📦 Using shared NFS storage for attachments and avatars"
PVC_ATTACHMENTS_EXISTS=$(kubectl get pvc easy-kanban-shared-pvc-attachments -n easy-kanban &>/dev/null && echo "yes" || echo "no")
PVC_AVATARS_EXISTS=$(kubectl get pvc easy-kanban-shared-pvc-avatars -n easy-kanban &>/dev/null && echo "yes" || echo "no")

if [ "$PVC_ATTACHMENTS_EXISTS" = "yes" ] && [ "$PVC_AVATARS_EXISTS" = "yes" ]; then
    echo "   ✅ All shared PVCs exist"
else
    echo "   ⚠️  Warning: Some shared PVCs not found:"
    [ "$PVC_ATTACHMENTS_EXISTS" = "no" ] && echo "      - easy-kanban-shared-pvc-attachments missing"
    [ "$PVC_AVATARS_EXISTS" = "no" ] && echo "      - easy-kanban-shared-pvc-avatars missing"
fi

# Deploy shared application (apply manifest so env like SETTINGS_ENCRYPTION_KEY stays in sync)
echo ""
echo "📦 Step 3/7: Deploying application..."
kubectl apply -f "${TEMP_DIR}/app-deployment.yaml"
if kubectl get deployment easy-kanban -n "${NAMESPACE}" &>/dev/null; then
    echo "   🎯 Application deployment applied (shared for all tenants)"
    if [ "$CONFIGMAP_UPDATED" = "true" ]; then
        echo "   🔄 ConfigMap updated (cleared STARTUP_TENANT_ID), waiting for rollout..."
        kubectl rollout status deployment/easy-kanban -n "${NAMESPACE}" --timeout=120s || echo "   ⚠️  Rollout may still be in progress"
    else
        echo "   ℹ️  Waiting for rollout if spec changed (e.g. new env refs)..."
        kubectl rollout status deployment/easy-kanban -n "${NAMESPACE}" --timeout=180s || echo "   ⚠️  Rollout may still be in progress"
    fi
else
    echo "   ⚠️  Deployment object missing after apply"
fi

# Apply shared services (only if not already deployed)
echo ""
echo "📦 Step 4/7: Applying services..."
if kubectl get service easy-kanban-service -n "${NAMESPACE}" &>/dev/null; then
    echo "   🔗 Shared services already exist, skipping..."
else
    echo "   🔗 Creating shared services..."
    kubectl apply -f "${TEMP_DIR}/service.yaml"
    echo "   ✅ Services created"
fi

# Apply ingress rule for this tenant
echo ""
echo "📦 Step 5/7: Applying ingress..."
INGRESS_NAME="easy-kanban-ingress-${INSTANCE_NAME}"
if kubectl get ingress "${INGRESS_NAME}" -n "${NAMESPACE}" &>/dev/null; then
    echo "   🌐 Ingress rule '${INGRESS_NAME}' already exists, updating..."
    kubectl apply -f "${TEMP_DIR}/ingress.yaml"
    echo "   ✅ Ingress rule updated"
else
    echo "   🌐 Creating ingress rule for tenant: ${FULL_HOSTNAME}..."
    kubectl apply -f "${TEMP_DIR}/ingress.yaml"
    echo "   ✅ Ingress rule created"
fi

# Apply WebSocket ingress rule (shared ingress with sticky sessions for all tenants)
echo ""
echo "📦 Step 5b/6: Applying WebSocket ingress..."
WEBSOCKET_INGRESS_NAME="easy-kanban-websocket-ingress-pg"
if kubectl get ingress "${WEBSOCKET_INGRESS_NAME}" -n "${NAMESPACE}" &>/dev/null; then
    echo "   🔌 WebSocket ingress already exists, checking if hostname needs to be added..."
    EXISTING_HOST=$(kubectl get ingress "${WEBSOCKET_INGRESS_NAME}" -n "${NAMESPACE}" -o jsonpath="{.spec.rules[?(@.host=='${FULL_HOSTNAME}')].host}" 2>/dev/null || echo "")
    if [ -n "$EXISTING_HOST" ]; then
        echo "   ✅ Hostname '${FULL_HOSTNAME}' already exists in WebSocket ingress"
    else
        echo "   ➕ Adding hostname '${FULL_HOSTNAME}' to WebSocket ingress..."
        if ! command -v jq &> /dev/null; then
            echo "   ⚠️  Warning: jq is not installed. Cannot automatically add hostname to WebSocket ingress."
            echo "   💡 Please manually add '${FULL_HOSTNAME}' to the WebSocket ingress rules and TLS hosts"
        else
            CURRENT_INGRESS_JSON=$(kubectl get ingress "${WEBSOCKET_INGRESS_NAME}" -n "${NAMESPACE}" -o json)
            UPDATED_INGRESS=$(echo "$CURRENT_INGRESS_JSON" | jq --arg hostname "$FULL_HOSTNAME" '
                .spec.rules += [{
                    "host": $hostname,
                    "http": {
                        "paths": [{
                            "path": "/socket.io/",
                            "pathType": "Prefix",
                            "backend": {
                                "service": {
                                    "name": "easy-kanban-service",
                                    "port": {
                                        "number": 80
                                    }
                                }
                            }
                        }]
                    }
                }] |
                if .spec.tls and (.spec.tls | length > 0) then
                    .spec.tls[0].hosts += [$hostname]
                else
                    .
                end
            ')
            echo "$UPDATED_INGRESS" | kubectl apply -f -
            echo "   ✅ WebSocket ingress updated with hostname '${FULL_HOSTNAME}'"
        fi
    fi
else
    echo "   🔌 Creating WebSocket ingress with hostname '${FULL_HOSTNAME}'..."
    cat > "${TEMP_DIR}/ingress-websocket.yaml" <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${WEBSOCKET_INGRESS_NAME}
  namespace: ${NAMESPACE}
  labels:
    app: easy-kanban
    component: websocket
  annotations:
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/affinity-mode: "persistent"
    nginx.ingress.kubernetes.io/session-cookie-name: "socket-io-route"
    nginx.ingress.kubernetes.io/session-cookie-expires: "172800"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "172800"
    nginx.ingress.kubernetes.io/session-cookie-path: "/"
    nginx.ingress.kubernetes.io/session-cookie-samesite: "Lax"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/use-forwarded-headers: "true"
spec:
  ingressClassName: nginx
  rules:
  - host: ${FULL_HOSTNAME}
    http:
      paths:
      - path: /socket.io/
        pathType: Prefix
        backend:
          service:
            name: easy-kanban-service
            port:
              number: 80
  tls:
  - hosts:
    - ${FULL_HOSTNAME}
    secretName: easy-kanban-tls
EOF
    kubectl apply -f "${TEMP_DIR}/ingress-websocket.yaml"
    echo "   ✅ WebSocket ingress created"
fi

# Initialize tenant schema in PostgreSQL by making a request to the app
echo ""
echo "📦 Step 7/7: Initializing tenant schema..."
echo "   🔄 Waiting for pod to be ready..."
POD_READY=false
MAX_WAIT=60
WAIT_COUNT=0
POD_NAME=""
while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    POD_NAME=$(kubectl get pods -n "${NAMESPACE}" -l app=easy-kanban -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    if [ -n "$POD_NAME" ]; then
        POD_STATUS=$(kubectl get pod "${POD_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
        if [ "$POD_STATUS" = "Running" ]; then
            READY=$(kubectl get pod "${POD_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
            if [ "$READY" = "true" ]; then
                POD_READY=true
                break
            fi
        fi
    fi
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

if [ "$POD_READY" = "true" ] && [ -n "$POD_NAME" ]; then
    echo "   ✅ Pod is ready"
    echo "   🔄 Triggering schema initialization for tenant '${TENANT_ID}'..."
    
    SERVICE_URL="http://easy-kanban-service.${NAMESPACE}.svc.cluster.local"
    INIT_OUTPUT=$(kubectl exec -n "${NAMESPACE}" "${POD_NAME}" -- \
        node -e "
        const http = require('http');
        const options = {
            hostname: 'easy-kanban-service.${NAMESPACE}.svc.cluster.local',
            port: 80,
            path: '/health',
            method: 'GET',
            headers: {
                'Host': '${FULL_HOSTNAME}',
                'X-Forwarded-Host': '${FULL_HOSTNAME}'
            },
            timeout: 5000
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200 || res.statusCode === 503) {
                    console.log('SUCCESS');
                } else {
                    console.log('FAILED: ' + res.statusCode);
                }
            });
        });
        req.on('error', (e) => { console.log('ERROR: ' + e.message); });
        req.on('timeout', () => { req.destroy(); console.log('TIMEOUT'); });
        req.end();
        " 2>&1)
    
    if echo "$INIT_OUTPUT" | grep -q "SUCCESS"; then
        echo "   ✅ Tenant schema initialized successfully"
    else
        echo "   ⚠️  Could not verify schema initialization (will be created on first request)"
    fi
else
    echo "   ⚠️  Pod not ready after ${MAX_WAIT}s, schema will be created on first request"
fi

# Get the external IP and NodePort information
EXTERNAL_IP=""
NODEPORT=""
INGRESS_IP=$(kubectl get ingress "${INGRESS_NAME}" -n "${NAMESPACE}" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")

# Always get NodePort information for admin portal (frontend port for web access)
NODEPORT=$(kubectl get service easy-kanban-nodeport -n "${NAMESPACE}" -o jsonpath='{.spec.ports[?(@.name=="frontend")].nodePort}' 2>/dev/null || echo "")
if [ -n "$NODEPORT" ]; then
    # Get node IP for NodePort access
    NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="ExternalIP")].address}' 2>/dev/null)
    if [ -z "$NODE_IP" ]; then
        NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null)
    fi
    if [ -z "$NODE_IP" ]; then
        NODE_IP="localhost"
    fi
    EXTERNAL_IP="$NODE_IP:$NODEPORT"
fi

echo ""
echo "✅ Deployment completed successfully!"
echo ""
echo "🔎 Verify DNS → Ingress → Service → pods for ${FULL_HOSTNAME}:"
echo "   ${SCRIPT_DIR}/verify-tenant-routing-pg.sh ${INSTANCE_NAME}"

# Clean up temporary files
rm -rf "${TEMP_DIR}"

# Return the IP and port information for programmatic use
echo ""
echo "📤 DEPLOYMENT_RESULT:"
echo "INSTANCE_NAME=${INSTANCE_NAME}"
echo "NAMESPACE=${NAMESPACE}"
echo "HOSTNAME=${FULL_HOSTNAME}"
echo "EXTERNAL_IP=${EXTERNAL_IP}"
echo "NODEPORT=${NODEPORT}"
echo "INSTANCE_TOKEN=${ACTUAL_INSTANCE_TOKEN}"
echo "STORAGE_DATA_PATH=postgresql://postgres:5432/easykanban (schema: ${INSTANCE_NAME})"
echo "STORAGE_ATTACHMENTS_PATH=/data/nfs-server/attachments/tenants/${INSTANCE_NAME}"
echo "STORAGE_AVATARS_PATH=/data/nfs-server/avatars/tenants/${INSTANCE_NAME}"
