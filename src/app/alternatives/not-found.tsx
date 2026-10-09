import { ALTERNATIVES } from "@/content/alternatives";
import { Header } from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { Compass } from "lucide-react";
import Link from "next/link";

export default function AlternativesNotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white text-slate-900">
      <Header />
      <main className="mx-auto flex max-w-3xl flex-col items-center px-6 pb-24 pt-36 text-center">
        <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-100">
          <Compass aria-hidden="true" className="h-8 w-8 text-sky-600" />
        </div>
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Comparison not found
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
          We don&apos;t have that comparison yet. Here are the alternatives
          currently reviewed against public product documentation:
        </p>
        <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-3">
          {ALTERNATIVES.map((entry) => (
            <li key={entry.slug}>
              <Link
                href={`/alternatives/${entry.slug}`}
                className="font-medium text-sky-700 hover:underline"
              >
                {entry.name}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row">
          <Link
            href="/signup"
            className="pressable rounded-full bg-slate-900 px-8 py-4 font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Get started
          </Link>
          <Link
            href="/"
            className="px-6 py-4 font-medium text-slate-700 transition-colors hover:text-slate-900"
          >
            Back to home
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
