import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import { splitOmniDetails } from '../../../../shared/ae/omni-error-text'

/**
 * Pod: an Omni failure as one plain sentence, with the CLI's own output (usage dumps,
 * response bodies) folded behind "Details".
 */
export function OmniErrorNote({ text }: { text: string }): React.JSX.Element {
  const { summary, details } = splitOmniDetails(text)
  return (
    <div className="space-y-0.5 text-[11px]" data-testid="pod-omni-error">
      <p className="text-destructive">{summary}</p>
      {details && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="xs" className="group">
              <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
              {translate('pod.omni.errorDetails', 'Details')}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="scrollbar-sleek max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-1.5 font-mono text-[11px] text-muted-foreground">
              {details}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
