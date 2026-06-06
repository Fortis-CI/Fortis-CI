resource "aws_ecs_cluster" "fortis_ci" {
  name = var.cluster_name
}

resource "aws_iam_role" "ecs_task_execution_role" {
  name = "${var.cluster_name}-task-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_ecs_task_definition" "fortis_ci" {
  family                   = "fortis-ci"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn

  container_definitions = jsonencode([
    {
      name      = "neo4j"
      image     = "neo4j:5.12.0"
      cpu       = 256
      memory    = 512
      essential = true
      portMappings = [{ containerPort = 7687 }, { containerPort = 7474 }]
      environment = [
        { name = "NEO4J_AUTH", value = "neo4j/fortis_password" }
      ]
    },
    {
      name      = "redis"
      image     = "redis:7-alpine"
      cpu       = 128
      memory    = 256
      essential = true
      portMappings = [{ containerPort = 6379 }]
    },
    {
      name      = "backend"
      image     = "ganeshak11/fortis-ci-backend:v4.0.0"
      cpu       = 512
      memory    = 1024
      essential = true
      portMappings = [{ containerPort = 3001 }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "NEO4J_URI", value = "bolt://localhost:7687" },
        { name = "NEO4J_USERNAME", value = "neo4j" },
        { name = "NEO4J_PASSWORD", value = "fortis_password" },
        { name = "REDIS_URL", value = "redis://localhost:6379" },
        { name = "SERVICES_YAML", value = var.services_yaml_content },
        { name = "GITHUB_TOKEN", value = var.github_token },
        { name = "GITHUB_WEBHOOK_SECRET", value = var.github_webhook_secret },
        { name = "SENTINEL_LICENSE_KEY", value = var.sentinel_license_key }
      ]
    }
  ])
}

resource "aws_ecs_service" "fortis_ci_service" {
  name            = "fortis-ci-service"
  cluster         = aws_ecs_cluster.fortis_ci.id
  task_definition = aws_ecs_task_definition.fortis_ci.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    assign_public_ip = true
  }
}
