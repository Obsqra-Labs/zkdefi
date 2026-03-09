import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"App Overview","description":"","frontmatter":{},"headers":[],"relativePath":"app-overview.md","filePath":"app-overview.md"}');
const _sfc_main = { name: "app-overview.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="app-overview" tabindex="-1">App Overview <a class="header-anchor" href="#app-overview" aria-label="Permalink to &quot;App Overview&quot;">​</a></h1><p>This is the practical route map for current usage.</p><h2 id="primary-routes" tabindex="-1">Primary Routes <a class="header-anchor" href="#primary-routes" aria-label="Permalink to &quot;Primary Routes&quot;">​</a></h2><table tabindex="0"><thead><tr><th>Route</th><th>Purpose</th></tr></thead><tbody><tr><td><code>/</code></td><td>Landing and product context</td></tr><tr><td><code>/agent</code></td><td>Capital OS workspace</td></tr><tr><td><code>/trade</code></td><td>Trade Desk workspace</td></tr><tr><td><code>/profile</code></td><td>Identity, trust, reputation, compliance context</td></tr><tr><td><code>/privacy</code></td><td>Product privacy page</td></tr><tr><td><code>/docs</code></td><td>Documentation</td></tr></tbody></table><h2 id="recommended-user-path" tabindex="-1">Recommended User Path <a class="header-anchor" href="#recommended-user-path" aria-label="Permalink to &quot;Recommended User Path&quot;">​</a></h2><ol><li>Connect wallet at <code>/</code>.</li><li>Check trust/profile state in <code>/profile</code>.</li><li>Operate in <code>/agent</code> (Capital OS).</li><li>Execute in <code>/trade</code> (Trade Desk).</li><li>Return to <code>/profile</code> to review state and disclosures.</li></ol><h2 id="current-scope" tabindex="-1">Current Scope <a class="header-anchor" href="#current-scope" aria-label="Permalink to &quot;Current Scope&quot;">​</a></h2><ul><li>Production-facing user flows: <code>/agent</code>, <code>/trade</code>, <code>/profile</code>.</li><li>Additional pages can exist for experiments, but core docs prioritize the route set above.</li></ul><h2 id="notes-for-integrators" tabindex="-1">Notes For Integrators <a class="header-anchor" href="#notes-for-integrators" aria-label="Permalink to &quot;Notes For Integrators&quot;">​</a></h2><ul><li>Deep-link users to the exact surface they need (<code>/agent</code> vs <code>/trade</code>).</li><li>Do not assume old query-state route models in new integrations.</li><li>Keep support links explicit so reported issues are reproducible.</li></ul><p>Next: <a href="/docs/capital-os.html">Capital OS</a> | <a href="/docs/trade-desk.html">Trade Desk</a> | <a href="/docs/how-systems-work.html">How Systems Work</a></p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("app-overview.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const appOverview = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  appOverview as default
};
