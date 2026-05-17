export { type HookAction, type HookResult } from "./types.js";
export { type ContentClassification } from "./types.js";
export { type EgressHook, type IngressHook } from "./types.js";

export {
  type LLMClient,
  type ClassifyOptions,
  stripCodeFences,
} from "./llm-client.js";
export { loadLLMProvider } from "./load-llm-provider.js";
export { log, sanitize, type LogFields } from "./logger.js";

export { LeakGuard } from "./egress/leak-guard.js";
export {
  ContactsEgressGuard,
  type ContactsEgressGuardOptions,
  type ExtractDestinations,
} from "./egress/contacts-egress-guard.js";
export {
  ContactsTrustResolver,
  type ContactsTrustResolverOptions,
  type ContactsLogger,
} from "./contacts/contacts-trust.js";

export { InjectionGuard, type InjectionGuardPrefilter } from "./ingress/injection-guard.js";
export { SecretRedactor, type SecretRedactorPrefilter } from "./ingress/secret-redactor.js";
export {
  makeUntrustedKeysPrefilter,
  type UntrustedKeysPrefilterOptions,
  type SimplePrefilter,
} from "./ingress/untrusted-keys-prefilter.js";
