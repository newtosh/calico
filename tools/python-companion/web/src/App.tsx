import { StatusDashboard } from "./components/StatusDashboard";

export function App() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        <header>
          <p className="text-xs tracking-[0.22em] text-muted uppercase">
            Desk buddy
          </p>
          <h1 className="text-3xl font-semibold">Grok on the bench</h1>
        </header>
        <StatusDashboard />
      </div>
    </main>
  );
}
