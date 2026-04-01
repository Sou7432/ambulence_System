import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { PasswordField } from "../components/PasswordField";

export function HospitalRegister() {
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    address: "",
    latitude: "",
    longitude: "",
    uhid: "",
    hospital_type: "private",
    specialization: "",
    contact_phone: "",
    contact_email: "",
  });
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
      const { data } = await api.post("/api/hospitals/register", {
        ...form,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
      });
      setMsg(data.message ?? "Registered. Awaiting admin verification.");
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { error?: string } } };
      setErr(ax.response?.data?.error ?? "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Hospital registration</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        After submission, status is <code className="text-teal-700 dark:text-teal-300">pending</code> until an
        admin verifies your facility. Use a valid email for login (e.g. <code className="text-teal-700 dark:text-teal-300">admin@hospital.org</code>
        ).
      </p>
      <form onSubmit={submit} className="grid gap-4 card-panel p-6 md:grid-cols-2">
        <label className="block text-sm md:col-span-2">
          <span className="text-slate-600 dark:text-slate-400">Work email (login)</span>
          <input
            type="text"
            inputMode="email"
            autoComplete="email"
            required
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="admin@hospital.org"
          />
        </label>
        <div className="md:col-span-2">
          <PasswordField
            label="Password (min 8 characters)"
            value={form.password}
            onChange={(v) => set("password", v)}
            required
            autoComplete="new-password"
          />
        </div>
        {(
          [
            ["name", "text", "Hospital name"],
            ["address", "text", "Full address"],
            ["latitude", "number", "GPS latitude"],
            ["longitude", "number", "GPS longitude"],
            ["uhid", "text", "UHID / registration number"],
            ["hospital_type", "select", "Hospital type"],
            ["specialization", "text", "Specializations (comma-separated)"],
            ["contact_phone", "tel", "Hospital phone"],
            ["contact_email", "text", "Public contact email"],
          ] as const
        ).map(([key, type, label]) =>
          key === "hospital_type" ? (
            <label key={key} className="block text-sm md:col-span-2">
              <span className="text-slate-600 dark:text-slate-400">{label}</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                value={form.hospital_type}
                onChange={(e) => set("hospital_type", e.target.value)}
              >
                <option value="government">Government</option>
                <option value="private">Private</option>
              </select>
            </label>
          ) : (
            <label key={key} className="block text-sm">
              <span className="text-slate-600 dark:text-slate-400">{label}</span>
              <input
                type={type}
                required={key !== "contact_email"}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                value={form[key as keyof typeof form]}
                onChange={(e) => set(key, e.target.value)}
              />
            </label>
          )
        )}
        {err && <p className="md:col-span-2 text-sm text-red-600 dark:text-red-400">{err}</p>}
        {msg && <p className="md:col-span-2 text-sm text-teal-700 dark:text-teal-300">{msg}</p>}
        <button
          type="submit"
          disabled={loading}
          className="md:col-span-2 rounded-xl bg-teal-700 py-3 font-semibold text-white hover:bg-teal-600 disabled:opacity-50 dark:bg-teal-800"
        >
          {loading ? "Submitting…" : "Submit for verification"}
        </button>
      </form>
      <p className="text-center text-sm">
        <Link to="/login" className="text-teal-600 hover:underline dark:text-teal-400">
          Already verified? Log in
        </Link>
      </p>
    </div>
  );
}
