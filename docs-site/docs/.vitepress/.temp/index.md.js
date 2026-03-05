import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"","description":"","frontmatter":{"layout":"home","hero":{"name":"zkde.fi","text":"AI capital allocation with verifiable risk analysis","tagline":"By Obsqra Labs — infrastructure for verifiable AI agents. Every decision is provably computed.","actions":[{"theme":"brand","text":"Start here","link":"/intro"},{"theme":"alt","text":"Open app","link":"https://zkde.fi","target":"_blank"}]}},"headers":[],"relativePath":"index.md","filePath":"index.md"}');
const _sfc_main = { name: "index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h2 id="what-is-zkde-fi" tabindex="-1">What Is zkde.fi? <a class="header-anchor" href="#what-is-zkde-fi" aria-label="Permalink to &quot;What Is zkde.fi?&quot;">​</a></h2><p>zkde.fi is an AI-driven capital allocator for DeFi on Starknet. Every risk assessment, anomaly detection, and strategy signal is backed by a cryptographic proof of the computation that produced it. Built on Obsqra&#39;s verifiable AI infrastructure.</p><h2 id="the-problem-it-solves" tabindex="-1">The Problem It Solves <a class="header-anchor" href="#the-problem-it-solves" aria-label="Permalink to &quot;The Problem It Solves&quot;">​</a></h2><p>Traditional DeFi automation relies on opaque off-chain bots. Users deposit capital and trust that some server is running the right algorithm on the right data. There is no way to verify that the risk check actually ran, or that the strategy recommendation was computed from real inputs.</p><h2 id="why-it-matters" tabindex="-1">Why It Matters <a class="header-anchor" href="#why-it-matters" aria-label="Permalink to &quot;Why It Matters&quot;">​</a></h2><p>zkde.fi introduces <strong>computation oracles</strong> — where AI decisions are proven, not just asserted. Risk scores come with mathematical proofs. Anomaly detection produces verifiable evidence. Smart contracts check these proofs before allowing capital to move. The result: AI-powered DeFi where you verify the AI instead of trusting it.</p><h2 id="core-navigation-model" tabindex="-1">Core Navigation Model <a class="header-anchor" href="#core-navigation-model" aria-label="Permalink to &quot;Core Navigation Model&quot;">​</a></h2><div class="language-mermaid vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">mermaid</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">flowchart LR</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  A[/agent?v=vault] --&gt; B[/agent?v=oracle]</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  B --&gt; C[/agent?v=brain]</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  A --&gt; D[/profile?tab=trust]</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  D --&gt; E[/profile?tab=reputation]</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#24292E", "--shiki-dark": "#E1E4E8" })}">  D --&gt; F[/profile?tab=compliance]</span></span></code></pre></div><p>Legacy compatibility: <code>/agent?v=trade</code> is still accepted and remapped to <code>v=oracle</code>.</p><h2 id="where-to-go-next" tabindex="-1">Where To Go Next <a class="header-anchor" href="#where-to-go-next" aria-label="Permalink to &quot;Where To Go Next&quot;">​</a></h2><ul><li><a href="/docs/intro.html">Introduction</a></li><li><a href="/docs/app-overview.html">App overview and routes</a></li><li><a href="/docs/api-overview.html">API overview</a></li><li><a href="/docs/developers.html">Developers</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
