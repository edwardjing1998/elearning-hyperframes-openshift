# HyperFrames Code Review Demo - OpenShift

This is a **standalone repository** for a Java source code review animation. It does NOT modify `elementary_math_practice_v2`.

- Browser: Java `UserService.java` review, timeline slider, four highlighted source lines.
- Backend: `POST /api/render` queues a 12-second MP4 job; `GET /api/jobs/:id` polls status.
- Rendering: official HyperFrames CLI + Chromium + FFmpeg, installed **inside the OpenShift image**.
- No FFmpeg, Docker, Node.js, or Chromium installation is required on the Mac if GitHub Actions performs the build.
- This project is a single-user **PoC**. It does not have production auth, persistence, scaling, or tenant isolation.

## Requirements

- An OpenShift namespace with sufficient CPU, memory, and ephemeral storage (default `edward-jing-dev`).
- GitHub Repository called `elearning-hyperframes-openshift` and GitHub Actions enabled.
- OpenShift CLI `oc` for first-time setup, or use OpenShift web console to create secrets.
- Permission to pull the GHCR image. A public package is easiest for a personal PoC. For a private package, create `ghcr-pull` secret as explained below.

## Deploy WITHOUT installing FFmpeg on Mac

1. Create a **new empty GitHub repository** named `elearning-hyperframes-openshift`, unzip this project, commit, and push it to `main`.
2. In GitHub repository **Settings > Environments > development**, configure:
   - Environment Variable `OPENSHIFT_SERVER` (e.g., `https://api...:6443`)
   - Environment Variable `OPENSHIFT_NAMESPACE` (e.g., `edward-jing-dev`)
   - Environment Secret `OPENSHIFT_TOKEN` (short-lived OpenShift token with access to the namespace)
   Note: GitHub Actions environment secrets are only available to jobs that declare `environment: development`.
3. Create the Render API secret **once** in OpenShift before workflow's deploy job:

   ```bash
   oc project edward-jing-dev
   read -rsp 'Choose a strong rendering API token (20+ characters): ' RENDER_API_TOKEN; echo
   printf '%s' "$RENDER_API_TOKEN" | oc create secret generic hyperframes-api \
     --from-file=RENDER_API_TOKEN=/dev/stdin --dry-run=client -o yaml | oc apply -f -
   # Keep the token in a secure password manager for the webpage; unset after saving.
   ```

4. If the GHCR package is **private**, create the container pull secret (requires a GitHub PAT with `read:packages`) in the same namespace:

   ```bash
   read -rsp 'GHCR PAT: ' GHCR_PAT; echo
   oc create secret docker-registry ghcr-pull \
     --docker-server=ghcr.io --docker-username='YOUR_GITHUB_USERNAME' \
     --docker-password="$GHCR_PAT" --dry-run=client -o yaml | oc apply -f -
   oc secrets link default ghcr-pull --for=pull
   unset GHCR_PAT
   ```

   If using a dedicated ServiceAccount, link the secret to that account instead of `default`.

5. Run GitHub Actions **Build and deploy HyperFrames renderer**, or push to `main`. **First-time setup**: the deployment manifest contains an image placeholder `REPLACE_OWNER`; the workflow's deploy step immediately replaces this via `oc set image`. `ImagePullBackOff` can be transient before this step; wait for final rollout.
6. Check:

   ```bash
   oc project edward-jing-dev
   oc get pods -l app=elearning-hyperframes-renderer
   oc get route elearning-hyperframes-renderer
   oc logs deployment/elearning-hyperframes-renderer --tail=100
   ```

7. Open HTTPS URL from `oc get route`, drag the timeline, enter your `RENDER_API_TOKEN`, and click **Generate 12s MP4**. The MP4 is generated on OpenShift and downloadable from the same webpage. No Mac FFmpeg installation.

### Important GitHub workflow note

To use Environment secrets in the **deploy** job, the workflow explicitly sets `environment: development`. A build job always runs first, using GitHub's built-in `GITHUB_TOKEN` with `packages: write` to push to GHCR. Your organization may need to enable package write permissions, and GitHub Packages visibility/pull rights must allow the OpenShift cluster to read it.

## API

```bash
export BASE_URL='https://YOUR_ROUTE.apps.example.com'
read -rsp 'API token: ' RENDER_API_TOKEN; echo
curl -fsS "$BASE_URL/healthz"

curl -fsS -X POST "$BASE_URL/api/render" \
  -H "Authorization: Bearer $RENDER_API_TOKEN"
# returns {"job_id":"...","status":"queued"}

export JOB_ID='REPLACE_RETURNED_JOB_ID'
curl -fsS "$BASE_URL/api/jobs/$JOB_ID" -H "Authorization: Bearer $RENDER_API_TOKEN"
curl -fsS "$BASE_URL/api/jobs/$JOB_ID/log" -H "Authorization: Bearer $RENDER_API_TOKEN"
curl -fSL "$BASE_URL/api/jobs/$JOB_ID/download" \
  -H "Authorization: Bearer $RENDER_API_TOKEN" -o review.mp4
```

## Files

```
Dockerfile                       Node 22 + Chromium + FFmpeg
package.json                     HyperFrames CLI + GSAP (versioned)
composition/index.html           HyperFrames 12s Java code review composition
public/index.html                Read-only preview + render submission UI
server.mjs                       Minimal authenticated REST API + one-at-a-time queue
openshift/deployment.yaml        Deployment, Service, TLS Route
.github/workflows/build-deploy.yml   GHCR container build, OpenShift deploy
```

## Known limitations / cautions

- Not verified with an actual OpenShift deployment or full MP4 render in this environment; verify with logs and official `hyperframes doctor`, `hyperframes lint`, and `hyperframes check` inside the built image.
- Docker build downloads Node dependencies, Chromium, FFmpeg **on the GitHub runner**, not on your Mac; GHCR stores the final image.
- Build can take time and the image can be large. Chromium on a restricted OpenShift SCC may require adjustment to browser launch flags or seccomp, depending on version and cluster policy. **Do not elevate to privileged SCC without security review.**
- Route hosts a public read-only composition demo. Rendering and downloading require `RENDER_API_TOKEN`. Configure additional network or OpenShift OAuth protection before using with private source code.
- Render jobs are held in memory and `/data` is an `emptyDir`. A Pod restart loses the queue and generated videos. For production, move jobs to a database/queue and render results to Azure Blob Storage.
- Runs one render at a time with two queued. Do not scale replicas until a shared job queue and shared storage exist.
- To minimize OpenShift resource pressure, resource requests are 0.5 CPU/1Gi and limits 2 CPU/4Gi. If namespace quota is tight, review `oc describe quota` and `oc describe limitrange` first.
- The GitHub Actions image tag is pinned by commit SHA. If `oc apply` resets it temporarily, `oc set image` fixes the running image.

## Official references

- https://github.com/heygen-com/hyperframes
- https://github.com/heygen-com/hyperframes/blob/main/packages/cli/README.md
- https://github.com/heygen-com/hyperframes/blob/main/docs/reference/html-schema.mdx
