import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"First-Time Setup (Live App)","description":"","frontmatter":{},"headers":[],"relativePath":"guide-first-time-setup.md","filePath":"guide-first-time-setup.md"}');
const _sfc_main = { name: "guide-first-time-setup.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="first-time-setup-live-app" tabindex="-1">First-Time Setup (Live App) <a class="header-anchor" href="#first-time-setup-live-app" aria-label="Permalink to &quot;First-Time Setup (Live App)&quot;">​</a></h1><p>This guide expands on quick start and is meant to prevent the most common first-day misconfigurations.</p><h2 id="the-problem-this-solves" tabindex="-1">The Problem This Solves <a class="header-anchor" href="#the-problem-this-solves" aria-label="Permalink to &quot;The Problem This Solves&quot;">​</a></h2><p>Users often fail early because of network mismatch, missing testnet funds, or opening the wrong UI context from stale links.</p><h2 id="why-this-matters" tabindex="-1">Why This Matters <a class="header-anchor" href="#why-this-matters" aria-label="Permalink to &quot;Why This Matters&quot;">​</a></h2><p>If setup is correct once, later flows such as deployment, disclosure, and automation become predictable and reproducible.</p><h2 id="step-1-wallet-and-network" tabindex="-1">Step 1: Wallet And Network <a class="header-anchor" href="#step-1-wallet-and-network" aria-label="Permalink to &quot;Step 1: Wallet And Network&quot;">​</a></h2><p>Use a Starknet wallet and set network to <strong>Starknet Sepolia</strong>.</p><ul><li>ArgentX: <a href="https://www.argent.xyz/argent-x/" target="_blank" rel="noreferrer">https://www.argent.xyz/argent-x/</a></li><li>Braavos: <a href="https://braavos.app/" target="_blank" rel="noreferrer">https://braavos.app/</a></li></ul><h2 id="step-2-funding-context" tabindex="-1">Step 2: Funding Context <a class="header-anchor" href="#step-2-funding-context" aria-label="Permalink to &quot;Step 2: Funding Context&quot;">​</a></h2><p>You may need testnet funds for gas and certain execution paths.</p><ul><li>ETH for transaction gas</li><li>STRK for relevant operations in current testnet flows</li></ul><h2 id="step-3-connect-and-confirm-route-state" tabindex="-1">Step 3: Connect And Confirm Route State <a class="header-anchor" href="#step-3-connect-and-confirm-route-state" aria-label="Permalink to &quot;Step 3: Connect And Confirm Route State&quot;">​</a></h2><p>After connecting at <code>https://zkde.fi</code>, open canonical routes:</p><ul><li><code>/agent?v=vault</code></li><li><code>/profile?tab=trust</code></li></ul><p>Avoid starting from legacy deep links that use old <code>/agent?tab=</code> conventions.</p><h2 id="step-4-complete-first-operational-loop" tabindex="-1">Step 4: Complete First Operational Loop <a class="header-anchor" href="#step-4-complete-first-operational-loop" aria-label="Permalink to &quot;Step 4: Complete First Operational Loop&quot;">​</a></h2><pre class="mermaid" data-mermaid-source="sequenceDiagram%0A%20%20participant%20U%20as%20User%0A%20%20participant%20A%20as%20Agent%20surface%0A%20%20participant%20P%20as%20Profile%20surface%0A%0A%20%20U-%3E%3EA%3A%20Open%20%2Fagent%3Fv%3Dvault%0A%20%20U-%3E%3EA%3A%20Review%20deploy%20%2B%20portfolio%20context%0A%20%20U-%3E%3EA%3A%20Move%20to%20%2Fagent%3Fv%3Doracle%0A%20%20U-%3E%3EA%3A%20Review%20market%20signal%20controls%0A%20%20U-%3E%3EA%3A%20Open%20%2Fagent%3Fv%3Dvault%26sub%3Dtrade%20for%20execution%0A%20%20U-%3E%3EP%3A%20Open%20%2Fprofile%3Ftab%3Dtrust%0A%20%20U-%3E%3EP%3A%20Verify%20trust%20and%20readiness%20state">sequenceDiagram
  participant U as User
  participant A as Agent surface
  participant P as Profile surface

  U-&gt;&gt;A: Open /agent?v=vault
  U-&gt;&gt;A: Review deploy + portfolio context
  U-&gt;&gt;A: Move to /agent?v=oracle
  U-&gt;&gt;A: Review market signal controls
  U-&gt;&gt;A: Open /agent?v=vault&amp;sub=trade for execution
  U-&gt;&gt;P: Open /profile?tab=trust
  U-&gt;&gt;P: Verify trust and readiness state</pre><h2 id="what-this-setup-sequence-solves" tabindex="-1">What This Setup Sequence Solves <a class="header-anchor" href="#what-this-setup-sequence-solves" aria-label="Permalink to &quot;What This Setup Sequence Solves&quot;">​</a></h2><ul><li>Prevents route confusion from stale docs links</li><li>Establishes production path before experimental features</li><li>Gives users a clear trust/risk checkpoint before automation</li></ul><h2 id="key-fixtures-verified-2026-03-05" tabindex="-1">Key Fixtures (Verified 2026-03-05) <a class="header-anchor" href="#key-fixtures-verified-2026-03-05" aria-label="Permalink to &quot;Key Fixtures (Verified 2026-03-05)&quot;">​</a></h2><ul><li><code>/agent?v=vault</code></li><li><code>/agent?v=oracle</code></li><li><code>/agent?v=vault&amp;sub=trade</code></li><li><code>/profile?tab=trust</code></li></ul><p>Next: <a href="/docs/guide-deploy-to-ekubo.html">Deploy to Ekubo</a> | <a href="/docs/agent-dashboard.html">Agent workspace</a> | <a href="/docs/troubleshooting.html">Troubleshooting</a></p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("guide-first-time-setup.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const guideFirstTimeSetup = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  guideFirstTimeSetup as default
};
