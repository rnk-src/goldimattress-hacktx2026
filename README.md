# GoldiMattress

GoldiMattress is a phone-only web app for comparing the feel of mattresses, couches, chairs, cushions, and pads with a surface you already like.

## Local development

Use Node.js 22 or newer and install the locked dependencies before starting Vite:

```bash
npm ci
npm run dev
```

Vite prints the local address and normally uses port `5173`. ngrok connects to localhost, so the server does not need to listen on the network.

## Test on an iPhone over HTTPS

iOS only exposes motion permission from a secure page and a user gesture. A LAN `http://` address is therefore not enough. With the Vite server still running, start [ngrok](https://ngrok.com/download) in a second terminal:

```bash
ngrok http 5173
```

Open the forwarding address beginning with `https://` on the iPhone. If Vite selected a different port, pass that port to ngrok instead.

Vite checks the incoming `Host` header. `vite.config.ts` permits the current ngrok suffixes `.ngrok-free.app` and `.ngrok.app`; it does not enable the unsafe `allowedHosts: true` setting. If ngrok assigns a hostname with a new suffix, add that exact hostname or suffix to `server.allowedHosts` and restart Vite.

For motion testing, tap the app's **Enable motion** control on the phone. Do not try to trigger the iOS permission prompt from desktop developer tools or on page load: Safari requires the request to originate in a real tap.

## Checks and production build

```bash
npm run check
npm run build
```

The production build is written to `dist/` with the repository base path `/goldimattress-hacktx2026/`.

## GitHub Pages deployment

The CI workflow installs dependencies with `npm ci` and runs `npm run check` for every push and pull request. A separate workflow builds and deploys `dist/` after each push to `main`.

Before the first deployment, open the repository's **Settings → Pages** and set **Source** to **GitHub Actions**. After a change reaches `main`:

1. Open **Actions → Deploy GitHub Pages** and confirm both the `build` and `deploy` jobs succeed.
2. On a phone, open <https://rnk-src.github.io/goldimattress-hacktx2026/> over HTTPS.
3. Confirm the page loads without a 404 and refreshes successfully on the same repository URL.
4. Once the motion capture screen is available, tap **Enable motion** on a real iPhone and confirm Safari shows the motion-access prompt.

