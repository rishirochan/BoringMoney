import { useEffect, useState } from "react";
import AiPage from "./features/ai/AiPage";
import SourcesPage from "./features/sources/SourcesPage";
import TransactionsPage from "./features/transactions/TransactionsPage";

type Page = "transactions" | "sources" | "ai";

function currentPage(): Page {
  if (window.location.hash === "#/sources") return "sources";
  if (window.location.hash === "#/ai") return "ai";
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
          <a href="#/sources" aria-current={page === "sources" ? "page" : undefined}>
            Sources
          </a>
          <a href="#/ai" aria-current={page === "ai" ? "page" : undefined}>
            Ask AI
          </a>
        </nav>
      </header>
      <div className="app-content">
        {page === "sources" ? <SourcesPage /> : page === "ai" ? <AiPage /> : <TransactionsPage />}
      </div>
    </main>
  );
}
