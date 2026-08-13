type RuntimeConfig = {
  apiBaseUrl?: string;
  cognitoUserPoolId?: string;
  cognitoWebClientId?: string;
};

declare global {
  interface Window { wallyRuntimeConfig?: RuntimeConfig; }
}

const config = window.wallyRuntimeConfig;

export const apiBaseUrl = config?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/api';
export const cognitoUserPoolId = config?.cognitoUserPoolId ?? import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
export const cognitoWebClientId = config?.cognitoWebClientId ?? import.meta.env.VITE_COGNITO_WEB_CLIENT_ID as string | undefined;
