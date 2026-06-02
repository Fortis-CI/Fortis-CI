<#
.SYNOPSIS
Fortis-CI Git Push Script

.DESCRIPTION
Helper script to enforce Conventional Commits and protect the main branch.
#>

$ErrorActionPreference = "Stop"

Write-Host "----------- Fortis-CI Git Push -----------" -ForegroundColor Cyan

# Detect current branch
$branch_name = git rev-parse --abbrev-ref HEAD
Write-Host "Current branch: $branch_name"

# Protect main branch
if ($branch_name -eq "main") {
    Write-Host "❌ ERROR: Direct push to main is not allowed." -ForegroundColor Red
    Write-Host ""
    Write-Host "Workflow:"
    Write-Host "  1. Create feature branch: git checkout -b feature/your-feature"
    Write-Host "  2. Push feature branch: .\push.ps1"
    Write-Host "  3. Create PR to main on GitHub"
    Write-Host "  4. Merge to main after approval"
    Write-Host ""
    exit 1
}

# Show current status
Write-Host "`nCurrent changes:"
git status
Write-Host ""

# Ask commit message
$commit_message = Read-Host "Enter commit message"

if ([string]::IsNullOrWhiteSpace($commit_message)) {
    Write-Host "Commit message cannot be empty." -ForegroundColor Red
    exit 1
}

# Select commit type
Write-Host "`nSelect commit type:"
Write-Host "1) feat"
Write-Host "2) fix"
Write-Host "3) refactor"
Write-Host "4) docs"
Write-Host "5) chore"
$type_choice = Read-Host "Choice"

$prefix = ""
switch ($type_choice) {
    "1" { $prefix = "feat" }
    "2" { $prefix = "fix" }
    "3" { $prefix = "refactor" }
    "4" { $prefix = "docs" }
    "5" { $prefix = "chore" }
    default { 
        Write-Host "Invalid choice." -ForegroundColor Red
        exit 1 
    }
}

$full_commit_message = "$prefix: $commit_message"

# Stage changes
Write-Host "`nAdding changes..."
git add .

# Check if anything is staged
$has_changes = git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "No changes staged. Nothing to commit." -ForegroundColor Yellow
    exit 0
}

# Commit
Write-Host "Committing..."
git commit -m $full_commit_message

# Run tests if backend package.json exists
if (Test-Path "backend\package.json") {
    Write-Host "`nRunning backend tests..."
    Push-Location backend
    try {
        npm test
    } catch {
        # Tests might fail, but we can continue or stop depending on strictness
        Write-Host "Tests finished with errors." -ForegroundColor Yellow
    }
    Pop-Location
}

# Find correct remote
$remotes = git remote
$remote = "origin"
if ($remotes -contains "org") {
    $remote = "org"
}

# Push
Write-Host "`nPushing to $remote/$branch_name ..."
git push $remote $branch_name

Write-Host "`n----------- Push Complete -----------" -ForegroundColor Green
Write-Host "`nNext steps:"
Write-Host "  1. Go to GitHub repository"
Write-Host "  2. Create Pull Request: $branch_name -> main"
Write-Host "  3. Wait for approval before merging"
