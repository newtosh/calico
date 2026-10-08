export function AboutSection({ version }: { version: string }) {
  return (
    <section>
      <h2 className="section-title">About</h2>
      <p className="px-4 pb-1">Calico {version}</p>
    </section>
  );
}
