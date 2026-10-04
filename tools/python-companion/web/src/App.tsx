import { RequestToken } from "./components/RequestToken";
import { StatusDashboard } from "./components/StatusDashboard";

export function App() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="desk-shell">
        <header className="flex flex-col gap-4 border-b border-edge pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="desk-kicker">Desk buddy</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight">
              Grok on the bench
            </h1>
          </div>
          <div className="w-full sm:max-w-xs">
            <RequestToken />
          </div>
        </header>
        <StatusDashboard />
      </div>
    </main>
  );
}
