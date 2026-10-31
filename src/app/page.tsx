import Link from "next/link";
import { TopBar } from "@/components/top-bar";

const FEATURES = [
  { title: "A database schema per organisation", body: "Each tenant’s data lives in its own PostgreSQL schema. Every query runs through a transaction scoped to that schema, so one organisation can’t reach another’s rows." },
  { title: "Roles and permissions", body: "Owners, admins, and members, checked on the server in every action through one permission map. The last owner can’t be removed." },
  { title: "Invites", body: "Single-use, expiring invite links tied to an email address. Tokens are stored hashed." },
  { title: "Audit log", body: "Every important change is recorded in the same transaction as the change itself." },
  { title: "Billing", body: "Stripe subscriptions behind a provider interface, verified webhooks, and plan limits on projects and members." },
  { title: "Tested", body: "Integration tests run against real PostgreSQL in CI, including tenant isolation and pooled-connection leaks." },
];

export default function Home() {
  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-16">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-slate-900">
          A multi-tenant SaaS starter with real tenant isolation.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-600">
          Next.js, TypeScript, and PostgreSQL with a schema per organisation, roles, invites, an audit log, and Stripe
          billing, ready to build your product on.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/sign-up" className="rounded-md bg-indigo-600 px-4 py-2.5 font-medium text-white shadow-sm hover:bg-indigo-500">
            Create an account
          </Link>
          <a
            href="https://github.com/WaifaiMT/saas-starter"
            className="rounded-md border border-slate-300 bg-white px-4 py-2.5 font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            View on GitHub
          </a>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-slate-900">{f.title}</h2>
              <p className="mt-2 text-sm text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
