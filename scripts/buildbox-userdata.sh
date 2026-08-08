#!/bin/bash
# User data for the Part 1 EC2 build box (Ubuntu 24.04).
# Installs Docker, git, AWS CLI v2, and clones the repo.
set -eux

apt-get update -y
apt-get install -y ca-certificates curl gnupg git unzip jq

# Docker
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker ubuntu

# AWS CLI v2
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip
unzip -q /tmp/awscli.zip -d /tmp
/tmp/aws/install
rm -rf /tmp/aws /tmp/awscli.zip

# The repo
sudo -u ubuntu git clone https://github.com/<you>/qrhub-ecs.git /home/ubuntu/qrhub || true

echo "buildbox ready" > /home/ubuntu/READY
