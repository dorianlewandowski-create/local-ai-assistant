import { config } from '../config';

class RuntimeSecurityState {
  private remoteSafeMode = config.security.remoteSafeMode;

  isRemoteSafeModeEnabled(): boolean {
    return this.remoteSafeMode;
  }

  setRemoteSafeMode(enabled: boolean): void {
    this.remoteSafeMode = enabled;
  }
}

export const runtimeSecurityState = new RuntimeSecurityState();
