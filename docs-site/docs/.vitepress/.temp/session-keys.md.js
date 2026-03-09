import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Session Keys","description":"","frontmatter":{},"headers":[],"relativePath":"session-keys.md","filePath":"session-keys.md"}');
const _sfc_main = { name: "session-keys.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="session-keys" tabindex="-1">Session Keys <a class="header-anchor" href="#session-keys" aria-label="Permalink to &quot;Session Keys&quot;">​</a></h1><p>Session keys are the delegation primitive behind autonomous execution controls in zkde.fi.</p><h2 id="the-problem-this-solves" tabindex="-1">The Problem This Solves <a class="header-anchor" href="#the-problem-this-solves" aria-label="Permalink to &quot;The Problem This Solves&quot;">​</a></h2><p>Requiring a full wallet signature for every micro-action makes automation impractical. But unconstrained delegation is unsafe.</p><h2 id="why-this-matters" tabindex="-1">Why This Matters <a class="header-anchor" href="#why-this-matters" aria-label="Permalink to &quot;Why This Matters&quot;">​</a></h2><p>Session keys provide bounded delegation: users grant temporary, scoped authority while retaining revocation control.</p><h2 id="delegation-lifecycle" tabindex="-1">Delegation Lifecycle <a class="header-anchor" href="#delegation-lifecycle" aria-label="Permalink to &quot;Delegation Lifecycle&quot;">​</a></h2><pre class="mermaid" data-mermaid-source="sequenceDiagram%0A%20%20participant%20U%20as%20User%0A%20%20participant%20API%20as%20Session%20API%0A%20%20participant%20W%20as%20Wallet%0A%20%20participant%20CH%20as%20Chain%0A%0A%20%20U-%3E%3EAPI%3A%20POST%20grant%20request%0A%20%20API--%3E%3EU%3A%20calldata%20%2B%20session%20metadata%0A%20%20U-%3E%3EW%3A%20Sign%20grant%20transaction%0A%20%20W-%3E%3ECH%3A%20Submit%20grant%0A%20%20U-%3E%3EAPI%3A%20POST%20grant%20confirm%0A%20%20API--%3E%3EU%3A%20session%20active%0A%20%20U-%3E%3EAPI%3A%20POST%20revoke%20(later)%0A%20%20U-%3E%3EW%3A%20Sign%20revoke%20transaction%0A%20%20U-%3E%3EAPI%3A%20POST%20revoke%20confirm">sequenceDiagram
  participant U as User
  participant API as Session API
  participant W as Wallet
  participant CH as Chain

  U-&gt;&gt;API: POST grant request
  API--&gt;&gt;U: calldata + session metadata
  U-&gt;&gt;W: Sign grant transaction
  W-&gt;&gt;CH: Submit grant
  U-&gt;&gt;API: POST grant confirm
  API--&gt;&gt;U: session active
  U-&gt;&gt;API: POST revoke (later)
  U-&gt;&gt;W: Sign revoke transaction
  U-&gt;&gt;API: POST revoke confirm</pre><h2 id="api-endpoints" tabindex="-1">API Endpoints <a class="header-anchor" href="#api-endpoints" aria-label="Permalink to &quot;API Endpoints&quot;">​</a></h2><table tabindex="0"><thead><tr><th>Method</th><th>Endpoint</th><th>Purpose</th></tr></thead><tbody><tr><td><code>POST</code></td><td><code>/api/v1/zkdefi/session_keys/grant</code></td><td>Build session grant request</td></tr><tr><td><code>POST</code></td><td><code>/api/v1/zkdefi/session_keys/grant/confirm</code></td><td>Confirm on-chain grant</td></tr><tr><td><code>POST</code></td><td><code>/api/v1/zkdefi/session_keys/revoke</code></td><td>Build revoke request</td></tr><tr><td><code>POST</code></td><td><code>/api/v1/zkdefi/session_keys/revoke/confirm</code></td><td>Confirm on-chain revoke</td></tr><tr><td><code>GET</code></td><td><code>/api/v1/zkdefi/session_keys/list/{owner_address}</code></td><td>List sessions</td></tr><tr><td><code>POST</code></td><td><code>/api/v1/zkdefi/session_keys/validate</code></td><td>Validate action under session</td></tr></tbody></table><h2 id="problem-it-solves-for-users" tabindex="-1">Problem It Solves For Users <a class="header-anchor" href="#problem-it-solves-for-users" aria-label="Permalink to &quot;Problem It Solves For Users&quot;">​</a></h2><p>Users can run automation in <code>/agent?v=brain</code> without approving every action manually, while still constraining session scope (for example max position and duration).</p><h2 id="why-it-matters-for-integrators" tabindex="-1">Why It Matters For Integrators <a class="header-anchor" href="#why-it-matters-for-integrators" aria-label="Permalink to &quot;Why It Matters For Integrators&quot;">​</a></h2><p>Integrators can build automation around an explicit lifecycle with durable identifiers (<code>session_id</code>) and confirmation checkpoints, rather than opaque background delegation.</p><h2 id="scope-and-protocol-mapping-note" tabindex="-1">Scope And Protocol Mapping Note <a class="header-anchor" href="#scope-and-protocol-mapping-note" aria-label="Permalink to &quot;Scope And Protocol Mapping Note&quot;">​</a></h2><p>Protocol bitmaps and allowed protocol labels are implementation details that can evolve. Integrators should consume returned payloads and endpoint responses rather than hardcoding assumptions from old docs snapshots.</p><h2 id="safety-guidance" tabindex="-1">Safety Guidance <a class="header-anchor" href="#safety-guidance" aria-label="Permalink to &quot;Safety Guidance&quot;">​</a></h2><ul><li>Keep short session durations for higher-risk strategies.</li><li>Revoke sessions proactively when strategy context changes.</li><li>Pair session delegation with profile/passport monitoring for safer operations.</li></ul><p>Next: <a href="/docs/rebalancing.html">Rebalancing</a> | <a href="/docs/agent-dashboard.html">Agent workspace</a> | <a href="/docs/api-overview.html">API overview</a></p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("session-keys.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const sessionKeys = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  sessionKeys as default
};
