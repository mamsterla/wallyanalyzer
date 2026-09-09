import { AuthenticationDetails, CognitoUser, CognitoUserPool, type CognitoUserSession } from 'amazon-cognito-identity-js';
import { cognitoUserPoolId as poolId, cognitoWebClientId as clientId } from './runtimeConfig.js';

const pool = poolId && clientId ? new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId }) : undefined;
let authenticatedUser: CognitoUser | undefined;

// Credentials must never be entered on the temporary plaintext ALB. Local UI
// verification uses the separate mock API/auth harness, not Cognito browser auth.
export function configured() { return Boolean(pool) && window.location.protocol === 'https:'; }

function requiredUser() {
  if (!configured() || !pool) throw Error('HTTPS Cognito configuration required.');
  const user = authenticatedUser ?? pool.getCurrentUser();
  if (!user) throw Error('Sign in required.');
  authenticatedUser = user;
  return user;
}

function session(user: CognitoUser): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => user.getSession((error: Error | null, value: CognitoUserSession) => error ? reject(error) : resolve(value)));
}

export async function accessToken(): Promise<string> {
  return (await session(requiredUser())).getAccessToken().getJwtToken();
}

export async function refreshSession(): Promise<void> {
  const user = requiredUser();
  const current = await session(user);
  await new Promise<void>((resolve, reject) => user.refreshSession(current.getRefreshToken(), (error: Error | null) => error ? reject(error) : resolve()));
}

export async function login(email: string, password: string) {
  if (!configured() || !pool) throw Error('HTTPS Cognito configuration required.');
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise<void>((resolve, reject) => user.authenticateUser(new AuthenticationDetails({ Username: email, Password: password }), { onSuccess: () => { authenticatedUser = user; resolve(); }, onFailure: reject, newPasswordRequired: () => reject(Error('Temporary password must be changed.')) }));
}

export async function completeTemporaryPassword(email: string, temporaryPassword: string, newPassword: string) {
  if (!configured() || !pool) throw Error('HTTPS Cognito configuration required.');
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise<void>((resolve, reject) => user.authenticateUser(new AuthenticationDetails({ Username: email, Password: temporaryPassword }), { onSuccess: () => { authenticatedUser = user; resolve(); }, onFailure: reject, newPasswordRequired: () => user.completeNewPasswordChallenge(newPassword, {}, { onSuccess: () => { authenticatedUser = user; resolve(); }, onFailure: reject }) }));
}

export function logout() { authenticatedUser?.signOut(); pool?.getCurrentUser()?.signOut(); authenticatedUser = undefined; }

export async function forgotPassword(email: string) {
  if (!configured() || !pool) throw Error('HTTPS Cognito configuration required.');
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise<void>((resolve, reject) => user.forgotPassword({ onSuccess: () => resolve(), onFailure: reject, inputVerificationCode: () => resolve() }));
}

export async function resetPassword(email: string, code: string, password: string) {
  if (!configured() || !pool) throw Error('HTTPS Cognito configuration required.');
  const user = new CognitoUser({ Username: email, Pool: pool });
  return new Promise<void>((resolve, reject) => user.confirmPassword(code, password, { onSuccess: () => resolve(), onFailure: reject }));
}

export async function changePassword(oldPassword: string, newPassword: string) {
  const user = requiredUser();
  await session(user);
  return new Promise<void>((resolve, reject) => user.changePassword(oldPassword, newPassword, (error?: Error) => error ? reject(error) : resolve()));
}

export async function requestEmailVerificationCode() {
  const user = requiredUser();
  return new Promise<void>((resolve, reject) => user.getAttributeVerificationCode('email', { onSuccess: () => resolve(), onFailure: reject }));
}

export async function confirmEmailAttribute(code: string) {
  const user = requiredUser();
  return new Promise<void>((resolve, reject) => user.verifyAttribute('email', code, { onSuccess: () => resolve(), onFailure: reject }));
}
