import { useEffect, useState } from 'react'

export type PodMonacoOverflowWidgetOptions = {
  fixedOverflowWidgets: true
  overflowWidgetsDomNode: HTMLElement
}

/**
 * Pod: the editor's hover, suggestions and parameter hints render fixed in a host on
 * document.body, so the editor's overflow-clipped ancestors and the sidebars cannot cut
 * them off. One host per editor: Monaco tracks widget focus on it, so a shared host would
 * make every editor report focus.
 */
export function usePodMonacoOverflowWidgets(): PodMonacoOverflowWidgetOptions {
  const [options] = useState<PodMonacoOverflowWidgetOptions>(() => {
    const host = document.createElement('div')
    // Why the class: Monaco scopes its theme variables and widget styles to .monaco-editor.
    host.className = 'monaco-editor'
    host.dataset.testid = 'pod-monaco-overflow-widgets'
    host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0'
    return { fixedOverflowWidgets: true, overflowWidgetsDomNode: host }
  })
  useEffect(() => {
    document.body.appendChild(options.overflowWidgetsDomNode)
    return () => options.overflowWidgetsDomNode.remove()
  }, [options])
  return options
}
