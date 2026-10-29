/** Runs the shipped embed source so upload auth cannot drift from the widget. */
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(
  path.join(process.cwd(), "public/embed/recopyfast.src.js"),
  "utf8",
);
const SITE_ID = "site-upload";
const SITE_TOKEN = "public-site-token";
const API = "https://app.recopyfast.test/api";

interface SentUpload {
  url: string;
  headers: Record<string, string>;
  body: FormData;
  withCredentials: boolean;
}

let sent: SentUpload[];

class FakeXhr {
  static latest: FakeXhr | null = null;
  upload: { onprogress?: (event: ProgressEvent) => void } = {};
  headers: Record<string, string> = {};
  method = "";
  url = "";
  timeout = 0;
  status = 200;
  responseText = JSON.stringify({
    url: "https://assets.example/image.png",
    width: 10,
    height: 8,
  });
  withCredentials = false;
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;

  constructor() {
    FakeXhr.latest = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: FormData) {
    sent.push({
      url: this.url,
      headers: { ...this.headers },
      body,
      withCredentials: this.withCredentials,
    });
    this.onload?.();
  }
}

function installScript() {
  const script = document.createElement("script");
  script.src = "https://app.recopyfast.test/embed/recopyfast.src.js";
  script.setAttribute("data-site-id", SITE_ID);
  script.setAttribute("data-site-token", SITE_TOKEN);
  script.setAttribute("data-api-url", API);
  document.head.appendChild(script);
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
}

async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

type Widget = {
  editorAuth: { grant: string } | null;
  editSessionToken: string | null;
  stagingToken: string | null;
  uploadImage(file: Blob, progress?: (value: number) => void): Promise<unknown>;
  destroy(): void;
};

async function boot(): Promise<Widget> {
  (window as unknown as { fetch: unknown }).fetch = jest.fn(
    async (input: string, init?: { method?: string }) => ({
      ok: true,
      status: 200,
      json: async () =>
        input.includes("/content/") && (init?.method ?? "GET") === "GET"
          ? []
          : { success: true },
    }),
  );
  new Function(SOURCE)();
  await settle();
  return (window as unknown as { ReCopyFast: Widget }).ReCopyFast;
}

describe("embed image upload editor credentials", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = '<img data-rcf-id="hero" src="/hero.png">';
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/pricing");
    (window as unknown as { ReCopyFast?: Widget }).ReCopyFast?.destroy();
    delete (window as unknown as { ReCopyFast?: Widget }).ReCopyFast;
    installScript();
    sent = [];
    (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["device grant", { grant: "device-grant", edit: null, staging: null }],
    ["edit session", { grant: null, edit: "edit-token", staging: null }],
    ["staging token", { grant: null, edit: null, staging: "staging-token" }],
  ])("sends %s without using the public site bearer", async (_label, auth) => {
    const widget = await boot();
    widget.editorAuth = auth.grant ? { grant: auth.grant } : null;
    widget.editSessionToken = auth.edit;
    widget.stagingToken = auth.staging;

    await expect(widget.uploadImage(new Blob(["image"]))).resolves.toEqual({
      url: "https://assets.example/image.png",
      width: 10,
      height: 8,
    });

    expect(sent).toHaveLength(1);
    const request = sent[0];
    expect(request.url).toBe(`${API}/upload/image`);
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.withCredentials).toBe(false);
    expect(request.body.get("siteId")).toBe(SITE_ID);
    expect(request.body.get("editToken")).toBe(auth.edit);
    expect(request.body.get("stagingToken")).toBe(auth.staging);
    expect(request.headers["X-RCF-Editor-Grant"]).toBe(auth.grant ?? undefined);
    expect(request.url).not.toContain("token");
  });
});
