import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'zkde.fi',
  description: 'AI capital allocation with verifiable risk analysis — by Obsqra Labs',
  base: '/docs/',  
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }]
  ],
  
  themeConfig: {
    logo: '/logo.svg',
    
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Start', link: '/intro' },
      { text: 'Operate', link: '/app-overview' },
      { text: 'Build (GATE)', link: '/developers' },
      { text: 'API', link: '/api-overview' },
      { text: 'App', link: 'https://zkde.fi' }
    ],
    
    sidebar: [
      {
        text: 'Start Here',
        items: [
          { text: 'Introduction', link: '/intro' },
          { text: 'Why zkde.fi?', link: '/why' },
          { text: 'Concepts', link: '/concepts' },
          { text: 'Quick start (live app)', link: '/quick-start' },
          { text: 'First-time setup (live app)', link: '/guide-first-time-setup' },
          { text: 'Real-Time Updates', link: '/real-time-updates' },
          { text: 'Oracle Execution', link: '/oracle-execution' }
        ]
      },
      {
        text: 'Operate The App',
        items: [
          { text: 'App overview and routes', link: '/app-overview' },
          { text: 'Agent workspace', link: '/agent-dashboard' },
          { text: 'Deploy to Ekubo', link: '/guide-deploy-to-ekubo' },
          { text: 'Profile and identity', link: '/profile-and-identity' },
          { text: 'How execution flows', link: '/flow' }
        ]
      },
      {
        text: 'Verify And Control Risk',
        items: [
          { text: 'Reputation system', link: '/reputation-system' },
          { text: 'Risk Passport', link: '/risk-passport' },
          { text: 'Compliance and disclosure', link: '/compliance-and-disclosure' },
          { text: 'Privacy features', link: '/privacy-features' },
          { text: 'Session keys', link: '/session-keys' },
          { text: 'Rebalancing', link: '/rebalancing' },
          { text: 'zkML models', link: '/zkml-models' },
          { text: 'zkGraph Integration', link: '/zkgraph-integration' }
        ]
      },
      {
        text: 'Build And Integrate (GATE)',
        items: [
          { text: 'Architecture summary', link: '/architecture-summary' },
          { text: 'API overview', link: '/api-overview' },
          { text: 'Developers', link: '/developers' },
          { text: 'Contracts', link: '/contracts' },
          { text: 'Zero-Knowledge Circuits', link: '/circuits' },
          { text: 'Deploying zkde.fi', link: '/deploying-zkde-fi' },
          { text: 'AEGIS-1 (GATE standard)', link: '/aegis' }
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Innovation', link: '/innovation' },
          { text: 'Troubleshooting', link: '/troubleshooting' },
          { text: 'RPC Compatibility', link: '/rpc-compatibility' },
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
