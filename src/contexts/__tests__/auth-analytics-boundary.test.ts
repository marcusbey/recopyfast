/** @jest-environment node */
jest.mock("@/lib/analytics/google-analytics/gtag", () => {
  throw new Error("Google runtime imported by root authentication");
});
jest.mock("@/lib/analytics/google-analytics/consent", () => {
  throw new Error(
    "Geography/runtime consent bundle imported by root authentication",
  );
});
jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));
it("root authentication can load first-party lifecycle controls without the deferred Google runtime", () => {
  expect(() => {
    // Module evaluation is the boundary: merely never calling GA is insufficient.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../AuthContext");
  }).not.toThrow();
});
