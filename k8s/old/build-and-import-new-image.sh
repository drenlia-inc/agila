#!/bin/bash

# Build and Import New Image for Kubernetes
# This script builds a new Docker image and imports it into the k8s.io namespace

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get the project root (parent of k8s directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🐳 Easy Kanban - Build and Import Image${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Change to project root
cd "$PROJECT_ROOT"
echo -e "${CYAN}📁 Working directory: ${PROJECT_ROOT}${NC}"
echo ""

# Check if Docker is running
echo -e "${YELLOW}🔍 Checking Docker...${NC}"
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker and try again.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker is running${NC}"
echo ""

# Check if Dockerfile.prod exists
if [ ! -f "Dockerfile.prod" ]; then
    echo -e "${RED}❌ Dockerfile.prod not found in ${PROJECT_ROOT}${NC}"
    exit 1
fi

# Get git information
echo -e "${YELLOW}📋 Gathering version information...${NC}"
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo -e "${CYAN}   Git Commit: ${GIT_COMMIT}${NC}"
echo -e "${CYAN}   Git Branch: ${GIT_BRANCH}${NC}"
echo -e "${CYAN}   Build Time: ${BUILD_TIME}${NC}"
echo ""

# Build the image
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🔨 Building Docker image...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

"${PROJECT_ROOT}/scripts/prepare-prev-assets.sh" easy-kanban:latest || true

docker build -f Dockerfile.prod -t easy-kanban:latest \
  --build-arg GIT_COMMIT="${GIT_COMMIT}" \
  --build-arg GIT_BRANCH="${GIT_BRANCH}" \
  --build-arg BUILD_TIME="${BUILD_TIME}" \
  .

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Docker image built successfully!${NC}"
else
    echo ""
    echo -e "${RED}❌ Docker build failed!${NC}"
    exit 1
fi

# Get image information
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📦 Image Information${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
docker images easy-kanban:latest --format "Image: {{.Repository}}:{{.Tag}}\nImage ID: {{.ID}}\nCreated: {{.CreatedSince}}\nSize: {{.Size}}"
echo ""

# Import to Kubernetes
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📥 Importing image to Kubernetes...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

docker save easy-kanban:latest | sudo ctr -n k8s.io images import -

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Image imported to k8s.io namespace successfully!${NC}"
else
    echo ""
    echo -e "${RED}❌ Image import failed!${NC}"
    exit 1
fi

# Verify import
echo ""
echo -e "${YELLOW}🔍 Verifying image in Kubernetes...${NC}"
if sudo ctr -n k8s.io images list | grep -q "easy-kanban:latest"; then
    echo -e "${GREEN}✓ Image verified in k8s.io namespace${NC}"
    echo ""
    sudo ctr -n k8s.io images list | grep easy-kanban
else
    echo -e "${RED}⚠ Warning: Could not verify image in k8s.io namespace${NC}"
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Build and Import Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}📋 Version Information:${NC}"
echo -e "   • Git Commit: ${GIT_COMMIT}"
echo -e "   • Git Branch: ${GIT_BRANCH}"
echo -e "   • Build Time: ${BUILD_TIME}"
echo ""
echo -e "${CYAN}🚀 Next Steps:${NC}"
echo -e "   To deploy the new image to all instances, run:"
echo -e "   ${YELLOW}./k8s/gradual-rollout.sh$ [ <instance-name> ]${NC}"
echo ""
echo -e "   Or for immediate rollout (may cause CPU spike):"
echo -e "   ${YELLOW}kubectl rollout restart deployment/<instance-name> -n <namespace>${NC}"
echo ""
