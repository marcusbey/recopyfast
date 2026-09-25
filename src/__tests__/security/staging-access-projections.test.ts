import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "src/lib/auth/staging-access.ts"),
  "utf8",
);

describe("staging_access user projections", () => {
  it("uses one explicit non-fingerprint projection for user create and list reads", () => {
    const declaration = source.match(
      /const STAGING_ACCESS_USER_COLUMNS =\s*(["'`])([\s\S]*?)\1;/,
    );

    expect(declaration).not.toBeNull();
    const columns = declaration?.[2].split(",").map((column) => column.trim());

    expect(columns).toEqual([
      "id",
      "site_id",
      "access_type",
      "email",
      "email_verified",
      "token",
      "permissions",
      "label",
      "created_by",
      "expires_at",
      "is_active",
      "last_used_at",
      "created_at",
    ]);
    expect(columns).not.toContain("verified_user_agent_hash");
    expect(columns).not.toContain("verified_origin_hash");

    expect(
      source.match(/\.select\(STAGING_ACCESS_USER_COLUMNS\)/g),
    ).toHaveLength(2);
  });
});
