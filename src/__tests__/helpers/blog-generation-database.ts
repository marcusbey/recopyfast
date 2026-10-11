/**
 * Schema-strict service-role double for s89's daily blog generation RPCs.
 *
 * The generic double verifies that the table columns and RPC names exist in the
 * migration ledger. This adapter supplies the three RPCs' state transitions so
 * route/library tests exercise the same claim-first contract as PostgreSQL. The
 * real transaction, locks, grants and RLS remain covered by
 * src/__tests__/db/blog-daily-draft.test.ts.
 */

import {
  createSchemaStrictDatabase,
  type DoubleError,
  type QueryResult,
  type Row,
  type SchemaStrictDatabase,
} from "./schema-strict-supabase";

const SUMMARY_COLUMNS = [
  "id",
  "title",
  "slug",
  "category",
  "status",
  "excerpt",
  "generated_on",
  "published_at",
  "created_at",
] as const;

function error(code: string, message: string): DoubleError {
  return { code, message, details: null, hint: null };
}

function ok(data: unknown): QueryResult {
  return { data, error: null, count: null };
}

function failed(code: string, message: string): QueryResult {
  return { data: null, error: error(code, message), count: null };
}

function text(args: Record<string, unknown>, name: string): string | null {
  const value = args[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function summary(row: Row): Row {
  return Object.fromEntries(
    SUMMARY_COLUMNS.map((column) => [column, row[column] ?? null]),
  );
}

export function createBlogGenerationDatabase(): SchemaStrictDatabase {
  const db: SchemaStrictDatabase = createSchemaStrictDatabase({
    uniqueKeys: {
      blog_posts: [["slug"], ["generated_on"]],
      blog_generation_claims: [["generated_on"]],
    },
    rpcHandlers: {
      async claim_daily_blog_generation(args) {
        const generatedOn = text(args, "p_generated_on");
        const ownerToken = text(args, "p_owner_token");
        if (!generatedOn || !ownerToken) {
          return failed(
            "22023",
            "daily blog generation needs a day and owner token",
          );
        }

        const existingPost = db
          .rows("blog_posts")
          .find((row) => row.generated_on === generatedOn);
        const existingClaim = db
          .rows("blog_generation_claims")
          .find((row) => row.generated_on === generatedOn);

        if (existingPost) {
          const completed = {
            status: "succeeded",
            post_id: existingPost.id,
            completed_at: "2026-10-09T14:00:30.000Z",
            updated_at: "2026-10-09T14:00:30.000Z",
          };
          if (existingClaim) {
            const update = await db.client
              .from("blog_generation_claims")
              .update(completed)
              .eq("generated_on", generatedOn);
            if (update.error) return update;
          } else {
            db.seed("blog_generation_claims", [
              {
                generated_on: generatedOn,
                owner_token: ownerToken,
                created_at: "2026-10-09T14:00:30.000Z",
                ...completed,
              },
            ]);
          }
          return ok([
            {
              outcome: "existing",
              claim_status: "succeeded",
              post_id: existingPost.id,
            },
          ]);
        }

        if (!existingClaim) {
          db.seed("blog_generation_claims", [
            {
              generated_on: generatedOn,
              status: "pending",
              owner_token: ownerToken,
              post_id: null,
              created_at: "2026-10-09T14:00:05.000Z",
              updated_at: "2026-10-09T14:00:05.000Z",
              completed_at: null,
            },
          ]);
          return ok([
            { outcome: "acquired", claim_status: "pending", post_id: null },
          ]);
        }

        return ok([
          {
            outcome:
              existingClaim.status === "pending" &&
              existingClaim.owner_token === ownerToken
                ? "acquired"
                : "existing",
            claim_status: existingClaim.status,
            post_id: existingClaim.post_id ?? null,
          },
        ]);
      },

      async complete_daily_blog_generation(args) {
        const generatedOn = text(args, "p_generated_on");
        const ownerToken = text(args, "p_owner_token");
        const title = text(args, "p_title");
        const slug = text(args, "p_slug");
        const content = text(args, "p_content");
        const category = text(args, "p_category");
        if (
          !generatedOn ||
          !ownerToken ||
          !title ||
          !slug ||
          !content ||
          !category
        ) {
          return failed(
            "22023",
            "daily blog completion received invalid input",
          );
        }

        const claim = db
          .rows("blog_generation_claims")
          .find((row) => row.generated_on === generatedOn);
        if (
          !claim ||
          claim.owner_token !== ownerToken ||
          claim.status !== "pending"
        ) {
          return failed(
            "42501",
            "daily blog claim is not owned by this invocation",
          );
        }

        let post = db
          .rows("blog_posts")
          .find((row) => row.generated_on === generatedOn);
        let created = false;

        if (!post) {
          const row = {
            title,
            slug,
            content,
            excerpt: args.p_excerpt ?? "",
            category,
            status: "draft",
            published_at: null,
            generated_on: generatedOn,
          };
          let insert = await db.client
            .from("blog_posts")
            .insert(row)
            .select(SUMMARY_COLUMNS.join(", "))
            .single();

          if (insert.error?.code === "23505") {
            post = db
              .rows("blog_posts")
              .find((candidate) => candidate.generated_on === generatedOn);
            if (!post) {
              insert = await db.client
                .from("blog_posts")
                .insert({ ...row, slug: `${slug}-${generatedOn}` })
                .select(SUMMARY_COLUMNS.join(", "))
                .single();
            }
          }
          if (!post) {
            if (insert.error) return insert;
            post = insert.data as Row;
            created = true;
          }
        }

        const update = await db.client
          .from("blog_generation_claims")
          .update({
            status: "succeeded",
            post_id: post.id,
            updated_at: "2026-10-09T14:00:30.000Z",
            completed_at: "2026-10-09T14:00:30.000Z",
          })
          .eq("generated_on", generatedOn)
          .eq("owner_token", ownerToken)
          .eq("status", "pending");
        if (update.error) return update;

        return ok([{ created, ...summary(post) }]);
      },

      async fail_daily_blog_generation(args) {
        const generatedOn = text(args, "p_generated_on");
        const ownerToken = text(args, "p_owner_token");
        if (!generatedOn || !ownerToken) return ok(false);

        const claim = db
          .rows("blog_generation_claims")
          .find((row) => row.generated_on === generatedOn);
        if (
          !claim ||
          claim.owner_token !== ownerToken ||
          claim.status !== "pending"
        ) {
          return ok(false);
        }

        const update = await db.client
          .from("blog_generation_claims")
          .update({
            status: "failed",
            post_id: null,
            updated_at: "2026-10-09T14:00:30.000Z",
            completed_at: "2026-10-09T14:00:30.000Z",
          })
          .eq("generated_on", generatedOn)
          .eq("owner_token", ownerToken)
          .eq("status", "pending");
        return update.error ? update : ok(true);
      },
    },
  });

  return db;
}
