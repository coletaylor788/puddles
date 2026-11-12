// Configure the official CLI's native MCP exposure. Link still owns login,
// API requests, approval polling, and credential creation.
export const authTools = ['auth_login', 'auth_status', 'auth_upgrade'];
export const insightTools = ['insights_list', 'insights_list-available-types',
  'transactions_list', 'balances_list', 'sources_list'];
export const paymentTools = ['approval-policy_retrieve', 'payment-methods_list',
  'payment-methods_retrieve', 'shipping-address_list', 'spend-request_create',
  'spend-request_request-approval', 'spend-request_retrieve'];

export function mcpTools(capability) {
  const selected = capability === 'payments' ? paymentTools : capability === 'insights' ? insightTools : null;
  if (!selected) throw new Error('Link requires a configured payments or insights capability');
  return { discovery: 'direct', include: [...authTools, ...selected] };
}

export function commandOptions(name, schema, z) {
  const forbid = (names) => Object.fromEntries(names.map(key => [key, z.never().optional()]));
  const polling = { interval: z.number().min(0).max(5).default(0),
    timeout: z.number().min(1).max(45).default(30), maxAttempts: z.number().int().min(0).max(10).default(0) };
  if (name === 'create') {
    return schema.safeExtend({ ...forbid(['outputFile', 'force', 'approve',
      'approvalDetail', 'useApprovalPolicy', 'recurringInterval',
      'recurringIntervalCount', 'completionCallbackUrl', 'nonce']),
      requestApproval: z.literal(true).default(true) }).strict();
  }
  if (name === 'retrieve') return schema.safeExtend({ ...forbid(['outputFile', 'force']), ...polling }).strict();
  if (name === 'status') return schema.safeExtend(polling).strict();
  if (name === 'login' || name === 'upgrade') {
    return schema.extend({
      scope: z.literal('userinfo:read payment_methods.agentic').default('userinfo:read payment_methods.agentic'),
      authorizationDetail: z.array(z.never()).default([]),
      clientName: z.literal(process.env.LINK_CLIENT_NAME || 'Personal Assistant').default(process.env.LINK_CLIENT_NAME || 'Personal Assistant'),
      sourceActions: z.tuple(['read_link_transactions', 'read_external_transactions', 'read_balances', 'read_source_details'].map(value => z.literal(value)))
        .default(['read_link_transactions', 'read_external_transactions', 'read_balances', 'read_source_details']),
      ...polling,
      interval: z.literal(0).default(0),
      ...(name === 'login' ? forbid(['financialInsights', 'agenticPayments']) : {}),
    }).strict();
  }
  throw new Error('Unknown Link schema selection');
}
