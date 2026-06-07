data "aws_ami" "amazon_linux_2" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }
}

data "aws_vpc" "selected" {
  id = var.vpc_id
}

resource "aws_security_group" "fortis_ci_sg" {
  name        = "${var.cluster_name}-sg"
  vpc_id      = var.vpc_id

  # Public HTTPS/HTTP for Nginx
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  # VPC Internal for ArgoCD Webhooks
  ingress {
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.selected.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role" "fortis_ec2_role" {
  name = "${var.cluster_name}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.fortis_ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "fortis_ec2_profile" {
  name = "${var.cluster_name}-profile"
  role = aws_iam_role.fortis_ec2_role.name
}

resource "aws_instance" "fortis_ci" {
  ami           = data.aws_ami.amazon_linux_2.id
  instance_type = "t3.medium"
  subnet_id     = var.subnet_ids[0]
  vpc_security_group_ids = [aws_security_group.fortis_ci_sg.id]
  iam_instance_profile = aws_iam_instance_profile.fortis_ec2_profile.name
  associate_public_ip_address = true

  user_data = <<-EOF
#!/bin/bash
set -ex

# Install Docker and Docker Compose
amazon-linux-extras install docker -y
service docker start
usermod -a -G docker ec2-user
curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

mkdir -p /opt/fortis-ci/nginx
cd /opt/fortis-ci

# Get public IP for nip.io domain
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
DOMAIN="fortis.$${PUBLIC_IP}.nip.io"

# Write services.yml
cat << 'YAML' > services.yml
${var.services_yaml_content}
YAML

# Write nginx config and self-signed cert generation
cat << 'NGINX' > nginx/nginx.conf
events {}
http {
  server {
    listen 80;
    server_name _;
    return 301 https://\$host\$request_uri;
  }
  server {
    listen 443 ssl;
    server_name _;

    ssl_certificate /etc/nginx/ssl/nginx.crt;
    ssl_certificate_key /etc/nginx/ssl/nginx.key;

    location / {
      proxy_pass http://frontend:3000;
      proxy_set_header Host \$host;
    }
    location /api/ {
      proxy_pass http://backend:3001;
      proxy_set_header Host \$host;
    }
  }
}
NGINX

mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/nginx.key \
  -out nginx/ssl/nginx.crt \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=$DOMAIN"

# Write docker-compose.yml
cat << 'COMPOSE' > docker-compose.yml
version: '3.8'
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - frontend
      - backend

  neo4j:
    image: neo4j:5.12.0
    environment:
      NEO4J_AUTH: neo4j/fortis_password
    # Ports NOT exposed to host to prevent public access

  redis:
    image: redis:7-alpine
    # Ports NOT exposed

  backend:
    image: ganeshak11/fortis-ci-backend:v4.0.0
    ports:
      - "3001:3001" # Exposed for internal VPC ArgoCD access
    environment:
      NODE_ENV: production
      NEO4J_URI: bolt://neo4j:7687
      NEO4J_USERNAME: neo4j
      NEO4J_PASSWORD: fortis_password
      REDIS_URL: redis://redis:6379
      SERVICES_YAML: "$$(cat services.yml)"
      GITHUB_TOKEN: "${var.github_token}"
      GITHUB_WEBHOOK_SECRET: "${var.github_webhook_secret}"
      SENTINEL_LICENSE_KEY: "${var.sentinel_license_key}"
    depends_on:
      - neo4j
      - redis

  frontend:
    image: ganeshak11/fortis-ci-frontend:v4.0.0
    environment:
      NEXT_PUBLIC_API_URL: "https://$DOMAIN/api"
    depends_on:
      - backend
COMPOSE

/usr/local/bin/docker-compose up -d
EOF

  tags = {
    Name = var.cluster_name
  }
}
