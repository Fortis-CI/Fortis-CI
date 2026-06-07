output "fortis_ci_public_ip" {
  description = "The public IP of the Fortis-CI EC2 instance"
  value       = aws_instance.fortis_ci.public_ip
}

output "fortis_ci_private_ip" {
  description = "The private IP of the Fortis-CI EC2 instance for internal ArgoCD communication"
  value       = aws_instance.fortis_ci.private_ip
}

output "fortis_ci_domain" {
  description = "The nip.io domain for HTTPS access"
  value       = "fortis.${replace(aws_instance.fortis_ci.public_ip, ".", "-")}.nip.io"
}
