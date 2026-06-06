variable "aws_region" {
  description = "AWS region to deploy Fortis-CI"
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "Name of the ECS cluster"
  type        = string
  default     = "fortis-ci-cluster"
}

variable "github_token" {
  description = "GitHub PAT with repo and admin:repo_hook scopes"
  type        = string
  sensitive   = true
}

variable "github_webhook_secret" {
  description = "Secret used to secure GitHub Webhooks"
  type        = string
  sensitive   = true
}

variable "sentinel_license_key" {
  description = "Enterprise License Key for Fortis-CI (Optional for OSS Mode)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "services_yaml_content" {
  description = "The raw string content of the services.yml registry to inject into Fortis-CI"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where ECS tasks will run"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs for ECS tasks"
  type        = list(string)
}
