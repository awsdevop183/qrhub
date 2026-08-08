const express = require('express');
const QRCode = require('qrcode');
const crypto = require('crypto');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Config driven by the ECS task definition ────────────────────────────
const APP_VERSION = process.env.APP_VERSION || 'v1';
const BANNER = process.env.BANNER_MESSAGE || 'Running on AWS ECS Fargate';

// Flip to "true" to simulate a bad deployment (circuit breaker demo)
const BREAK_HEALTH = process.env.BREAK_HEALTH === 'true';

// ── The secret. Injected from Secrets Manager by the TASK EXECUTION ROLE.
// Every QR code we hand out is signed with this key so it cannot be
// tampered with. Without it there is nothing safe to serve, so we refuse
// to start — a container that boots into a broken state is worse than one
// that never boots at all.
const SIGNING_KEY = process.env.QRHUB_SIGNING_KEY;

if (!SIGNING_KEY) {
  console.error('[qrhub] FATAL: QRHUB_SIGNING_KEY is not set.');
  console.error('[qrhub] Links cannot be signed. Refusing to start.');
  console.error('[qrhub] Check the "secrets" block in the task definition');
  console.error('[qrhub] and that the execution role can read the secret.');
  process.exit(1);
}

let requestCount = 0;
let linksSigned = 0;
let tamperRejects = 0;
const startedAt = Date.now();

// ── Signing helpers ─────────────────────────────────────────────────────
const b64url = buf => Buffer.from(buf).toString('base64url');

function sign(payload) {
  return crypto.createHmac('sha256', SIGNING_KEY)
    .update(payload)
    .digest('base64url')
    .slice(0, 16);
}

// A token is  <base64url(json)>.<hmac>  — completely stateless, no database.
function makeToken(target) {
  const payload = b64url(JSON.stringify({ u: target, t: Date.now() }));
  linksSigned++;
  return payload + '.' + sign(payload);
}

function readToken(token) {
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  // Constant-time compare — never use === on a signature
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
}

// ── ECS task metadata (v4 endpoint, injected by Fargate) ────────────────
let taskMeta = { taskId: 'local', az: 'local', cluster: 'local', cpu: '-', memory: '-' };

async function loadTaskMetadata() {
  const uri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  if (!uri) return;
  try {
    const res = await fetch(uri + '/task');
    const data = await res.json();
    const arn = data.TaskARN || '';
    taskMeta = {
      taskId: arn.split('/').pop().slice(0, 12) || 'unknown',
      az: data.AvailabilityZone || 'unknown',
      cluster: (data.Cluster || '').split('/').pop() || 'unknown',
      cpu: data.Limits?.CPU ?? '-',
      memory: data.Limits?.Memory ?? '-'
    };
    console.log('[qrhub] task metadata loaded:', JSON.stringify(taskMeta));
  } catch (err) {
    console.error('[qrhub] could not read task metadata:', err.message);
  }
}

app.set('trust proxy', true); // we sit behind an ALB
app.use(express.json());
app.use(express.static('public'));

app.use((req, _res, next) => {
  requestCount++;
  next();
});

const baseUrl = req =>
  process.env.PUBLIC_BASE_URL || (req.protocol + '://' + req.get('host'));

// ── Health check — this is what the ALB target group hits ───────────────
app.get('/health', (_req, res) => {
  if (BREAK_HEALTH) {
    console.error('[qrhub] health check FAILING on purpose (BREAK_HEALTH=true)');
    return res.status(500).json({ status: 'unhealthy', version: APP_VERSION });
  }
  res.json({ status: 'ok', version: APP_VERSION, task: taskMeta.taskId });
});

// ── Who served this request? Makes load balancing visible ───────────────
app.get('/api/whoami', (_req, res) => {
  res.json({
    version: APP_VERSION,
    banner: BANNER,
    hostname: os.hostname(),
    taskId: taskMeta.taskId,
    availabilityZone: taskMeta.az,
    cluster: taskMeta.cluster,
    cpu: taskMeta.cpu,
    memory: taskMeta.memory,
    linksSigned: linksSigned,
    tamperRejects: tamperRejects,
    requestsServed: requestCount,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
  });
});

// ── Generate a signed QR code ───────────────────────────────────────────
app.post('/api/qr', async (req, res) => {
  const target = (req.body.text || '').trim();
  if (!target) return res.status(400).json({ error: 'text is required' });
  if (target.length > 700) return res.status(400).json({ error: 'text too long (max 700 chars)' });

  const token = makeToken(target);
  const link = baseUrl(req) + '/s/' + token;

  try {
    const dataUrl = await QRCode.toDataURL(link, {
      width: 420,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' }
    });
    console.log('[qrhub] signed link for ' + target + ' (task ' + taskMeta.taskId + ')');
    res.json({ image: dataUrl, link: link, token: token, servedBy: taskMeta.taskId, version: APP_VERSION });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Follow a signed link ────────────────────────────────────────────────
// Any task can verify a link any other task signed, because they all share
// the same secret. That is the whole point of centralising it.
app.get('/s/:token', (req, res) => {
  const data = readToken(req.params.token);

  if (!data) {
    tamperRejects++;
    console.warn('[qrhub] REJECTED tampered token (task ' + taskMeta.taskId + ')');
    return res.status(403).send(
      '<body style="background:#0B1120;color:#F87171;font-family:system-ui;' +
      'display:flex;align-items:center;justify-content:center;height:100vh;' +
      'text-align:center"><div><h1>403 &mdash; Invalid signature</h1>' +
      '<p style="color:#94A3B8">This QR code was not issued by QRHub, ' +
      'or it has been modified.</p></div></body>'
    );
  }

  res.redirect(302, data.u);
});

// ── CPU burner — used to trigger auto scaling on camera ─────────────────
app.get('/api/load', (req, res) => {
  const ms = Math.min(parseInt(req.query.ms, 10) || 500, 5000);
  const end = Date.now() + ms;
  let hash = 0;
  while (Date.now() < end) {
    hash = (hash * 31 + Math.random() * 1e9) % 1e9;
  }
  res.json({ burnedMs: ms, taskId: taskMeta.taskId, hash: Math.round(hash) });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log('[qrhub] ' + APP_VERSION + ' listening on ' + PORT + ' (signing key loaded)');
  await loadTaskMetadata();
});
