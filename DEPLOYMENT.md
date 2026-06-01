# Deployment and real credential setup

Deploy the React client to Vercel, the Express API to Vercel, Railway, or Render,
and MongoDB to Atlas. Keep secrets in host environment variables only. Never
paste real values into `.env.example`, Git, screenshots, or chat.

## Environment variable map

| Variable | Host | Required for production | Purpose |
| --- | --- | --- | --- |
| `VITE_API_URL` | Vercel | Yes | Public Railway or Render API URL |
| `CLIENT_URL` | Railway or Render | Yes | Exact Vercel production origin, with no trailing slash |
| `JWT_SECRET` | Railway or Render | Yes | Private random signing secret |
| `DEV_LOGIN_ENABLED` | Railway or Render | Yes: set `false` | Prevent public dev-login access |
| `ANTHROPIC_API_KEY` | Railway or Render | To enable real plans | Standard Anthropic API key |
| `ANTHROPIC_MODEL` | Railway or Render | Recommended | Defaults to `claude-opus-4-8`; use `claude-sonnet-4-6` for lower cost |
| `MONGODB_URI` | Railway or Render | To persist data | Atlas SRV connection string |
| `GOOGLE_CLIENT_ID` | Railway or Render | To enable Google sign-in | Google web client ID |
| `GOOGLE_CLIENT_SECRET` | Railway or Render | No | Reserved for a future server-side OAuth flow |
| `YOUTUBE_API_KEY` | Railway or Render | To read playlist metadata | YouTube Data API key |

The API intentionally stays usable when optional integration values are absent:
that integration runs in stub mode. Check the active modes at `GET /api/health`.

## 1. Create the Atlas database

