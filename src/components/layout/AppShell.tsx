import type { PropsWithChildren } from "react";

export function AppShell({ children }: PropsWithChildren) {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">Liga</div>
        <nav>
          <a className="active" href="#dashboard">Dashboard</a>
          <a href="#champ-select">Champion Select</a>
          <a href="#builds">Buildy</a>
          <a href="#settings">Ustawienia</a>
          <a href="#logs">Logi</a>
        </nav>
      </aside>
      <div className="content">{children}</div>
    </main>
  );
}
