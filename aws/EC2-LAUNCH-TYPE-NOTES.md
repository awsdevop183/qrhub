# ECS on EC2 — the differences that actually matter

Compared to `task-definition.json` (Fargate), `task-definition-ec2.json` changes:

| Field | Fargate | EC2 launch type |
|---|---|---|
| `networkMode` | `awsvpc` | `bridge` (the classic; `awsvpc` also works) |
| `cpu` / `memory` | **required** at task level | optional at task level, set per container |
| `memoryReservation` | n/a | soft limit — the number the scheduler packs against |
| `hostPort` | must equal `containerPort` | **`0` = dynamic port mapping** |
| Target group type | **IP addresses** | **Instances** |
| Who provides compute | AWS, invisibly | your Auto Scaling Group |

## Dynamic port mapping

`"hostPort": 0` tells Docker to pick a free ephemeral port on the instance
(32768–65535) and map it to container port 3000. ECS then registers
`instance-id:that-port` with the target group.

This is what lets you run **several copies of the same task on one instance** —
impossible with a fixed host port, because the second one would collide.

### The security group trap

Because the host port is random, the ALB does not connect to port 3000 on the
instance. It connects to something like 41337. So the **instance** security
group must allow:

```
Type: Custom TCP    Port range: 32768-65535    Source: <ALB security group>
```

Allowing only 3000 is the single most common reason an ECS-on-EC2 service comes
up with tasks RUNNING but targets permanently unhealthy.

## Instance user data

Instances in the ASG must tell the ECS agent which cluster to join:

```bash
#!/bin/bash
echo "ECS_CLUSTER=qrhub-cluster" >> /etc/ecs/ecs.config
```

Use an **ECS-optimized AMI** (search `amzn2023-ami-ecs-hvm` in the AMI catalog) —
it ships with Docker and the ECS agent already installed and enabled.

## The third IAM role

- `qrhubExecutionRole` — the ECS agent, to pull images and read secrets
- `qrhubTaskRole` — your application code at runtime
- **`ecsInstanceRole`** — the EC2 instances themselves, so the ECS agent can
  register with the cluster and report state

Attach the managed policy `AmazonEC2ContainerServiceforEC2Role` to
`ecsInstanceRole`, and attach the role to the ASG's launch template as an
instance profile. Fargate needs no such role, because there are no instances.

## Capacity provider

Create the ASG first, then attach it to the cluster as a capacity provider:

- Managed scaling: **enabled**, target capacity **100%**
- Managed instance draining: **enabled**
- Managed termination protection: enabled (stops the ASG killing an instance
  that is still running tasks)

With managed scaling on, you no longer scale the ASG — you scale the *service*,
and the capacity provider adds instances when there is nowhere to place a task.
That indirection is the single biggest conceptual jump in ECS on EC2, and it is
exactly what Fargate removes.
