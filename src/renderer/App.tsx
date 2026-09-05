import { useEffect, useState } from "react";
import SourcesPage from "./features/sources/SourcesPage";
import TransactionsPage from "./features/transactions/TransactionsPage";

type Page = "transactions" | "sources";

function currentPage(): Page {
  return window.location.hash === "#/sources" ? "sources" : "transactions";
}

export default function App() {
  const [page, setPage] = useState(currentPage);

  useEffect(() => {
    const updatePage = () => setPage(currentPage());
    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);

  return (
    <main className="app-shell">
      <div className="glow" aria-hidden="true" />
      <header className="topbar glass">
        <div className="brand">
          <span className="brand-name">Boring Money</span>
          <span className="brand-tag">Local. Yours.</span>
        </div>
        <nav className="topnav" aria-label="Main navigation">
          <a href="#/" aria-current={page === "transactions" ? "page" : undefined}>
            Transactions
          </a>
          <a href="#/sources" aria-current={page === "sources" ? "page" : undefined}>
            Sources
          </a>
        </nav>
      </header>
      <div className="app-content">
        {page === "sources" ? <SourcesPage /> : <TransactionsPage />}
      </div>
    </main>
  );
}
