output "cluster_name" {
  description = "The name of the deployed ECS cluster"
  value       = aws_ecs_cluster.fortis_ci.name
}

output "ecs_service_name" {
  description = "The name of the ECS service"
  value       = aws_ecs_service.fortis_ci_service.name
}

output "task_definition_arn" {
  description = "The ARN of the Fortis-CI task definition"
  value       = aws_ecs_task_definition.fortis_ci.arn
}
