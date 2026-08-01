import type { Metadata } from "next";
import { EditorSignIn } from "./EditorSignIn";

export const metadata: Metadata = {
  title: "Edit your site — ReCopyFast",
  description: "Sign in with your email to edit the sites you have access to.",
  // Nothing here is useful in a search index, and the page exists to be typed
  // in directly rather than found.
  robots: { index: false, follow: false },
};

/**
 * recopyfast.com/edit — the cold-start entry point.
 *
 * The URL carries no secret, which is the whole point: forwarding it gives the
 * recipient nothing but a form asking for their own email address.
 */
export default function EditHubPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <EditorSignIn />
    </main>
  );
}
