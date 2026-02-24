import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'zkde.fi',
  description: 'Privacy-preserving autonomous DeFi agent on Starknet',
  base: '/docs/',  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }]
  ],
  
  themeConfig: {
    logo: '/logo.svg',
    
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Docs', link: '/intro' },
      { text: 'zkML', link: '/zkml-models' },
      { text: 'AEGIS', link: '/aegis' },
      { text: 'App', link: 'https://zkde.fi' }
    ],
    
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/intro' },
          { text: 'Why zkde.fi?', link: '/why' },
          { text: 'Concepts', link: '/concepts' },
          { text: 'Quick start (live app)', link: '/quick-start' }
        ]
      },
      {
        text: 'Privacy Features',
        items: [
          { text: 'Overview', link: '/privacy-features' },
          { text: 'zkML Models', link: '/zkml-models' },
          { text: 'Session Keys', link: '/session-keys' },
          { text: 'Rebalancing', link: '/rebalancing' }
        ]
      },
      {
        text: 'How the app works',
        items: [
          { text: 'App overview and routes', link: '/app-overview' },
          { text: 'Agent dashboard', link: '/agent-dashboard' },
          { text: 'Profile and identity', link: '/profile-and-identity' },
          { text: 'Reputation system', link: '/reputation-system' },
          { text: 'Risk Passport', link: '/risk-passport' },
          { text: 'Compliance and disclosure', link: '/compliance-and-disclosure' }
        ]
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Flow', link: '/flow' },
          { text: 'Contracts', link: '/contracts' },
          { text: 'Innovation', link: '/innovation' }
        ]
      },
      {
        text: 'Standards',
        items: [
          { text: 'AEGIS-1', link: '/aegis' }
        ]
      },
      {
        text: 'Resources',
        items: [
          { text: 'Developers', link: '/developers' },
          { text: 'FAQ', link: '/faq' }
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
