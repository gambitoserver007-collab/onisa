# Provenance

- **Source repository:** https://github.com/dmmulroy/anti-slop
- **Fetched via:** `npx skills add dmmulroy/anti-slop --skill install-anti-slop`
  (skill installer), then `node <skill>/scripts/install.mjs` to copy the
  bundled plugin into this repo.
- **Exact git commit:** unknown -- the installer copies from a pre-bundled
  `assets/anti-slop` snapshot inside the skill package, not a live clone, so
  no commit SHA is retained locally. The skill package itself is pinned by a
  content hash in `skills-lock.json` at the repo root:
  `4031728fbe75bdcad6ee3208fd52b5d66e167b056fefee1fa9758e9a6cb9c0c8`.
- **Installed on:** 2026-09-16
- **Installed plugin paths:**
  - `tools/oxlint/anti-slop/index.ts` (generic plugin, registered in
    `.oxlintrc.json`)
  - `tools/oxlint/anti-slop/effect/index.ts` (opt-in Effect plugin, copied
    but **not registered** -- this repo has no `effect` dependency)
- **Intentional deviations from upstream:** none. Installed as-is; no local
  rule/config customization yet.
- **Verification on install:** `oxlint -c .oxlintrc.json .` ran clean of
  crashes/config errors against the full repo. It reported findings in
  existing application source (see the install report); those were **not**
  auto-fixed or otherwise addressed, since no cleanup was requested as part
  of this install.
