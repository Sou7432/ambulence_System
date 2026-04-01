import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { PasswordField } from "../components/PasswordField";

/** Multipart registration; axios clears JSON Content-Type for FormData. */
export function AmbulanceRegister() {
  const [form, setForm] = useState({
    email: "",
    password: "",
    driver_name: "",
    ambulance_id: "",
    vehicle_number: "",
    license_number: "",
    contact_phone: "",
    ambulance_type: "BLS",
  });
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append("id_proof", file);
      await api.post("/api/ambulances/register", fd);
      setMsg("Submitted. Your crew remains pending until documents are verified.");
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error ?? "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Ambulance / crew registration</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Use a real email you can access for login (example: <code className="text-teal-700 dark:text-teal-300">crew@yourcompany.com</code>
        ). Upload ID proof (image/PDF). Admins approve BLS or ALS units before they appear on the live
        dispatch board.
      </p>
      <form onSubmit={submit} className="card-panel space-y-4 p-6">
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-400">Email (login)</span>
          <input
            type="text"
            inputMode="email"
            autoComplete="email"
            required
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="crew@example.com"
          />
        </label>
        <PasswordField
          label="Password (min 8 characters)"
          value={form.password}
          onChange={(v) => set("password", v)}
          required
          autoComplete="new-password"
        />
        {(
          [
            ["driver_name", "text"],
            ["ambulance_id", "text"],
            ["vehicle_number", "text"],
            ["license_number", "text"],
            ["contact_phone", "tel"],
          ] as const
        ).map(([key, type]) => (
          <label key={key} className="block text-sm">
            <span className="capitalize text-slate-600 dark:text-slate-400">
              {key.replace(/_/g, " ")}
            </span>
            <input
              type={type}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-400">Ambulance type</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            value={form.ambulance_type}
            onChange={(e) => set("ambulance_type", e.target.value)}
          >
            <option value="BLS">BLS</option>
            <option value="ALS">ALS</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-600 dark:text-slate-400">ID proof upload</span>
          <input
            type="file"
            className="mt-1 w-full text-sm text-slate-600 dark:text-slate-400"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
        {msg && <p className="text-sm text-teal-700 dark:text-teal-300">{msg}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-teal-700 py-3 font-semibold text-white hover:bg-teal-600 disabled:opacity-50 dark:bg-teal-800"
        >
          {loading ? "Submitting…" : "Submit for verification"}
        </button>
      </form>
      <p className="text-center text-sm">
        <Link to="/login" className="text-teal-600 hover:underline dark:text-teal-400">
          Approved crew? Log in
        </Link>
      </p>
    </div>
  );
}
