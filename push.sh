#!/bin/bash

set -e  # Exit immediately if any command fails

echo "----------- Fortis-CI Git Push -----------"

# Detect current branch
branch_name=$(git rev-parse --abbrev-ref HEAD)
echo "Current branch: $branch_name"

# Protect main branch
if [ "$branch_name" = "main" ]; then
    echo "❌ ERROR: Direct push to main is not allowed."
    echo ""
    echo "Workflow:"
    echo "  1. Create feature branch: git checkout -b feature/your-feature"
    echo "  2. Push feature branch: ./push.sh"
    echo "  3. Create PR to main on GitHub"
    echo "  4. Merge to main after approval"
    echo ""
    exit 1
fi

# Show current status
echo ""
echo "Current changes:"
git status
echo ""

# Ask commit message
read -p "Enter commit message: " commit_message

if [ -z "$commit_message" ]; then
    echo "Commit message cannot be empty."
    exit 1
fi

# Select commit type
echo ""
echo "Select commit type:"
echo "1) feat"
echo "2) fix"
echo "3) refactor"
echo "4) docs"
echo "5) chore"
read -p "Choice: " type_choice

case $type_choice in
  1) prefix="feat" ;;
  2) prefix="fix" ;;
  3) prefix="refactor" ;;
  4) prefix="docs" ;;
  5) prefix="chore" ;;
  *) echo "Invalid choice."; exit 1 ;;
esac

full_commit_message="$prefix: $commit_message"

# Stage changes
echo ""
echo "Adding changes..."
git add .

# Check if anything is staged
if git diff --cached --quiet; then
    echo "No changes staged. Nothing to commit."
    exit 0
fi

# Commit
echo "Committing..."
git commit -m "$full_commit_message"

# Run tests if package.json exists
if [ -f "backend/package.json" ]; then
    echo ""
    echo "Running backend tests..."
    (cd backend && npm test || true)
fi

# Push to the remote (org is default for this open source repo, or origin)
# Find the correct remote name. If 'org' exists, use it, else 'origin'
REMOTE="origin"
if git remote | grep -q "^org$"; then
  REMOTE="org"
fi

echo ""
echo "Pushing to $REMOTE/$branch_name ..."
git push $REMOTE "$branch_name"

echo ""
echo "----------- Push Complete -----------"
echo ""
echo "Next steps:"
echo "  1. Go to GitHub repository"
echo "  2. Create Pull Request: $branch_name → main"
echo "  3. Wait for approval before merging"