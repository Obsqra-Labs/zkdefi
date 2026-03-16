import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'zkde.fi',
  description: 'Proof-gated execution on Starknet — verifiable agent infrastructure by Obsqra Labs',
  base: '/docs/',
  markdown: {
    config(md) {
      const defaultFence = md.renderer.rules.fence
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx]
        const info = token.info.trim()

        if (info === 'mermaid') {
          const source = token.content.trim()
          const encoded = encodeURIComponent(source)
          const fallback = md.utils.escapeHtml(source)
          return `<pre class="mermaid" data-mermaid-source="${encoded}">${fallback}</pre>\n`
        }

        if (defaultFence) {
          return defaultFence(tokens, idx, options, env, self)
        }
        return self.renderToken(tokens, idx, options)
      }
    }
  },
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/docs/favicon.png' }],
    ['link', { rel: 'icon', type: 'image/x-icon', href: '/docs/favicon.ico' }],
    ['link', { rel: 'apple-touch-icon', href: '/docs/favicon.png' }],
    ['meta', { property: 'og:title', content: 'zkde.fi Docs — Hide everything. Prove anything.' }],
    ['meta', { property: 'og:description', content: 'Anonymous reputation. Proof-gated AI agents. Verifiable receipts. Zero-knowledge DeFi on Starknet.' }],
    ['meta', { property: 'og:image', content: '/docs/og-banner.png' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: '/docs/og-banner.png' }],
  ],

  themeConfig: {
    logo: '/favicon.png',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'The Primitive', link: '/intro' },
      { text: 'Live Proof', link: '/proof-readout' },
      { text: 'Proof Pipeline', link: '/proof-pipeline' },
      { text: 'API', link: '/api-overview' },
      { text: 'App', link: 'https://zkde.fi' }
    ],

    sidebar: [
      {
        text: 'What Was Built',
        items: [
          { text: 'The Primitive', link: '/intro' },
          { text: 'Live Proof Readout', link: '/proof-readout' },
          { text: 'Deployed Contracts', link: '/contracts' }
        ]
      },
      {
        text: 'How The Proof Works',
        items: [
          { text: 'Proof Pipeline', link: '/proof-pipeline' },
          { text: 'Privacy Rails', link: '/privacy-rails' },
          { text: 'zkML + Circuit Stack', link: '/zkml-circuits' }
        ]
      },
      {
        text: 'Using The System',
        items: [
          { text: 'Capital OS', link: '/capital-os' },
          { text: 'Trade Desk', link: '/trade-desk' },
          { text: 'Profile & Identity', link: '/profile-and-identity' }
        ]
      },
      {
        text: 'Builders',
        items: [
          { text: 'API Overview', link: '/api-overview' },
          { text: 'Developers', link: '/developers' },
          { text: 'Deploying zkde.fi', link: '/deploying-zkde-fi' }
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Architecture Summary', link: '/architecture-summary' },
          { text: 'Reputation System', link: '/reputation-system' },
          { text: 'FAQ', link: '/faq' },
          { text: 'Troubleshooting', link: '/troubleshooting' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/obsqra-labs/zkdefi' }
    ],

    footer: {
      message: 'Built by Obsqra Labs',
      copyright: 'Copyright 2026 Obsqra Labs'
    },

    search: {
      provider: 'local'
    }
  }
})
