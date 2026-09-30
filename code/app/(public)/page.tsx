// Holding page until P4-02 builds the city selection.
export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6">
      <header>
        <p className="text-base font-bold">Company Map</p>
      </header>
      <main className="mt-18 sm:mt-24">
        <h1 className="max-w-[18ch] text-4xl font-bold sm:text-5xl">
          Find companies by where they work.
        </h1>
        <p className="mt-6 max-w-[60ch] text-lg text-muted-foreground">
          Bengaluru and Chennai come first. The map is being built.
        </p>
      </main>
    </div>
  );
}
