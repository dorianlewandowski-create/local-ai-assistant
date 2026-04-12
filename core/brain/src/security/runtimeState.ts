import type { ApexConfig } from '../config'

class RuntimeSecurityState {
  private remoteSafeMode: boolean

  constructor(config: Pick<ApexConfig, 'security'>) {
    this.remoteSafeMode = config.security.remoteSafeMode
  }

  isRemoteSafeModeEnabled(): boolean {
    return this.remoteSafeMode
  }

  setRemoteSafeMode(enabled: boolean): void {
    this.remoteSafeMode = enabled
  }
}

// Default singleton uses the process-wide config.
// (Callers can also construct their own RuntimeSecurityState if needed.)
import { config } from '../config'
export const runtimeSecurityState = new RuntimeSecurityState(config)
