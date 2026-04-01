import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";

export function Layout({ children }: { children: React.ReactNode }) {
  const { token, role, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-grid bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200/90 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link
            to="/"
            className="flex items-center gap-2 text-lg font-semibold text-teal-700 dark:text-teal-300"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-clinical-700 text-white">
              A
            </span>
            AmbuSync
          </Link>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => toggleTheme()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              title="Toggle light / dark"
            >
              {theme === "dark" ? "Bright mode" : "Dark mode"}
            </button>
            <Link
              to="/request"
              className="rounded-lg bg-red-600 px-3 py-2 font-medium text-white shadow-lg shadow-red-900/20 hover:bg-red-500"
            >
              Request Ambulance
            </Link>
            <Link
              className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              to="/register/hospital"
            >
              Hospital signup
            </Link>
            <Link
              className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              to="/register/ambulance"
            >
              Ambulance signup
            </Link>
            {!token ? (
              <Link
                className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                to="/login"
              >
                Staff login
              </Link>
            ) : (
              <>
                {role === "admin" && (
                  <Link
                    className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    to="/admin"
                  >
                    Admin
                  </Link>
                )}
                {role === "hospital" && (
                  <Link
                    className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    to="/hospital"
                  >
                    Hospital
                  </Link>
                )}
                {role === "ambulance" && (
                  <Link
                    className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                    to="/ambulance"
                  >
                    Ambulance
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => logout()}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Log out
                </button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-500">
        Demo / hackathon build — not for real clinical decisions.
      </footer>
    </div>
  );
}
