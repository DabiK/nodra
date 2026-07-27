import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AgentPage } from "./components/AgentPage";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {location.pathname === "/agent.html" ? <AgentPage /> : <App />}
  </StrictMode>
);
