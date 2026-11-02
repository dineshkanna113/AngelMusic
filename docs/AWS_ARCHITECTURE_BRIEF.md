# Yaapu: AWS architecture brief

- **For:** an AWS DevOps / cloud architect
- **From:** the Yaapu team (contact: _name, email_)
- **Status:** draft for discussion. Items marked **[confirm]** are our assumptions or open decisions, not facts.

## 1. What we are asking for

Yaapu is a music streaming service that works like Spotify or Apple Music, with one difference: it plays
**lossless audio** (FLAC, 16-bit/44.1 kHz up to 24-bit/192 kHz) byte for byte, with no transcoding. It runs today as
a single server. We need a **scalable, secure, cost-aware AWS architecture** that takes it from that single
server to a public launch and beyond, plus the plan, infrastructure code and pipelines to get there.

Please read sections 2 to 7 for context, then use sections 8 and 9 as the scope of work and the questions we need
answered. The code is in one repository and the full API schema is in `docs/openapi.json`.

## 2. The product in one page

- **Catalogue:** licensed music from labels and distributors, plus independent artists who upload their own tracks.
  Both live in one library and go through the same review pipeline (validate, de-duplicate, review, schedule, publish, take down).
- **Listeners:** web app (installable PWA) today; **native iOS and Android apps are planned** and will use the same
  API. Existing Subsonic-compatible apps can also connect through a Subsonic API we expose at `/rest`.
- **Social layer (the differentiator):** profiles, following, live friend activity, shareable story images,
  collaborative playlists. Later: listening rooms with live sync, reactions and chat.
- **Discovery:** browse by genre/mood/language, charts, new releases, editorial playlists, artist pages, personal mixes.
- **Artist tools (planned):** release drops with pre-saves, smart share links, listener statistics.
- **Business (planned):** free and premium tiers (premium = lossless, offline, no ads), payments through a payment
  provider, label deliveries in DDEX format, play counting accurate enough for royalty reports.
- **Promise to users:** playback that never lags: instant start, seek without stalls, gapless between tracks.

## 3. What runs today

One EC2 instance running Docker Compose with two containers: **Caddy** (TLS) and the **app**.
Database and music sit on an attached EBS volume.

| Part | Today |
|---|---|
| API | FastAPI 0.115 on Python 3.12, one uvicorn process. 57 paths, 75 operations (auth, library, uploads, social, discovery, admin) plus the Subsonic API at `/rest/*`. |
| Web app | React 19 + Vite, built to static files and served by the same process. Service worker and Cache Storage for offline playback. |
| Database | **SQLite** in WAL mode, one file on EBS. Schema migrates itself at startup. |
| Audio | Original files on the EBS volume. Served with HTTP range requests (seeking). No transcoding. Metadata read from tags by `mutagen`. |
| Uploads | Resumable, chunked (8 MiB chunks, 64 MiB maximum per request, 2 GiB per file). Staged on local disk, validated, held for admin review, then moved into the library. A background worker publishes scheduled releases and clears abandoned uploads every 30 seconds. |
| Auth | Short-lived JWT access tokens (1 hour), rotating refresh tokens stored in the database (60 days), per-device sessions, signed stream tokens in the URL for `<audio>` and images (6 hours). Secret key from an environment variable. |
| Social | Follows, profiles, avatars (local disk), presence heartbeat (each client sends "now playing" every 60 s) and friend activity (clients poll every 20 s). |
| Operations | A backup script (run from cron) can copy a consistent database snapshot to S3. Logs go to the Docker log driver. CI builds and tests on GitHub Actions. |

Documents in the repo that matter most: `docs/DEPLOY.md` (current setup), `docs/MOBILE_API.md` (API contract for
app developers), `docs/openapi.json`, `docs/superpowers/specs/2026-11-02-yaapu-design.md` (product design).

## 4. Workload characteristics

These shape the design more than anything else.

1. **The workload is mostly bandwidth, not compute.** A lossless stream is roughly 0.7 to 1.4 Mbps for 16-bit/44.1 kHz
   FLAC and 2 to 5 Mbps for 24-bit/96 kHz. One hour at 1 Mbps is about **0.45 GB** of egress. Egress cost and CDN design
   will dominate the bill, so the cost model must be driven by listening hours, not users.
2. **Audio is large, immutable and highly cacheable.** A track is 20 to 80 MB and never changes once published. A small
   share of tracks (new releases, charts) will account for most plays.
3. **Playback must start fast and survive bad networks** (mobile). Range requests, clean resume and a nearby edge matter.
4. **API traffic is small and spiky.** Auth, library, social and playlists are light JSON. Peaks follow releases,
   evenings and weekends.
5. **Uploads are large and bursty.** Artists and labels send multi-gigabyte files; label deliveries can be hundreds of
   files at once.
