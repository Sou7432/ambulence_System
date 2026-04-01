import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

type Hosp = {
  public_id: string;
  name: string;
  email: string;
  verification_status: string;
  uhid?: string;
  hospital_type?: string;
  contact_phone?: string;
};

type Amb = {
  ambulance_id: string;
  driver_name: string;
  email: string;
  verification_status: string;
  ambulance_type?: string;
  vehicle_number?: string;
  contact_phone?: string;
};

export function AdminDashboard() {
  const [hospitals, setHospitals] = useState<Hosp[]>([]);
  const [ambulances, setAmbulances] = useState<Amb[]>([]);
  const [noteH, setNoteH] = useState<Record<string, string>>({});
  const [noteA, setNoteA] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [h, a] = await Promise.all([
        api.get<{ hospitals: Hosp[] }>("/api/hospitals/pending"),
        api.get<{ ambulances: Amb[] }>("/api/ambulances/pending"),
      ]);
      setHospitals(h.data.hospitals);
      setAmbulances(a.data.ambulances);
    } catch {
      setErr("Could not load pending registrations. Sign in with a valid admin email or admin login ID.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const verifyHospital = async (public_id: string, status: "approved" | "rejected") => {
    await api.post(`/api/admin/hospitals/${public_id}/verification`, {
      status,
      note: noteH[public_id] ?? "",
    });
    await load();
  };

  const verifyAmbulance = async (
    ambulance_id: string,
    status: "approved" | "rejected"
  ) => {
    await api.post(`/api/admin/ambulances/${ambulance_id}/verification`, {
      status,
      note: noteA[ambulance_id] ?? "",
    });
    await load();
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Admin — verification queue</h1>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>
      {err && <p className="text-red-600 dark:text-red-400">{err}</p>}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-teal-700 dark:text-teal-300">Pending hospitals</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
            <thead className="bg-slate-100/80 text-slate-600 dark:bg-slate-900/80 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">UHID</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Note</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {hospitals.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-slate-500">
                    No pending hospitals.
                  </td>
                </tr>
              )}
              {hospitals.map((h) => (
                <tr key={h.public_id} className="bg-white/50 dark:bg-slate-950/40">
                  <td className="px-4 py-2 text-slate-900 dark:text-white">{h.name}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{h.email}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{h.contact_phone ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{h.uhid}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{h.hospital_type}</td>
                  <td className="px-4 py-2">
                    <input
                      className="w-40 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                      placeholder="Admin note"
                      value={noteH[h.public_id] ?? ""}
                      onChange={(e) =>
                        setNoteH((m) => ({ ...m, [h.public_id]: e.target.value }))
                      }
                    />
                  </td>
                  <td className="space-x-2 px-4 py-2">
                    <button
                      type="button"
                      className="rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600"
                      onClick={() => void verifyHospital(h.public_id, "approved")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="rounded bg-red-800 px-2 py-1 text-xs text-white hover:bg-red-700"
                      onClick={() => void verifyHospital(h.public_id, "rejected")}
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-teal-700 dark:text-teal-300">Pending ambulances</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
            <thead className="bg-slate-100/80 text-slate-600 dark:bg-slate-900/80 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">ID</th>
                <th className="px-4 py-2">Driver</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Vehicle</th>
                <th className="px-4 py-2">Note</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {ambulances.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-slate-500">
                    No pending ambulances.
                  </td>
                </tr>
              )}
              {ambulances.map((a) => (
                <tr key={a.ambulance_id} className="bg-white/50 dark:bg-slate-950/40">
                  <td className="px-4 py-2 font-mono text-teal-700 dark:text-teal-300">{a.ambulance_id}</td>
                  <td className="px-4 py-2 text-slate-900 dark:text-white">{a.driver_name}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{a.email}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{a.contact_phone ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{a.ambulance_type}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{a.vehicle_number}</td>
                  <td className="px-4 py-2">
                    <input
                      className="w-40 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                      placeholder="Admin note"
                      value={noteA[a.ambulance_id] ?? ""}
                      onChange={(e) =>
                        setNoteA((m) => ({ ...m, [a.ambulance_id]: e.target.value }))
                      }
                    />
                  </td>
                  <td className="space-x-2 px-4 py-2">
                    <button
                      type="button"
                      className="rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600"
                      onClick={() => void verifyAmbulance(a.ambulance_id, "approved")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="rounded bg-red-800 px-2 py-1 text-xs text-white hover:bg-red-700"
                      onClick={() => void verifyAmbulance(a.ambulance_id, "rejected")}
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
