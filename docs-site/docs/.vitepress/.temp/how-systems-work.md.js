import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"How Systems Work","description":"","frontmatter":{},"headers":[],"relativePath":"how-systems-work.md","filePath":"how-systems-work.md"}');
const _sfc_main = { name: "how-systems-work.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="how-systems-work" tabindex="-1">How Systems Work <a class="header-anchor" href="#how-systems-work" aria-label="Permalink to &quot;How Systems Work&quot;">​</a></h1><p>This is the operator map from UI action to proof/receipt state.</p><h2 id="system-path-ui-services-settlement" tabindex="-1">System Path (UI -&gt; Services -&gt; Settlement) <a class="header-anchor" href="#system-path-ui-services-settlement" aria-label="Permalink to &quot;System Path (UI -&gt; Services -&gt; Settlement)&quot;">​</a></h2><pre class="mermaid" data-mermaid-source="flowchart%20LR%0A%20%20UI%5BFrontend%3A%20%2Fprofile%20%2Fagent%20%2Ftrade%5D%20--%3E%20API8003%5Bzkde%20backend%20%3A8003%5D%0A%20%20API8003%20--%3E%20POL%5BPolicy%20%2B%20trust%20services%5D%0A%20%20API8003%20--%3E%20MKT%5BOpportunity%20%2B%20adapter%20services%5D%0A%20%20API8003%20--%3E%20EXEC%5BExecution%20builders%20%2B%20wallet%20signing%5D%0A%20%20API8003%20--%3E%20SEQ%5BProof%20sequencer%20bridge%5D%0A%20%20SEQ%20--%3E%20API8002%5Bobsqra%20backend%20%3A8002%5D%0A%20%20API8002%20--%3E%20MADARA%5BMadara%20proof%20chain%20%3A9944%5D%0A%20%20API8002%20--%3E%20L2%5BStarknet%20L2%20fallback%5D%0A%20%20EXEC%20--%3E%20L2%0A%20%20MADARA%20--%3E%20RCPT%5BReceipts%20%2B%20status%20updates%5D%0A%20%20L2%20--%3E%20RCPT%0A%20%20RCPT%20--%3E%20UI">flowchart LR
  UI[Frontend: /profile /agent /trade] --&gt; API8003[zkde backend :8003]
  API8003 --&gt; POL[Policy + trust services]
  API8003 --&gt; MKT[Opportunity + adapter services]
  API8003 --&gt; EXEC[Execution builders + wallet signing]
  API8003 --&gt; SEQ[Proof sequencer bridge]
  SEQ --&gt; API8002[obsqra backend :8002]
  API8002 --&gt; MADARA[Madara proof chain :9944]
  API8002 --&gt; L2[Starknet L2 fallback]
  EXEC --&gt; L2
  MADARA --&gt; RCPT[Receipts + status updates]
  L2 --&gt; RCPT
  RCPT --&gt; UI</pre><h2 id="route-responsibilities" tabindex="-1">Route Responsibilities <a class="header-anchor" href="#route-responsibilities" aria-label="Permalink to &quot;Route Responsibilities&quot;">​</a></h2><h3 id="profile" tabindex="-1"><code>/profile</code> <a class="header-anchor" href="#profile" aria-label="Permalink to &quot;\`/profile\`&quot;">​</a></h3><ul><li>Identity binding and trust/reputation context.</li><li>Gate readiness for flows that depend on policy thresholds.</li></ul><h3 id="agent-capital-os" tabindex="-1"><code>/agent</code> (Capital OS) <a class="header-anchor" href="#agent-capital-os" aria-label="Permalink to &quot;\`/agent\` (Capital OS)&quot;">​</a></h3><ul><li>Capital posture and orchestration controls.</li><li>Pre-trade checks and policy preparation.</li></ul><h3 id="trade-trade-desk" tabindex="-1"><code>/trade</code> (Trade Desk) <a class="header-anchor" href="#trade-trade-desk" aria-label="Permalink to &quot;\`/trade\` (Trade Desk)&quot;">​</a></h3><ul><li>Opportunity selection, adapter route selection, simulation, execution.</li></ul><h2 id="runtime-lifecycle" tabindex="-1">Runtime Lifecycle <a class="header-anchor" href="#runtime-lifecycle" aria-label="Permalink to &quot;Runtime Lifecycle&quot;">​</a></h2><ol><li>Load trust context (<code>/profile</code>).</li><li>Load opportunities + adapter metadata (<code>/trade</code>).</li><li>Evaluate gate/policy state for selected action.</li><li>Build and simulate calldata.</li><li>Sign + submit tx from wallet.</li><li>Reconcile receipts/outcomes back into UI state.</li><li>For proof flows, settlement updates arrive through sequencer path.</li></ol><h2 id="core-health-checks" tabindex="-1">Core Health Checks <a class="header-anchor" href="#core-health-checks" aria-label="Permalink to &quot;Core Health Checks&quot;">​</a></h2><ul><li><code>GET /api/v1/zkdefi/proofs/sequencer-status</code> (zkde backend)</li><li><code>GET /api/v1/aggregation/stats</code> (obsqra backend)</li><li><code>GET /api/v1/aggregation/madara/health</code> (obsqra backend)</li></ul><h2 id="common-failure-domains" tabindex="-1">Common Failure Domains <a class="header-anchor" href="#common-failure-domains" aria-label="Permalink to &quot;Common Failure Domains&quot;">​</a></h2><ul><li>Opportunity exists but adapter route metadata missing.</li><li>Gate state blocks execution despite valid-looking simulation.</li><li>Wallet submit failure after simulation success.</li><li>Sequencer/settlement unreachable (proof status stalls).</li></ul><h2 id="first-triage-order" tabindex="-1">First Triage Order <a class="header-anchor" href="#first-triage-order" aria-label="Permalink to &quot;First Triage Order&quot;">​</a></h2><ol><li>Verify route-level health checks above.</li><li>Verify adapter route exists for selected opportunity.</li><li>Re-run simulation with explicit slippage and current state.</li><li>Check settlement path health if proof-related state is stale.</li></ol><p>Next: <a href="/docs/quick-start.html">Quick Start</a> | <a href="/docs/capital-os.html">Capital OS</a> | <a href="/docs/trade-desk.html">Trade Desk</a></p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("how-systems-work.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const howSystemsWork = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  howSystemsWork as default
};
