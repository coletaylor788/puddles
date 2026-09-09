const reply = (id, text) => ({
  id,
  steps: [{ incoming: [{ text, guid: "reusable-fixture-guid" }], responses: [{ text: "Fixture reply." }], expect: { sends: ["Fixture reply."], promptIncludes: [text] } }],
});

export default [
  { ...reply("ordinary-conversation", "Say hello to the fixture."), expectBundledSkills: ["healthcheck", "skill-creator"] },
  {
    id: "conversation-history",
    steps: [
      { incoming: [{ text: "Remember the synthetic word lavender." }], responses: [{ text: "Remembered lavender." }], expect: { sends: ["Remembered lavender."] } },
      { incoming: [{ text: "Which word?" }], responses: [{ text: "Lavender." }], expect: { sends: ["Lavender."], promptIncludes: ["lavender", "Which word?"] } },
    ],
  },
  {
    id: "split-message-parts",
    inboundDebounceMs: null,
    steps: [{
      incoming: [{ text: "What link is this?", guid: "split-guid-text" }, { delayMs: 400, text: "https://example.test/item", guid: "split-guid-link", reply_to_guid: "split-guid-text", balloon_bundle_id: "com.apple.messages.URLBalloonProvider" }],
      responses: [{ text: "Received both parts." }],
      expect: { sends: ["Received both parts."], promptIncludes: ["What link is this?", "https://example.test/item"] },
    }],
  },
  {
    id: "recorded-tool-write",
    adapters: { fixture_write: { kind: "write", operations: ["create"] } },
    steps: [{
      incoming: [{ text: "Create a synthetic record with the fixture tool." }],
      responses: [{ toolCalls: [{ name: "fixture_write", args: { operation: "create", value: "synthetic record" } }] }, { text: "Recorded, not delivered." }],
      expect: { sends: ["Recorded, not delivered."] },
    }],
    expectCalls: [{ name: "fixture_write", args: { operation: "create", value: "synthetic record" }, kind: "write" }],
  },
  {
    id: "deterministic-tool-read",
    adapters: { fixture_read: { kind: "read", operations: ["list"], responses: { list: [{ title: "Synthetic appointment" }] } } },
    steps: [{
      incoming: [{ text: "Read the fixture appointments." }],
      responses: [{ toolCalls: [{ name: "fixture_read", args: { operation: "list" } }] }, { text: "Synthetic appointment." }],
      expect: { sends: ["Synthetic appointment."] },
    }],
    expectCalls: [{ name: "fixture_read", args: { operation: "list" }, kind: "read" }],
  },
  {
    id: "no-output",
    steps: [{ incoming: [{ text: "Do not reply." }], responses: [{ text: "NO_REPLY" }], expect: { sends: [], quietMs: 1800 } }],
  },
  {
    id: "model-error",
    steps: [{ incoming: [{ text: "Exercise a model failure." }], responses: [{ error: "Synthetic model failure" }], expect: { sends: ["Something went wrong while processing your request."] } }],
  },
  reply("fresh-state-reuses-guid", "This run must not inherit the prior replay cursor."),
];
