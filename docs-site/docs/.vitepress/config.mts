import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'zkde.fi',
  description: 'Privacy-first Capital OS and Trade Desk on Starknet',
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
    ['link', { rel: 'icon', href: '/favicon.ico' }]
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Start', link: '/intro' },
      { text: 'Quick Start', link: '/quick-start' },
      { text: 'Capital OS', link: '/capital-os' },
      { text: 'Trade Desk', link: '/trade-desk' },
      { text: 'Systems', link: '/how-systems-work' },
      { text: 'API', link: '/api-overview' },
      { text: 'App', link: 'https://zkde.fi' }
    ],

    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'Introduction', link: '/intro' },
          { text: 'Quick Start', link: '/quick-start' },
          { text: 'App Overview', link: '/app-overview' }
        ]
      },
      {
        text: 'Use The Product',
        items: [
          { text: 'Capital OS', link: '/capital-os' },
          { text: 'Trade Desk', link: '/trade-desk' },
          { text: 'Profile And Identity', link: '/profile-and-identity' }
        ]
      },
      {
        text: 'How It Works',
        items: [
          { text: 'Privacy Features', link: '/privacy-features' },
          { text: 'How Systems Work', link: '/how-systems-work' }
        ]
      },
      {
        text: 'Technical Foundations',
        items: [
          { text: 'Technical Foundations', link: '/technical-foundations' },
          { text: 'Reputation System', link: '/reputation-system' },
          { text: 'Architecture Summary', link: '/architecture-summary' }
        ]
      },
      {
        text: 'Builders',
        items: [
          { text: 'API Overview', link: '/api-overview' },
          { text: 'Developers', link: '/developers' },
          { text: 'Contracts', link: '/contracts' },
          { text: 'Deploying zkde.fi', link: '/deploying-zkde-fi' }
        ]
      },
      {
        text: 'Reference',
        items: [
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