6. **Write patterns:** play events and presence updates are frequent small writes; everything else is read-heavy.
7. **Listeners spread across countries**, and licensed music is normally licensed per territory.

## 5. Scale assumptions **[confirm]**

We have no production numbers yet. Please design for the three stages below and tell us what each costs. We will
replace these placeholders with real targets once the business plan is final.

| | Private beta | Public launch | Growth |
|---|---|---|---|
| Monthly active users | 100 to 1,000 | 10,000 to 50,000 | 250,000 or more |
| Peak concurrent listeners | up to 100 | 1,000 to 5,000 | 25,000 or more |
| Catalogue | under 10,000 tracks | 100,000 to 1 million tracks | 5 million or more |
| Listening hours per user per month | 20 | 30 | 30 |

For sizing, assume peak concurrent listeners stream at an average of 1.5 Mbps.

## 6. Known blockers to scaling in the current code

We know where the single-server design stops working. These are the engineering changes the architecture has to
make possible. Some are application changes we will make with you; please tell us which you want first.

| Today | Problem at scale | Needed |
|---|---|---|
| SQLite on one EBS volume | One writer, one server, no failover. | Managed relational database (PostgreSQL on RDS or Aurora), multi-AZ, read replica when needed. |
| Audio files on local disk | Ties the app to one machine; cannot share across instances. | Object storage (S3) as the source of truth; delivery through a CDN. |
| Audio served by the app process | App servers carry all the bandwidth. | CloudFront in front of S3 with signed URLs or cookies; app servers only issue tokens. |
| Upload staging and avatars on local disk | Breaks with more than one instance. | S3 multipart or presigned uploads; a worker validates and moves files. |
| In-process state: upload locks, the scheduled-release worker, library scan thread, login throttle | Wrong or duplicated behaviour with more than one instance. | Job queue (for example SQS) and workers; Redis or the database for locks and rate limits; WAF rate rules for login. |
| The app sends the **whole library** to the client and filters it there (genres, new releases, search) | Fine for thousands of tracks; unusable for a public catalogue. | Paged catalogue API and a search service (for example OpenSearch). This is a significant application change. |
| Play counts are written by the client when playback passes a threshold | Not trustworthy enough for royalty reporting. | Server-side stream sessions and an append-only play-event stream with deduplication. |
| Charts query raw play rows | Slow at volume. | Pre-aggregated counters or a small analytics store; refresh on a schedule. |
| Presence heartbeat every 60 s, activity polled every 20 s | Wasteful at scale; no live push. | Redis for presence; WebSocket service for rooms and live updates (Phase 5). |
| Single secret key signs all tokens and derives the encryption of app passwords | Hard to rotate across instances. | Secrets Manager with versioned keys and a rotation plan. |

## 7. Requirements

### 7.1 Availability and performance (proposed targets **[confirm]**)

- API availability **99.9%** monthly; audio delivery **99.9%** monthly.
- Audio **time to first byte under 300 ms** at the 95th percentile on a good connection; no stalls on seek.
- API **p95 latency under 300 ms** for reads, under 800 ms for writes.
- Zero-downtime deploys, with fast rollback.
- RPO (data loss window) under 5 minutes for user data; RTO (recovery time) under 1 hour. Please propose what is
  realistic and what it costs.

### 7.2 Security and privacy

- TLS everywhere. WAF in front of public endpoints (OWASP rules, bot control, rate limits).
- Private S3 buckets; the CDN is the only public path to audio, using expiring signed access.
- Least-privilege IAM, no long-lived access keys, secrets in a managed store, encryption at rest and in transit
  (KMS), CloudTrail and GuardDuty on.
- User accounts, listening history and social graph are personal data. We need data-protection controls (encryption,
  access logging, retention and deletion). Account deletion is already built and required by the app stores.
- Payments must stay out of our servers: use a hosted payment provider so card data never touches AWS (keeps PCI scope minimal).
- Environments separated by AWS account (dev, staging, production).

### 7.3 Licensing and content protection **[confirm with our licensing contacts]**

- Labels usually require **territory restrictions** (a track available only in certain countries). The architecture
  should support geo-based control at the CDN and at the API.
- Some licensors require **content protection** beyond signed URLs (for example encrypted delivery with DRM). We do not
  know yet. Please design so signed, expiring delivery works now and encrypted delivery can be added later without
  rebuilding storage.
- Label deliveries arrive as DDEX packages (XML metadata plus audio and artwork), usually by SFTP or an S3 drop. We need a
  secure intake path and a pipeline that feeds the existing review flow.
- We need an audit trail of plays and takedowns for royalty reporting and legal requests.

### 7.4 Native mobile apps

- The API contract is versioned (`api_version`) and additive-only so shipped apps keep working; infrastructure
  changes must not break it.
