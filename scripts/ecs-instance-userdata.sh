#!/bin/bash
# User data for the ECS-on-EC2 Auto Scaling Group launch template.
# Requires an ECS-optimized AMI - Docker and the ECS agent are already there.
echo "ECS_CLUSTER=qrhub-cluster" >> /etc/ecs/ecs.config
echo "ECS_ENABLE_CONTAINER_METADATA=true" >> /etc/ecs/ecs.config
