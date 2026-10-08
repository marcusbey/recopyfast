/**
 * s68b M6 — the two code emails escape the site label.
 *
 * `sendStagingVerificationEmail` and `sendEditorAccessCode` interpolated
 * `siteLabel` raw into their HTML, though `escapeHtml` sat a few lines above
 * them and the invitation email already used it. The staging label is the
 * free-text `label` of `POST /api/staging/access`, chosen by any site admin and
 * mailed to an address that admin chooses — so a label could plant a link in
 * mail sent from our domain, next to a genuine code.
 *
 * The text body is plain text and unchanged: escaping it would put literal
 * `&lt;` in front of the reader.
 */

const mockResendSend = jest.fn();

jest.mock("resend", () => ({
  Resend: jest.fn(() => ({ emails: { send: mockResendSend } })),
}));

const LABEL = '<a href="https://evil.test">Reset password</a>';

describe("code emails escape the site label", () => {
  const originalApiKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test_placeholder";
    mockResendSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
  });

  afterAll(() => {
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
  });

  it.each([
    ["sendStagingVerificationEmail", "verification code"],
    ["sendEditorAccessCode", "editing code"],
  ] as const)(
    "%s escapes the label in HTML and keeps the text body",
    async (name, textLead) => {
      const email = await import("../resend");

      const result = await email[name]("editor@example.com", "482913", LABEL);

      expect(result.sent).toBe(true);
      const message = mockResendSend.mock.calls[0][0];
      expect(message.html).toContain(
        "&lt;a href=&quot;https://evil.test&quot;",
      );
      expect(message.html).not.toContain('<a href="https://evil.test"');
      expect(message.html).toContain("482913");
      expect(message.text).toContain(`${textLead} for ${LABEL} is: 482913`);
    },
  );
});

// A module, not a script: its mocks must not share scope with sibling suites.
export {};