- Offline downloads use the same audio endpoints, so the CDN must support long, resumable downloads.
- Push notifications (new releases, friend invites) will need a notification service (SNS or a managed provider) and
  device-token storage.
- Universal and app links for shared songs need a stable public domain and small static files served from it.

### 7.5 Operations

- Everything as code (Terraform or AWS CDK), reviewed through pull requests.
- CI/CD with automated tests, image scanning, staged promotion and one-click rollback. We use GitHub Actions today.
- Logs, metrics, traces and alarms with on-call alerting; dashboards for listening hours, start-up latency, error
  rate, upload failures and cost.
- Backups with tested restores; a written disaster-recovery runbook.
- Cost visibility: tags, budgets and alerts from day one.

## 8. Deliverables we are requesting

1. **Target architecture** for each of the three stages in section 5: diagrams (network, compute, data, delivery,
   deployment), the services chosen and the reason for each. Compare at least two options for compute (for example
   ECS on Fargate versus EKS versus EC2 auto scaling) and recommend one for our team size.
2. **Cost model** for each stage in section 5, broken into compute, database, storage, CDN and egress, and other
   services, with the assumptions written down and a view of what drives the cost most. Include ways to reduce egress cost.
3. **Migration plan** from the current single server to the target, with no loss of data and as little downtime as
   possible: database (SQLite to PostgreSQL), audio (disk to S3), cutover steps and rollback.
4. **Infrastructure as code** for the foundation (accounts, network, security baseline, CI/CD roles) and for the first
   production environment.
5. **CI/CD pipelines** for build, test, scan, deploy to staging and production, database migrations and rollback.
6. **Observability and alerting** setup with the dashboards and alarms listed in section 7.5.
7. **Security baseline and compliance notes**: WAF rules, IAM design, key management, logging, data-protection
   controls, and a short threat model for uploads, tokens and signed URLs.
8. **Disaster recovery and backup design** with proposed RPO and RTO and the cost of each option.
9. **A staged roadmap** that matches product phases (section 10) so infrastructure arrives when the product needs it.
10. **A list of application changes** you need from us (section 6), ordered by priority, with an effort estimate.

## 9. Questions we need answered

- What is the smallest architecture that safely supports a **private beta**, and what is the cheapest path to grow
  from it without a rewrite?
- Which **AWS region(s)** do you recommend for our listeners **[confirm: our main audience]**, and when does a second
  region or multi-region delivery make sense?
- CloudFront alone, or a mix with another CDN, for audio at our egress profile? What is the cost at each stage?
- Aurora or RDS PostgreSQL? Do you recommend a separate analytics store for play events and charts?
- What is the right way to deliver **very large uploads** safely and cheaply (presigned multipart, virus scanning,
  format validation on a worker)?
- How should we structure **accounts and environments**, and how do we keep a small team productive and safe?
- What should we **not** build yet (to avoid over-engineering at launch)?
- What would you want to see in a load test before launch, and can you help design it?

## 10. Product roadmap (so infrastructure matches it)

| Phase | Product work | Infrastructure it needs |
|---|---|---|
| 1 to 3 (done) | New design, social layer, discovery | Current single server is enough for a private beta. |
| Before public launch | None; engineering only | PostgreSQL, S3 and CDN delivery, queue and workers, observability, WAF, CI/CD, environments. |
| 4 | Artist growth tools: drops, pre-saves, share links, statistics | Scheduled jobs, analytics aggregation, public share pages at the edge. |
| 5 | Listening rooms, shared "blend" playlists, yearly recap | WebSocket service, Redis, pub/sub. |
| 6 | Subscriptions, payments, label deliveries, royalty reports | Payment-provider webhooks, DDEX intake pipeline, immutable play-event store, reporting jobs. |
| Mobile | iOS and Android apps | Push notifications, deep-link hosting, stable versioned API. |

## 11. Timeline and process

- Please share a high-level proposal (architecture options and a rough cost range) first, then a detailed design after we agree on direction.
- Target dates **[confirm]**: proposal by _date_, detailed design by _date_, private beta infrastructure by _date_.
- We would like a short working session to walk through the code and the current deployment before you start.

## Appendix: repository map

```
backend/    FastAPI app (app/routes: auth, library, uploads, social, discover, me, users, subsonic),
            scanner and upload pipeline (app/library.py, app/ingest.py), tests
frontend/   React web app and PWA (src/views, src/components, src/lib)
deploy/     Docker Compose, Caddyfile, backup script, env template
docs/       DEPLOY.md, MOBILE_API.md, openapi.json, design spec and plans
Dockerfile  One image: the built web app served by the API
```

Runtime dependencies are small: FastAPI, uvicorn, mutagen, PyJWT, bcrypt, cryptography, python-multipart, python-dotenv.