1. Open [MongoDB Atlas](https://cloud.mongodb.com/), create a project, and create
   a cluster.
2. In **Security > Database Access**, create a database user. This is separate
   from your Atlas website login.
3. In **Security > Network Access**, allow the API host to connect. Railway and
   Render outbound addresses depend on the selected service plan. For a first
   deployment, `0.0.0.0/0` is the simplest option; use a strong database password
   and tighten the allow list when your host provides stable outbound addresses.
4. In the cluster view, select **Connect > Drivers**, choose Node.js, and copy the
   `mongodb+srv://...` URI.
5. Replace the username, password, and database placeholder. Add a database name,
   for example:

   ```text
   mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/ai-study-platform?retryWrites=true&w=majority
   ```

6. If the username or password contains reserved URL characters such as `@`,
   URL-encode them before placing them in the URI.

Keep the completed value ready as `MONGODB_URI`.

## 2. Create the external credentials

### Anthropic

1. Open the [Anthropic Console](https://console.anthropic.com/settings/keys).
2. Create a standard API key for this app. Do not use an Admin API key.
3. Keep it ready as `ANTHROPIC_API_KEY`.
4. Use `claude-opus-4-8` for the highest quality or `claude-sonnet-4-6` to reduce
   cost and latency.

### Google sign-in

1. Open [Google Cloud Console](https://console.cloud.google.com/), create or
   select a project, and configure the OAuth consent screen if prompted.
2. Open **APIs & Services > Credentials > Create credentials > OAuth client ID**.
3. Choose **Web application**.
4. Under **Authorized JavaScript origins**, add `http://localhost:5173` now.
   After Vercel creates the frontend URL, return and add the exact production
   origin, for example `https://your-app.vercel.app`.
5. If the consent screen is in testing mode, add the Google accounts you will
   use under **Test users**.
6. Copy the client ID ending in `.apps.googleusercontent.com`. Keep it ready as
   `GOOGLE_CLIENT_ID`.

This app receives a Google Identity Services ID token in the browser and verifies
it on the API. It does not need a Google client secret or redirect URI.

### YouTube playlist metadata

1. In the same Google Cloud project, open
   [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
   and select **Enable**.
2. Open **APIs & Services > Credentials > Create credentials > API key**.
3. Open the new key, restrict **API restrictions** to **YouTube Data API v3**,
   and save it.
4. Keep it ready as `YOUTUBE_API_KEY`. The API uses it server-side, so do not put
   it in Vercel or expose it as a `VITE_` variable.

## 3. Deploy the API

Choose one API host. Vercel is the shortest CLI flow, Railway is the container
flow, and Render can read the committed `render.yaml` Blueprint.

### Vercel

The API exports the Express app from `server/src/index.ts`, so current Vercel
deployments can run it as one function without a separate container host:

```powershell
cd server
vercel deploy --prod
```

Set the same server environment variables listed in the Railway section below
in the Vercel project settings, then redeploy. Use the resulting Vercel URL as
the planner client's `VITE_API_URL`.

### Railway

1. Push this repository to GitHub and create a Railway project from the repo.
2. Create a service and set its **Root Directory** to `/server`.
   Railway will read `server/railway.toml` and build `server/Dockerfile`.
3. Add these service variables:

   ```text
   NODE_ENV=production
   DEV_LOGIN_ENABLED=false
   CLIENT_URL=https://temporary.invalid
   JWT_SECRET=<generate a long random value>
   ANTHROPIC_API_KEY=<your key>
   ANTHROPIC_MODEL=claude-opus-4-8
   MONGODB_URI=<your Atlas URI>
   GOOGLE_CLIENT_ID=<your web client ID>
   YOUTUBE_API_KEY=<your API key>
   ```

   Generate `JWT_SECRET` with a password manager or a cryptographically secure
   random generator. The API refuses to start in production if this value is
   missing or still looks like a placeholder.

4. Generate a public Railway domain and wait for deployment.
5. Open `https://YOUR-RAILWAY-DOMAIN/api/health`. It should return `"ok": true`.

### Render

1. Push this repository to GitHub.
2. In Render, create a **Blueprint** from the repo. Render reads `render.yaml`.
3. Enter values for the variables marked as secret prompts. Initially use
   `https://temporary.invalid` for `CLIENT_URL`.
4. Wait for deployment and open `https://YOUR-RENDER-DOMAIN/api/health`.

For either host, verify that the health response reports `"db": false`,
`"claude": false`, `"google": false`, and `"youtube": false` under `stub`.
A `false` value means the real integration is active.

## 4. Deploy the client to Vercel

1. Import the same GitHub repository into [Vercel](https://vercel.com/new).
2. Set the Vercel **Root Directory** to `client`.
3. Keep the detected Vite defaults: build command `npm run build` and output
   directory `dist`.
4. Add one Vercel environment variable for Production:

   ```text
   VITE_API_URL=https://YOUR-RAILWAY-OR-RENDER-DOMAIN
   ```

5. Deploy and copy the Vercel production URL.
6. In Railway or Render, replace `CLIENT_URL=https://temporary.invalid` with the
   exact Vercel origin, for example `https://your-app.vercel.app`, then redeploy
   the API.
7. In Google Cloud, add that same Vercel origin under the OAuth client's
   **Authorized JavaScript origins**.

## 5. Smoke test the real deployment

1. Open `https://YOUR-API-DOMAIN/api/health` and confirm all four stub flags are
   `false`.
2. Open the Vercel URL. Confirm the Google sign-in button appears and dev login
   does not.
3. Sign in with Google.
4. Create a plan from a public YouTube playlist URL containing a `list=...`
   parameter.
5. Refresh the page and reopen the saved plan. Mark day 1 complete.
6. In Atlas, open **Browse Collections** and confirm that users, plans, courses,
   conversations, and progress records appear.

## Local real-key walkthrough

To test before deploying, copy `server/.env.example` to `server/.env`, replace
the four real service values, set a random `JWT_SECRET`, and leave
`DEV_LOGIN_ENABLED=true`. Copy `client/.env.example` to `client/.env`. Restart
both dev servers after changing environment variables, then inspect
`http://localhost:4000/api/health`.

Only these server values need replacing:

```text
ANTHROPIC_API_KEY=<your standard Anthropic API key>
MONGODB_URI=<your completed Atlas SRV URI>
JWT_SECRET=<a long random local value>
GOOGLE_CLIENT_ID=<your Google web client ID>
YOUTUBE_API_KEY=<your restricted YouTube Data API key>
```
