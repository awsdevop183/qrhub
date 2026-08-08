# QRHub — AWS ECS Fargate Zero to Hero

Companion repo for the **AWS Zero to Hero** playlist on
[Madhukar Reddy (@awsandevops)](https://youtube.com/@awsandevops).

QRHub is a small QR-code generator whose real job is to make ECS *visible*. Every
page load tells you which task answered you, which Availability Zone it sits in,
and how much CPU and memory it was given — so when the service scales out or a
deployment rolls forward, you can watch it happen in the browser.

Every QR code it issues encodes a **signed short link**, not the raw URL. The HMAC
signing key comes from Secrets Manager, so the secret is genuinely load-bearing:
without it the container refuses to start, and a QR code whose signature has been
altered is rejected with a 403.

**Region:** `ap-south-1` (Mumbai)
**Demo URL:** `ecs.aws365.shop`

---

## What the app gives you

| Endpoint | Purpose in the video |
|---|---|
| `GET /health` | ALB target-group health check |
| `GET /api/whoami` | Task ID, AZ, cluster, CPU/memory, links signed, tamper rejects |
| `POST /api/qr` | Generate a QR encoding a signed short link |
| `GET /s/:token` | Verify the HMAC, then redirect — or 403 if tampered |
| `GET /api/load?ms=4000` | Burns CPU so auto scaling triggers on camera |

## Environment variables

A container never advertises what it reads, so here is the contract. See also
`.env.example` and the `io.qrhub.env.*` labels on the image.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `QRHUB_SIGNING_KEY` | **yes** | none | HMAC key for signing links. App exits 1 without it. From Secrets Manager in ECS. |
| `APP_VERSION` | no | `dev` | Shown in the UI — set `v1` then `v2` for the rolling-deploy demo |
| `BANNER_MESSAGE` | no | `Running locally` | Subtitle text |
| `BREAK_HEALTH` | no | `false` | `true` makes `/health` return 500 — circuit breaker demo |
| `PORT` | no | `3000` | Listen port inside the container |
| `PUBLIC_BASE_URL` | no | derived from `Host` | Override when the public URL differs from the Host header |

Inspect the contract without running anything:

```bash
docker inspect qrhub:v1 --format '{{json .Config.Labels}}' | jq
docker inspect qrhub:v1 --format '{{json .Config.Env}}' | jq
```

---

## Run it locally first

```bash
cd app
npm install
APP_VERSION=v1 QRHUB_SIGNING_KEY=local-dev-key npm start
# open http://localhost:3000
```

With Docker:

```bash
docker build -t qrhub:v1 ./app
docker run -p 3000:3000 -e APP_VERSION=v1 -e QRHUB_SIGNING_KEY=local-dev-key qrhub:v1
```

---

## The three deployments

This repo backs a video that deploys the same image three ways, so you can feel
what each rung of the ladder removes.

| | You manage | AWS manages | Files |
|---|---|---|---|
| **1. Docker on EC2** | OS, restarts, placement, deploys | hardware | `scripts/buildbox-userdata.sh` |
| **2. ECS on EC2** | OS + the instances | scheduling, restarts, rolling deploys | `aws/task-definition-ec2.json`, `scripts/ecs-instance-userdata.sh` |
| **3. ECS on Fargate** | your container | everything else | `aws/task-definition.json` |

Both ECS services hang off one ALB — `:80` is the EC2 launch type, `:8080` is
Fargate — so you can compare them in two browser tabs.

See `aws/EC2-LAUNCH-TYPE-NOTES.md` for the differences that actually matter
(bridge vs awsvpc, dynamic port mapping, the ephemeral port range trap, and the
third IAM role).

---

## Part 1 — Docker on EC2

Launch an Ubuntu 24.04 instance with `scripts/buildbox-userdata.sh` as user data
and an instance profile carrying `AmazonEC2ContainerRegistryPowerUser`.

```bash
cd ~/qrhub
docker build -t qrhub:v1 ./app
./scripts/build-and-push.sh v1

docker run -d --name qrhub -p 3000:3000 \
  -e APP_VERSION=v1 \
  -e BANNER_MESSAGE="Plain Docker on EC2" \
  -e QRHUB_SIGNING_KEY=local-dev-key \
  <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/qrhub:v1
```

Then prove nothing is watching it:

```bash
./scripts/kill-a-container.sh    # it stays dead
```

---

## Parts 2 and 3 — ECS, the console path

### 1. Create the ECR repository

ECR → Create repository → name `qrhub` → leave defaults → Create.

```bash
./scripts/build-and-push.sh v1
```

### 2. Store the secret

Secrets Manager → Store a new secret → Other type of secret → key/value:

| Key | Value |
|---|---|
| `signingkey` | a long random string, e.g. `openssl rand -base64 32` |

Name it `qrhub/signing-key`. Copy the ARN.

The app calls `process.exit(1)` if this is missing. That is deliberate — it means a
misconfigured execution role produces a task that visibly fails to start, rather than
one that boots and quietly hands out unsigned links.

### 3. Create the IAM roles

Three of them, and they sound almost identical. Be deliberate:

- **Instance role** (`ecsInstanceRole`) — used by the EC2 instances in the ASG so the
  ECS agent can register them with the cluster. Trusted entity: *EC2*. Attach
  `AmazonEC2ContainerServiceforEC2Role`. **Fargate does not need this role** — there
  are no instances. Skip it if you are only doing Part 3.


- **Task execution role** (`qrhubExecutionRole`) — used by the **ECS agent**, before your
  container starts. It pulls the image from ECR, writes logs to CloudWatch, and reads the
  secret to inject as an env var.
  Trusted entity: *Elastic Container Service Task*.
  Attach `AmazonECSTaskExecutionRolePolicy` + an inline policy allowing
  `secretsmanager:GetSecretValue` on your secret ARN.

- **Task role** (`qrhubTaskRole`) — used by **your application code** at runtime for its own
  AWS API calls. QRHub barely needs it, which is exactly the point: keep it empty or
  near-empty and you have least privilege by default.
  See `aws/task-role-policy.json`.

### 4. Create the cluster

ECS → Clusters → Create cluster → name `qrhub-cluster` → infrastructure **AWS Fargate**.

### 5. Create the task definition

Either paste `aws/task-definition.json` into the JSON editor (replace `<ACCOUNT_ID>`),
or fill in the form:

- Family `qrhub-task`, launch type Fargate, Linux/X86_64
- 0.5 vCPU, 1 GB
- Execution role `qrhubExecutionRole`, task role `qrhubTaskRole`
- Container `qrhub`, image `<ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com/qrhub:v1`
- Port 3000, TCP
- Env: `APP_VERSION=v1`
- Secret: `QRHUB_SIGNING_KEY` → your Secrets Manager ARN, key `signingkey`
- Log group `/ecs/qrhub`

### 6. Create the ALB

EC2 → Load Balancers → Application Load Balancer, internet-facing, 2+ AZs.

Target group:
- **Target type: IP addresses** ← required for Fargate, this is the classic trap
- Protocol HTTP, port **3000**
- Health check path `/health`
- Healthy threshold 2, interval 15s

### 7. Create the service

ECS → your cluster → Services → Create:

- Task definition `qrhub-task`, latest revision
- Service name `qrhub-service`, desired tasks **2**
- Networking: your VPC, public subnets, **assign public IP ON** (no NAT gateway needed),
  security group allowing 3000 **from the ALB security group only**
- Load balancing: attach the existing ALB + target group
- Deployment: rolling update, **enable deployment circuit breaker with rollback**

Open the ALB DNS name. Refresh a few times — the Task ID changes as the ALB
spreads requests across both tasks.

### 8. Auto scaling

Service → Update → Service auto scaling:
- Min 2, Max 6
- Target tracking, `ECSServiceAverageCPUUtilization`, target **50**
- Scale-out cooldown 60s, scale-in 180s

Then:

```bash
./scripts/load-test.sh http://<alb-dns-name> 40
# in another terminal
./scripts/watch-tasks.sh qrhub-cluster qrhub-service
```

---

## The three demos worth filming

**The secret is real.** Remove the `secrets` block from the task definition and update the
service. The new tasks start, log `FATAL: QRHUB_SIGNING_KEY is not set`, and exit 1. The
service never stabilises. Put the CloudWatch log stream on screen — this is what a
misconfigured execution role actually looks like in production.

**Signatures hold across tasks.** Generate a QR on one task, then use *Tamper with it* to
flip one character of the signature. Any task rejects it, because all of them share the
same key from Secrets Manager. That is why the secret lives there and not in the image.


**Rolling deployment.** Change `APP_VERSION` to `v2` in the app, rebuild, push as `v2`,
create a new task-definition revision pointing at `:v2`, update the service. Keep the
browser open — the version pill flips while the site never goes down.

**Circuit breaker rollback.** Build a `v3` image with `BREAK_HEALTH=true` in the task
definition. New tasks fail their health checks, ECS gives up, and the service
automatically rolls back to the last healthy revision. Show the **Events** tab.

---

## Teardown

Delete in this order or the deletes will hang:

1. ECS service (set desired count to 0 first)
2. ECS cluster
3. ALB, then the target group
4. ECR repository (delete images first)
5. CloudWatch log group `/ecs/qrhub`
6. Secrets Manager secret `qrhub/signing-key` (schedule deletion, 7 days minimum)
7. IAM roles

---

Interview prep and practice labs: **[devprep.in](https://devprep.in)** — code `YOUTUBE50`
