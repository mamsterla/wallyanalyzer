export interface EmailConfirmationActions {
  requestCode(): Promise<void>;
  verifyAttribute(code: string): Promise<void>;
  refreshSession(): Promise<void>;
  confirmDurably(): Promise<void>;
}

export function requestEmailConfirmation(actions: Pick<EmailConfirmationActions, 'requestCode'>) {
  return actions.requestCode();
}

export async function completeEmailConfirmation(code: string, actions: Pick<EmailConfirmationActions, 'verifyAttribute' | 'refreshSession' | 'confirmDurably'>) {
  await actions.verifyAttribute(code);
  await actions.refreshSession();
  await actions.confirmDurably();
}
