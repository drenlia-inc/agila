#!/bin/bash

# Easy Kanban PostgreSQL Multi-Tenant Instance Deployment Script
# This script deploys a new tenant instance using PostgreSQL

set -e

# Function to display usage
usage() {
    echo "Usage: $0 <instance_name> <plan>"
    echo ""
    echo "Parameters:"
    echo "  instance_name  - The instance hostname (e.g., my-instance-name)"
    echo "  plan          - License plan: 'basic' or 'pro'"
    echo ""
    echo "Example:"
    echo "  $0 my-company basic"
    echo "  $0 enterprise pro"
    echo ""
    echo "This will deploy Easy Kanban accessible at: https://my-company.agila.dev"
    echo "(Override with TENANT_DOMAIN; deploy-pg.sh also reads the live ConfigMap.)"
    echo ""
    echo "Note: Instance token is automatically generated on first deployment"
    echo "      and preserved for all subsequent deployments."
    echo ""
    echo "Output:"
    echo "  The script will output JSON with deployment details on success"
    exit 1
}

# Check parameters (optional unused 3rd arg from admin APP_VERSION / "latest")
if [ $# -lt 2 ]; then
    echo "❌ Error: Missing required parameters"
    usage
fi

INSTANCE_NAME="$1"
PLAN="$2"

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run the main deployment script
echo "🚀 Starting PostgreSQL deployment for instance: ${INSTANCE_NAME} (${PLAN} plan)"
echo ""

# Create a temporary file to capture output while streaming in real-time
TEMP_OUTPUT=$(mktemp)
trap "rm -f '$TEMP_OUTPUT'" EXIT

# Run deploy-pg.sh, stream output to stdout AND capture to temp file
"${SCRIPT_DIR}/deploy-pg.sh" "$INSTANCE_NAME" "$PLAN" 2>&1 | tee "$TEMP_OUTPUT"
DEPLOY_EXIT_CODE=${PIPESTATUS[0]}

# Read captured output for parsing
DEPLOY_OUTPUT=$(cat "$TEMP_OUTPUT")

if [ $DEPLOY_EXIT_CODE -eq 0 ]; then
    # Extract the deployment result section
    DEPLOY_RESULT=$(echo "$DEPLOY_OUTPUT" | sed -n '/📤 DEPLOYMENT_RESULT:/,$p' | tail -n +2)
    
    # Parse the result into variables
    INSTANCE_NAME_RESULT=$(echo "$DEPLOY_RESULT" | grep "INSTANCE_NAME=" | cut -d'=' -f2)
    NAMESPACE_RESULT=$(echo "$DEPLOY_RESULT" | grep "NAMESPACE=" | cut -d'=' -f2)
    HOSTNAME_RESULT=$(echo "$DEPLOY_RESULT" | grep "HOSTNAME=" | cut -d'=' -f2)
    EXTERNAL_IP_RESULT=$(echo "$DEPLOY_RESULT" | grep "EXTERNAL_IP=" | cut -d'=' -f2)
    NODEPORT_RESULT=$(echo "$DEPLOY_RESULT" | grep "NODEPORT=" | cut -d'=' -f2)
    INSTANCE_TOKEN_RESULT=$(echo "$DEPLOY_RESULT" | grep "INSTANCE_TOKEN=" | cut -d'=' -f2)
    STORAGE_DATA_PATH=$(echo "$DEPLOY_RESULT" | grep "STORAGE_DATA_PATH=" | cut -d'=' -f2)
    STORAGE_ATTACHMENTS_PATH=$(echo "$DEPLOY_RESULT" | grep "STORAGE_ATTACHMENTS_PATH=" | cut -d'=' -f2)
    STORAGE_AVATARS_PATH=$(echo "$DEPLOY_RESULT" | grep "STORAGE_AVATARS_PATH=" | cut -d'=' -f2)
    
    # Output JSON result (required format for admin portal)
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "📋 DEPLOYMENT SUMMARY:"
    cat << EOF
{
  "status": "success",
  "instance_name": "${INSTANCE_NAME_RESULT}",
  "namespace": "${NAMESPACE_RESULT}",
  "hostname": "${HOSTNAME_RESULT}",
  "external_ip": "${EXTERNAL_IP_RESULT}",
  "nodeport": "${NODEPORT_RESULT}",
  "instance_token": "${INSTANCE_TOKEN_RESULT}",
  "plan": "${PLAN}",
  "database": "postgresql",
  "access_url": "https://${HOSTNAME_RESULT}",
  "storage_paths": {
    "database": "postgresql://postgres:5432/easykanban (schema: ${INSTANCE_NAME_RESULT})",
    "attachments": "${STORAGE_ATTACHMENTS_PATH}",
    "avatars": "${STORAGE_AVATARS_PATH}"
  }
}
EOF
else
    echo ""
    echo "❌ Deployment failed!"
    echo ""
    echo "Error output:"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi
