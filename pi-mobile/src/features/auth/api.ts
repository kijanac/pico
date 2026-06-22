import { rpc } from "@/shared/lib/rpc-client";

export const listAuthProviders = () => rpc((c) => c.auth.providers());

export const startAuthLogin = (providerId: string) => rpc((c) => c.auth.startLogin({ providerId }));

export const getAuthLoginJob = (jobId: string) => rpc((c) => c.auth.getLogin({ jobId }));

export const submitAuthLoginInput = (jobId: string, value: string) =>
  rpc((c) => c.auth.submitLoginInput({ jobId, value }));

export const saveAuthApiKey = (providerId: string, apiKey: string) =>
  rpc((c) => c.auth.saveApiKey({ providerId, apiKey }));

export const cancelAuthLogin = (jobId: string) => rpc((c) => c.auth.cancelLogin({ jobId }));
