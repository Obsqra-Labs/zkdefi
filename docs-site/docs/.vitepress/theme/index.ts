import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { onContentUpdated } from 'vitepress'

let mermaidPromise: Promise<typeof import('mermaid')> | null = null

function normalizeMermaidCodeFences(): void {
  if (import.meta.env.SSR) return

  const codeFences = Array.from(
    document.querySelectorAll<HTMLElement>('.vp-doc .language-mermaid')
  )

  for (const fence of codeFences) {
    const code = fence.querySelector('code')
    const source = code?.textContent?.trim()
    if (!source) continue

    const container = document.createElement('div')
    container.className = 'mermaid'
    container.setAttribute('data-mermaid-source', encodeURIComponent(source))
    container.textContent = source

    fence.replaceWith(container)
  }
}

async function renderMermaidDiagrams(): Promise<void> {
  if (import.meta.env.SSR) return

  normalizeMermaidCodeFences()

  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
  }
  const mermaidModule = await mermaidPromise
  const mermaid = mermaidModule.default

  const darkMode = document.documentElement.classList.contains('dark')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: darkMode ? 'dark' : 'default',
  })

  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>('.vp-doc .mermaid')
  )

  if (nodes.length === 0) return

  for (const node of nodes) {
    const encodedSource = node.getAttribute('data-mermaid-source')
    if (encodedSource) {
      try {
        node.textContent = decodeURIComponent(encodedSource)
      } catch {
        node.textContent = encodedSource
      }
    }
    node.removeAttribute('data-processed')
  }

  for (const node of nodes) {
    try {
      await mermaid.run({ nodes: [node] })
    } catch (error) {
      // Keep the source visible so docs remain useful when a diagram fails.
      console.error('Failed to render Mermaid diagram', error)
    }
  }
}

const theme: Theme = {
  ...DefaultTheme,
  enhanceApp(ctx) {
    DefaultTheme.enhanceApp?.(ctx)

    if (import.meta.env.SSR) return

    onContentUpdated(() => {
      void renderMermaidDiagrams()
    })

    // Re-render diagrams when theme switches (light/dark).
    const observer = new MutationObserver(() => {
      void renderMermaidDiagrams()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    void renderMermaidDiagrams()
  },
}

export default theme
