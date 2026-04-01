import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { PasswordField } from "../components/PasswordField";

export function Login() {
  const { login, loading } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const role = await login(email, password);
      if (role === "admin") nav("/admin");
      else if (role === "hospital") nav("/hospital");
      else if (role === "ambulance") nav("/ambulance");
      else nav("/");
    } catch {
      setErr(
        "Invalid credentials, or account pending verification / inactive. Admins can sign in with their email or admin login ID."
      );
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Staff login</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Use your <strong className="text-slate-800 dark:text-slate-200">registered email</strong> for
        hospital and ambulance accounts.{" "}
        <strong className="text-slate-800 dark:text-slate-200">Admins</strong> may also use their{" "}
        <strong className="text-slate-800 dark:text-slate-200">admin login ID</strong> if one was set
        at bootstrap. Accounts must be <strong className="text-slate-800 dark:text-slate-200">approved</strong>{" "}
        (except admin).
      </p>
      <form onSubmit={onSubmit} className="card-panel space-y-4 p-6">
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-400">Email or admin login ID</span>
          <input
            type="text"
            required
            autoComplete="username"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@hospital.org or admin"
          />
        </label>
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          required
          autoComplete="current-password"
        />
        {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-teal-600 py-3 font-semibold text-white hover:bg-teal-500 disabled:opacity-50 dark:bg-teal-700 dark:hover:bg-teal-600"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="text-center text-sm text-slate-500">
        <Link to="/" className="text-teal-600 hover:underline dark:text-teal-400">
          Back home
        </Link>
      </p>
    </div>
  );
}
