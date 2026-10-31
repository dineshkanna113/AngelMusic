# Deploying AngelStream on AWS

One EC2 instance runs two containers: **Caddy** (HTTPS with automatic Let's Encrypt
certificates) and the **app** (FastAPI API + the built web app + the Subsonic API). The
database and the music live on a separate EBS volume, so the instance can be replaced
without touching them.

```
phone / browser ──HTTPS──▶ Caddy :443 ──▶ app :8000 ──▶ /data  (SQLite, staged uploads, backups)
                                                    └─▶ /music (the library)   both on EBS gp3
```

Why this shape: the app keeps its database in SQLite and the music as files, and runs as a
single process (upload locks, release scheduler). One well-sized instance serves a large
library and hundreds of concurrent listeners. It costs roughly **$20–35/month**
(t3.small/t3.medium + EBS), versus $150+ for the managed equivalent (ALB, ECS, RDS, EFS).

## 1. Create the infrastructure (console, ~15 minutes)

1. **EC2 → Launch instance**
   - Ubuntu Server 24.04 LTS, **x86_64**. Type **t3.small** (2 GB) to start; t3.medium if many
     people upload at once.
   - Key pair: create or choose one (for SSH).
   - Network: a public subnet, auto-assign public IP on.
   - Security group `angelstream`: inbound **22/tcp from your IP only**, **80/tcp** and
     **443/tcp** from anywhere, **443/udp** from anywhere (HTTP/3).
   - Storage: root 20 GB gp3. **Add volume**: gp3, sized for your music plus 50% for
     uploads (e.g. 200 GB), device `/dev/sdf`, **delete on termination: off**.
2. **Elastic IP**: allocate one and associate it with the instance, so the address survives
   restarts.
3. **DNS**: create an **A record**, e.g. `music.example.com`, pointing at the Elastic IP.
   (Route 53 or your registrar.) Caddy cannot get a certificate until this resolves.
4. **Backups (recommended)**
   - **EBS snapshots of the music volume**: EC2 → Lifecycle Manager → create a policy
     targeting the data volume (tag it `backup=angelstream`), daily, keep 7.
   - **Database to S3**: create a private bucket (e.g. `angelstream-backups-<account>`) with
     a lifecycle rule expiring objects after 30 days. Create an IAM role for EC2 with
     `s3:PutObject` on `arn:aws:s3:::angelstream-backups-<account>/*` and attach it to the
     instance (Actions → Security → Modify IAM role). No access keys go on the server.
5. **Billing alarm**: CloudWatch → Alarms → billing, so a surprise shows up early.

## 2. Prepare the server (SSH, ~10 minutes)

```bash
ssh -i your-key.pem ubuntu@music.example.com

# Docker + the compose plugin, and the AWS CLI for backups
sudo apt-get update && sudo apt-get install -y ca-certificates curl git unzip
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && newgrp docker
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip \
  && unzip -q /tmp/awscli.zip -d /tmp && sudo /tmp/aws/install

# Format and mount the data volume (first time only: mkfs erases it!)
lsblk                                   # find the 200G disk, usually /dev/nvme1n1
sudo mkfs.ext4 -L angelstream /dev/nvme1n1
sudo mkdir -p /srv/angelstream
echo 'LABEL=angelstream /srv/angelstream ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a

# Folders the app container (uid 10001) writes to
sudo mkdir -p /srv/angelstream/{data,music,src}
sudo chown -R 10001:10001 /srv/angelstream/data /srv/angelstream/music
sudo chown ubuntu:ubuntu /srv/angelstream/src
```

## 3. Deploy

```bash
cd /srv/angelstream/src
git clone https://github.com/dineshkanna113/lossless-stream-backend.git
git clone https://github.com/dineshkanna113/lossless-stream-frontend.git
# (while the work is on a branch: add  -b feature/production-rebuild  to both)

cd lossless-stream-backend/deploy
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # paste as SECRET_KEY
nano .env                               # DOMAIN, ACME_EMAIL, SECRET_KEY, BACKUP_S3_URI

docker compose up -d --build            # first build takes a few minutes
docker compose ps                       # app should become "healthy"
docker compose logs -f caddy            # watch for "certificate obtained successfully"
```

Create the first admin (public sign-up is closed until an admin exists, so nobody can grab
the server first):

```bash
docker compose exec app python -m app.manage create-user yourname --admin
```

Open `https://music.example.com` and sign in.

**Music**: copy files into `/srv/angelstream/music` (e.g. `rsync -av ./Music/ ubuntu@host:/srv/angelstream/music/`,
then `sudo chown -R 10001:10001 /srv/angelstream/music`) and press *Rescan library folder* in
Settings, or upload them in the app (Upload → Review).

**Backups**: `chmod +x backup.sh`, run it once by hand, then add the cron line from the top of
`backup.sh`.

## 4. Checks after deploying

```bash
curl -s https://music.example.com/api/health      # {"status":"ok",...}
curl -s https://music.example.com/api/config      # what mobile apps read at launch
curl -sI https://music.example.com | grep -i strict-transport
```

Play a track, seek in it (range requests), upload a file and approve it in Review.

## 5. Updating

```bash
cd /srv/angelstream/src
git -C lossless-stream-frontend pull && git -C lossless-stream-backend pull
cd lossless-stream-backend/deploy && docker compose up -d --build
docker image prune -f
```

The database migrates itself on start. Downtime is the few seconds the app restarts;
playback in progress resumes because the player retries from the same position.

## Operations

| Task | Command (in `deploy/`) |
|---|---|
| Logs | `docker compose logs -f app` |
| Users | `docker compose exec app python -m app.manage list-users` |
| Reset a password | `docker compose exec app python -m app.manage set-password <name>` |
| Rescan music | `docker compose exec app python -m app.manage scan` |
| Restore the database | stop the app, `gunzip` a backup to `/srv/angelstream/data/app.db`, `chown 10001`, start |
| Taken-down files | `/srv/angelstream/data/removed/<track-id>/` (move back into music and rescan to restore) |

## Security notes

- Only Caddy is exposed; the app port is internal. SSH is limited to your IP.
- `SECRET_KEY` signs every token: keep it out of git, and rotating it signs everyone out.
- Rotate the **Supabase keys** that were committed to the backend repo's history; they are
  not used by this app any more, but anyone with the repo can read them.
- The API's interactive docs are off in production; the schema is in `docs/openapi.json`.

## Growing later

When one box is no longer enough, the path is: music to **S3 + CloudFront** (signed URLs),
SQLite to **RDS PostgreSQL**, the app to **ECS Fargate** behind an ALB. The API contract
(`/api/...`, documented in `docs/MOBILE_API.md`) stays the same, so mobile apps don't change.
