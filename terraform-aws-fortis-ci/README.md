# Terraform Module: AWS Fortis-CI

This is the official Terraform module for deploying **Fortis-CI** on AWS ECS Fargate.
It is designed to support a strict GitOps workflow by injecting your `services.yml` registry directly into the application environment at boot time.

## Usage

```hcl
module "fortis_ci" {
  source = "ganeshak11/fortis-ci/aws"
  
  vpc_id     = "vpc-12345"
  subnet_ids = ["subnet-abc", "subnet-xyz"]
  
  github_token          = var.github_token
  github_webhook_secret = var.github_webhook_secret
  
  # Inject the local services registry directly into the container
  services_yaml_content = file("../fortis-ci/services.yml")
}
```

## Features
- Deploys `fortis-ci-backend`, `neo4j`, and `redis` together as a single cohesive ECS Fargate Task.
- Uses `localhost` networking between containers for zero-latency graph queries.
- Injects `SERVICES_YAML` environment variable, enabling auto-registration without volume mounts.
