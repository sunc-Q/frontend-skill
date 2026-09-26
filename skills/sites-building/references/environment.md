# Qoder environment

## Project and source

Use the current task's original local project. Preserve its instructions, package manager, lockfile, source layout and installed components. For a new simple static site, create a dedicated public directory such as `web/` or `dist/`; a framework is optional. Existing applications keep their own setup and build scripts.

For a new React application in an empty project, use the bundled [React starter](../templates/react-starter/README.md). Run `node <sites-building-skill-root>/scripts/create-site.mjs <project-root>` with the real skill and current project paths, then run `npm ci` and `npm run dev` from the project root. The initializer checks Node 22.12+ in the 22.x series before copying and refuses to overwrite existing project files. Keep the selected Node directory in PATH for installation, development and build, including subsequent shell calls. Install once and reuse the lockfile; keep plain static sites lightweight and preserve existing applications. The starter includes a typed UI catalog, static build and optional local Function proxy, but does not allocate cloud resources.

Before cloud preparation, use `get_local_context` to read the current conversation directory. Both registered workspaces and standalone local conversations are supported. Build and prepare inside that directory; the host verifies it. Remote sessions are unsupported. To work elsewhere, open a conversation there and reuse the existing site IDs.

The generated `.站点名称.qoder.site` is a publication-preview descriptor, not editable hosting configuration or a source repository. It points to a prepared action and cannot recover missing source on another machine. Use the tools to write or refresh it. Reuse Project/Site/action IDs from the current task and tool results; if the intended site is ambiguous, resolve it with `list_sites` and `get_project`/`get_site` before writing.

## Runtime and output

| Concern | Qoder Sites implementation |
| --- | --- |
| Website | Static files with `index.html` in the selected `webDirectory` |
| SPA | `prepare_site.spa`; use the current routing contract in [Static output](static-site.md) |
| Server code | One `app` Edge Function from `functionDirectory/index.ts`; HTTP handler with self-contained imports |
| Browser-to-server calls | Same-origin `/functions/v1/app`, including supported subpaths/query actions |
| Database | Function-side Supabase adapter, reviewed schema/access policies and explicit runtime dependency |
| Files | Platform Storage through the injected Function SDK; owner file tools are separate administration |
| AI | [sites-build-agent-app](../../sites-build-agent-app/SKILL.md), using the `qoder` backend and server-only `QODER_PAT` |
| Draft and release | `prepare_site`, `get_publish_status`, `show_publish_confirmation`, `publish_site` |

Use [Functions and Secrets](functions.md) before server implementation. Do not assume a Node server, framework SSR process, Cloudflare Worker binding or deployment-time package installation is available. The packager does not compile application source or resolve missing dependencies. Framework applications must produce compatible static output and put required server behavior behind the Function.

Qoder supplies the current account and management authentication. Use the available `sites` tools, not a new management HTTP client or user-pasted PAT. Ordinary application Secret values are entered through Sites Settings; only names enter preparation inputs. Reserved platform Secrets remain inside their supported runtime boundaries.

## Local preview and testing

Start the project's existing development or preview command in a retained process, bound to loopback. For plain static files, use the local server example in [Static output](static-site.md). For Functions, use the same-origin development proxy and local handler setup in [Functions and Secrets](functions.md). Keep local fixture servers outside both output directories.

Read the server's actual URL and make a lightweight request to confirm the route serves successfully. A response check proves availability, not visual or functional correctness. Fix compilation or blocking runtime errors before presenting the first meaningful preview.

For local-only work or when the user asks to view development progress, use an available preview-opening tool or provide the exact URL. Hosted delivery uses the completed publication preview as its user-facing entry; keep the local URL internal and avoid opening a separate development browser by default. Read its current schema and reuse the same view and server where possible. No particular browser is required. Screenshots, DOM inspection and interaction testing run only when the user requests browser QA. Follow the [validation scope](../SKILL.md#validation-scope); report material unverified behavior without adding a checklist of unrelated tests.

Keep the server available while the user is reviewing or continuing local work. Record the PID and working directory of each server you start. Stop only that verified task-owned process when no longer needed; choose another free port when occupied. Do not kill processes by port, broad name patterns or unverified PID lists, even to recover a failed preview. Background work can skip a user-facing preview and still validate the output.

## Hosted delivery

Read [sites-hosting](../../sites-hosting/SKILL.md) after the requested website is complete and locally validated. That skill owns publication, draft recovery and preview handoff, including explicit requests to defer publication. `prepare_site` can create a project, allocate requested backend capabilities and upload artifacts; it is not a local preview command. Source commits, pushes and manually assembled outer manifests/archives are not publication prerequisites.

On Desktop, the Canvas preview renders the exact frozen static package. CLI returns the published site link or a deferred draft summary and does not open a Canvas. The preview does not execute Functions, supply website credentials or prove backend behavior. The final release and its access policy remain server-owned. Follow `sites-hosting` to publish by default and then show the preview; audience changes retain their separate authorization requirements.


Desktop `get_local_context` discovers `.qoder.site` files under the current workspace. Choose the intended site directory before preparation. Keep one site file per directory; multiple sites in one workspace use separate subdirectories. Preparation automatically reuses the current account’s verified directory binding. For an explicit request to create a new site for another account in the same source directory, follow [account switching](../../sites-hosting/references/deployment.md#switching-accounts-in-the-same-source-directory). Do not copy or edit a site file to create another site or change its publication identity. The file embeds the frozen homepage; original source and build output remain in the project.
