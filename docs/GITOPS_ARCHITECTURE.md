# Fortis-CI GitOps & Terraform Architecture

Fortis-CI is designed to be fully automated and deployed via Infrastructure as Code (IaC) tools like Terraform. Developers should never need to manually click "Register Service" in the UI when setting up a new project.

This document outlines the architecture for deploying Fortis-CI alongside microservices, and how to seamlessly inject service registries and secrets.

## The GitOps Vision

When a developer sets up a new microservice architecture, they create a Terraform module to spin up Fortis-CI inside the same VPC as their microservices. They define a `services.yml` file locally in their repository, and Terraform handles the rest.

```text
my-microservices/
├── src/
├── terraform/
│   ├── vpc.tf
│   ├── ecs.tf
│   └── fortis-ci.tf       <-- The terraform module deploying Fortis-CI
└── fortis-ci/
    └── services.yml       <-- Their service registry
```

## Service Auto-Registration

Fortis-CI supports registering services at boot time in two ways:

### 1. The Environment Variable Method (Recommended for Terraform)
Terraform can read the local `services.yml` file and pass it directly to the Fortis-CI Docker container as an environment variable. This avoids the complexity of mounting files into ECS/EC2 instances.

**In `terraform/fortis-ci.tf`:**
```hcl
module "fortis_ci" {
  source = "ganeshak11/fortis-ci/aws"
  
  # Read the local YAML file and inject it as a string
  environment = {
    SERVICES_YAML = file("../fortis-ci/services.yml")
  }
}
```

When the Fortis-CI backend boots, it automatically detects the `SERVICES_YAML` environment variable, parses the YAML, and registers all services into the Neo4j graph within milliseconds.

### 2. The Volume Mount Method (Recommended for Docker Compose)
If deploying via Docker Compose, you can simply mount the file into the container at `/app/config/services.yml`.

**In `docker-compose.yml`:**
```yaml
services:
  backend:
    volumes:
      - ./fortis-ci-services.yml:/app/config/services.yml:ro
```

Fortis-CI will detect the file at `/app/config/services.yml` and auto-register the services on boot.

## Secure Secret Management

Fortis-CI requires sensitive credentials (like `GITHUB_WEBHOOK_SECRET`) to operate securely. These should **never** be hardcoded in Terraform or stored in version control.

### Option A: CI/CD Injection (Standard)
1. Store the secrets in GitHub Actions Repository Secrets.
2. The CI/CD pipeline injects them as `TF_VAR_webhook_secret` when running `terraform apply`.
3. The Terraform module passes the variable into the Fortis-CI container's environment.

### Option B: AWS Secrets Manager (Enterprise)
1. Store the secret in AWS Secrets Manager manually.
2. Pass the **ARN** of the secret into the Terraform module.
3. Terraform grants the Fortis-CI ECS task the IAM permissions to read that specific ARN.
4. AWS natively resolves the ARN and injects the actual secret into the container environment at boot.

```hcl
module "fortis_ci" {
  source = "ganeshak11/fortis-ci/aws"
  github_webhook_secret_arn = "arn:aws:secretsmanager:us-east-1:123456789:secret:fortis/webhook"
}
```

## Summary Workflow

1. Developer writes `services.yml`.
2. Developer runs `terraform apply` (or CI/CD runs it).
3. Terraform provisions Fortis-CI and injects the YAML file and Secrets dynamically.
4. Fortis-CI boots up, reads the YAML, registers services in Neo4j, and starts the Health Worker.
5. Developer pushes application code to GitHub.
6. GitHub Actions triggers a deployment, sending a webhook to Fortis-CI.
7. Fortis-CI links the webhook to the pre-registered services instantly.

## v4.0.0 Roadmap: The Official Terraform Module

To make the `module "fortis_ci"` block actually work for end-users, we have slated the creation of an official Terraform Module for **v4.0.0 — Ship at Scale**.

**Decisions for v4.0.0 Implementation:**
1. **New Repository**: We will create a standalone repository named `terraform-aws-fortis-ci` specifically to house the HCL code that deploys the Fortis-CI ECS containers, networking, and IAM roles.
2. **Terraform Registry Publishing**: We will publish this module to the Official Terraform Registry. This allows users to import Fortis-CI using the clean `source = "ganeshak11/fortis-ci/aws"` syntax and provides built-in version locking (e.g., `version = "1.0.0"`).
3. **Environment Injection**: The module will explicitly expose a `services_yaml_content` variable that securely pipes local YAML configurations into the ECS Task Definition's environment variables, fulfilling the exact GitOps workflow described in this document.
