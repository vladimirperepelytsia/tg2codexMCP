# Project website

The public landing page is built from `site/` and published to https://vladimirperepelytsia.github.io/tg2codexMCP/. It uses semantic HTML and CSS, system fonts and a local SVG favicon. No build framework, browser JavaScript, analytics, third-party assets or cookies are added by the page. GitHub Pages still processes normal hosting requests.

## Preview and verification

Run `npm run check:site` (also part of `npm run check`). It checks local assets, internal anchors, repository file links, metadata/landmarks and the exact publish file allowlist. It does not replace visual or accessibility review.

To reproduce project-path hosting, create a temporary directory containing a `tg2codexMCP` symlink to this checkout's `site` directory, then serve that temporary directory with `python3 -m http.server 4178 --bind 127.0.0.1`. Open `http://127.0.0.1:4178/tg2codexMCP/`. Do not serve the repository root, which may contain private local configuration. Stop the preview server after testing.

Check 1440 px desktop, 768 px tablet and 390/320 px mobile layouts; verify no horizontal page overflow, readable text, visible keyboard focus, the skip link, section navigation, scrollable command blocks, reduced-motion support, and working external documentation links. The command block builds/tests without credentials; setup instructions require replacing `<tg_channel_id>` with a real numeric Telegram ID. In shell snippets, quote placeholder values, e.g. `ALLOWED_CHAT_IDS='<tg_channel_id>'`, to avoid redirection. This placeholder is intentionally rejected by runtime validation until replaced.

## Publication

In repository Settings → Pages, select **GitHub Actions** as the source. `.github/workflows/pages.yml` validates and uploads only `site/`, then deploys using the `github-pages` environment. Deployment has only the required `pages: write` and `id-token: write` permissions; the build has read-only repository access. Every main push or manual workflow dispatch runs it. No bot or MCP service is deployed and no runtime secrets are needed.

The separate CI workflow supports manual dispatch with a `revision` input for checking an immutable earlier commit when a push run was not created. It prints the checked-out SHA in the job. A manual run's head SHA identifies the workflow revision; use the recorded checkout SHA to distinguish the code under test. Never infer a green check for a prior commit from testing only a later commit.

After deployment, verify the exact push SHA, both workflow results, the Pages environment URL, HTTP response and rendered public page. Keep the compatibility notice and verification matrix factual. Do not change repository visibility or configure domains/DNS as part of routine page updates.
