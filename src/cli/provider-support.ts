import { FakeProvider } from '../providers/fake-provider.js';
import { CodexProvider } from '../providers/codex-provider.js';
import type { AgentProvider, HarnessConfig } from '../types.js';

export function resolveProviderName(
  configProvider: HarnessConfig['provider'],
  override?: string
): HarnessConfig['provider'] | null {
  if (!override) return configProvider;
  return override === 'codex' || override === 'fake' ? override : null;
}

export function createProvider(providerName: HarnessConfig['provider'], cwd: string): AgentProvider {
  return providerName === 'fake' ? new FakeProvider() : new CodexProvider({ cwd });
}
