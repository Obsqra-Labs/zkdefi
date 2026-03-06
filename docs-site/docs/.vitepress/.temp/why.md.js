import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Why zkde.fi?","description":"","frontmatter":{},"headers":[],"relativePath":"why.md","filePath":"why.md"}');
const _sfc_main = { name: "why.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="why-zkde-fi" tabindex="-1">Why zkde.fi? <a class="header-anchor" href="#why-zkde-fi" aria-label="Permalink to &quot;Why zkde.fi?&quot;">​</a></h1><h2 id="the-problem" tabindex="-1">The Problem <a class="header-anchor" href="#the-problem" aria-label="Permalink to &quot;The Problem&quot;">​</a></h2><p>Many DeFi users face a forced tradeoff:</p><ul><li>full transparency that leaks strategy and timing</li><li>opaque delegation that weakens user assurance and auditability</li></ul><h2 id="why-this-matters" tabindex="-1">Why This Matters <a class="header-anchor" href="#why-this-matters" aria-label="Permalink to &quot;Why This Matters&quot;">​</a></h2><p>When privacy and trust cannot coexist, users either avoid automation or accept unnecessary risk.</p><h2 id="our-position" tabindex="-1">Our Position <a class="header-anchor" href="#our-position" aria-label="Permalink to &quot;Our Position&quot;">​</a></h2><p>zkde.fi focuses on privacy-aware execution with observable control surfaces:</p><ul><li>user-owned wallet execution</li><li>flow-specific verification behavior</li><li>delegated automation bounded by session constraints</li><li>trust context through profile and passport views</li></ul><h2 id="what-problem-this-solves" tabindex="-1">What Problem This Solves <a class="header-anchor" href="#what-problem-this-solves" aria-label="Permalink to &quot;What Problem This Solves&quot;">​</a></h2><p>It removes the false choice between complete exposure and complete opacity by giving users bounded, inspectable, and route-aware controls.</p><div class="language-mermaid vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">flowchart LR</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  T1[Full transparency] --&gt; X[User risk]</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  T2[Opaque automation] --&gt; X</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  Z[zkde.fi approach] --&gt; Y[Privacy-aware + observable execution]</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  Y --&gt; O[Better operational trust]</span></span></code></pre></div><p>Next: <a href="/docs/concepts.html">Concepts</a> | <a href="/docs/quick-start.html">Quick start</a></p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("why.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const why = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  why as default
};
