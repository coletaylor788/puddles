import { afterEach, expect, it, vi } from "vitest";
import { ContentEgressGuard } from "../src/egress/content-egress-guard.js";
import { ContactsEgressGuard } from "../src/egress/contacts-egress-guard.js";
afterEach(() => vi.restoreAllMocks());
it("allows clean content without a contact resolver, while ContactsEgressGuard still rejects strangers", async () => {
  const llm = { classify: vi.fn(async () => '{"detected":false}') };
  const contacts = { isTrustedEmail: vi.fn(async () => false) };
  expect((await new ContentEgressGuard(llm).check("send_email", "clean")).action).toBe("allow");
  expect((await new ContactsEgressGuard({ llm, contacts: contacts as never }).check("invite", "clean", { to: ["new@example.net"] })).action).toBe("block");
  expect(contacts.isTrustedEmail).toHaveBeenCalledExactlyOnceWith("new@example.net");
});
it.each(['{}', '{"detected":"false"}', 'null', 'bad PRIVATE_ECHO'])("fails closed on malformed classification %s without logging the payload", async raw => {
  const logs: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => { logs.push(String(chunk)); return true; });
  const verdict = await new ContentEgressGuard({ classify: async () => raw }).check("send_email", "PRIVATE_ECHO");
  expect(verdict.action).toBe("block");
  expect(logs.join("")).not.toContain("PRIVATE_ECHO");
});
it("does not log provider exception echoes", async () => {
  const logs: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: any) => { logs.push(String(chunk)); return true; });
  expect((await new ContentEgressGuard({ classify: async () => { throw new Error("PRIVATE_ECHO"); } }).check("send_email", "body")).action).toBe("block");
  expect(logs.join("")).not.toContain("PRIVATE_ECHO");
});
