// Offline provider marks; uncertain/unavailable assets use a letter (docs/PROVIDER-LOGOS.md).
import { AGENT_PROVIDER_LABEL, type AgentCli } from '@shared/agent-clis'
import logos from '../lib/provider-logos.json'
import { Initial } from './AccountIcon'

export function ProviderLogo({
  cli,
  size = 16,
  fallbackName
}: {
  cli: AgentCli
  size?: number
  fallbackName?: string
}) {
  const logo = (
    logos as Partial<Record<AgentCli, { width: number; height: number; body: string }>>
  )[cli]
  if (!logo) return <Initial name={fallbackName ?? AGENT_PROVIDER_LABEL[cli]} size={size} />
  return (
    <svg
      className="provider-logo"
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${logo.width} ${logo.height}`}
      dangerouslySetInnerHTML={{ __html: logo.body }}
    />
  )
}

export function AccountAvatar({
  name,
  cli,
  size = 24
}: {
  name: string
  cli: AgentCli
  size?: number
}) {
  return (
    <span className="account-avatar">
      <Initial name={name} size={size} />
      <span className="account-provider">
        <ProviderLogo cli={cli} size={12} fallbackName={name} />
      </span>
    </span>
  )
}
