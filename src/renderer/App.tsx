import { useEffect, useState } from "react";
import AiPage from "./features/ai/AiPage";
import PilesPage from "./features/piles/PilesPage";
import SourcesPage from "./features/sources/SourcesPage";
import TransactionsPage from "./features/transactions/TransactionsPage";

type Page = "transactions" | "piles" | "sources" | "ai";

function currentPage(): Page {
  if (window.location.hash === "#/sources") return "sources";
  if (window.location.hash === "#/ai") return "ai";
  if (window.location.hash === "#/piles") return "piles";
  return "transactions";
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
          <a href="#/piles" aria-current={page === "piles" ? "page" : undefined}>
            Piles
          </a>
          <a href="#/ai" aria-current={page === "ai" ? "page" : undefined}>
            Ask AI
          </a>
          <a href="#/sources" aria-current={page === "sources" ? "page" : undefined}>
            Sources
          </a>
        </nav>
      </header>
      <div className="app-content">
        {page === "sources" ? <SourcesPage /> : page === "piles" ? <PilesPage /> : page === "ai" ? <AiPage /> : <TransactionsPage />}
      </div>
    </main>
  );
}
