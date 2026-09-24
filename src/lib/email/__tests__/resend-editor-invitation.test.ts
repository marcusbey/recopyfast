const mockResendSend = jest.fn();

jest.mock("resend", () => ({
  Resend: jest.fn(() => ({ emails: { send: mockResendSend } })),
}));

describe("sendEditorInvitationEmail", () => {
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

  it("sends escaped HTML and text with one token-free editor-hub CTA", async () => {
    const { sendEditorInvitationEmail } = await import("../resend");

    const result = await sendEditorInvitationEmail({
      to: "editor@example.com",
      inviterEmail: 'owner+ops@example.com"><script>alert(1)</script>',
      siteName: "Client <Launch>",
      siteDomain: "client.example/?x=<bad>",
      permissions: ["view", "edit", "publish"],
      hubUrl: "https://app.recopyfa.st/edit",
    });

    expect(result.sent).toBe(true);
    expect(mockResendSend).toHaveBeenCalledTimes(1);

    const message = mockResendSend.mock.calls[0][0];
    expect(message.to).toBe("editor@example.com");
    expect(message.subject).toContain("Client <Launch>");
    expect(message.html).toContain("Client &lt;Launch&gt;");
    expect(message.html).toContain("client.example/?x=&lt;bad&gt;");
    expect(message.html).not.toContain("<script>");
    expect(message.html.match(/<a\b/g)).toHaveLength(1);
    expect(message.html).toContain('href="https://app.recopyfa.st/edit"');
    expect(message.html).toContain("View the site");
    expect(message.html).toContain("edit copy");
    expect(message.html).toContain("publish changes");
    expect(message.html).toContain("6-digit code");
    expect(message.html).toContain("no account or password");
    expect(message.html).not.toContain("token=");

    expect(message.text).toContain("owner+ops@example.com");
    expect(message.text).toContain("Client <Launch>");
    expect(message.text).toContain("client.example/?x=<bad>");
    expect(
      message.text.match(/https:\/\/app\.recopyfa\.st\/edit/g),
    ).toHaveLength(1);
    expect(message.text).toContain("6-digit code");
    expect(message.text).toContain("no account or password");
    expect(message.text).not.toContain("token=");
  });
});
