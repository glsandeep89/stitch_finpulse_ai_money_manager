import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { AuthProvider } from "./contexts/AuthContext";
import { ScopeProvider } from "./contexts/ScopeContext";

const SW_MIGRATION_KEY = "finpulse-sw-migration-precache-v1";

async function bootstrap() {
  if (import.meta.env.PROD) {
    try {
      if (!localStorage.getItem(SW_MIGRATION_KEY)) {
        const regs = await navigator.serviceWorker?.getRegistrations?.();
        if (regs && regs.length > 0) {
          await Promise.all(regs.map((r) => r.unregister()));
          localStorage.setItem(SW_MIGRATION_KEY, "1");
          window.location.reload();
          return;
        }
        localStorage.setItem(SW_MIGRATION_KEY, "1");
      }
    } catch {
      /* ignore */
    }
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <ScopeProvider>
            <App />
          </ScopeProvider>
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>
  );
}

void bootstrap();
