import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

type VitalRow = {
  idx: number;
  t?: string;
  heart_rate: number;
  bp_systolic: number;
  bp_diastolic: number;
  temperature_c: number;
  glucose_mg_dl: number;
  ml_abnormal?: boolean;
  alerts?: string[];
};

type CaseRow = Record<string, unknown> & {
  id?: string;
  patient_name?: string;
  admission_status?: string;
  vitals_session_id?: string;
  hospital_id?: string;
};

type Reading = Record<string, unknown>;

export function HospitalDashboard() {
  const { token } = useAuth();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [vitals, setVitals] = useState<VitalRow[]>([]);
  const [latest, setLatest] = useState<Record<string, unknown> | null>(null);
  const [sessionId, setSessionId] = useState(
    () => localStorage.getItem("ambusync_vitals_session") ?? ""
  );
  const [demoOn, setDemoOn] = useState(false);
  const idxRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const selectedCaseIdRef = useRef<string | null>(null);
  const [caseChart, setCaseChart] = useState<VitalRow[]>([]);
  const caseIdxRef = useRef(0);

  useEffect(() => {
    selectedCaseIdRef.current = selectedCaseId;
  }, [selectedCaseId]);

  const loadCaseHistory = useCallback(async (cid: string) => {
    try {
      const { data } = await api.get<{ readings: Reading[] }>("/api/health/vitals/history", {
        params: { case_id: cid },
      });
      caseIdxRef.current = 0;
      const rows: VitalRow[] = (data.readings ?? []).map((r, i) => {
        caseIdxRef.current = i + 1;
        return {
          idx: i + 1,
          t: typeof r.timestamp === "string" ? r.timestamp : undefined,
          heart_rate: Number(r.heart_rate ?? 0),
          bp_systolic: Number(r.bp_systolic ?? 0),
          bp_diastolic: Number(r.bp_diastolic ?? 0),
          temperature_c: Number(r.temperature_c ?? 0),
          glucose_mg_dl: Number(r.glucose_mg_dl ?? 0),
          ml_abnormal: Boolean(r.ml_abnormal),
          alerts: (r.alerts as string[]) ?? [],
        };
      });
      setCaseChart(rows);
    } catch {
      setCaseChart([]);
    }
  }, []);

  useEffect(() => {
    if (!selectedCaseId) {
      setCaseChart([]);
      return;
    }
    void loadCaseHistory(selectedCaseId);
    const t = setInterval(() => void loadCaseHistory(selectedCaseId), 5000);
    return () => clearInterval(t);
  }, [selectedCaseId, loadCaseHistory]);

  useEffect(() => {
    if (!token) return;
    const socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
    socket.on("connect", () => {
      socket.emit("join_hospital", { token });
    });
    socket.on("cases_snapshot", (p: { cases: CaseRow[] }) => {
      setCases(p.cases ?? []);
    });
    socket.on("hospital_notified", (p: { case: CaseRow }) => {
      if (p?.case) {
        setCases((c) => {
          const id = String(p.case.id ?? "");
          return [p.case, ...c.filter((x) => String(x.id) !== id)];
        });
      }
    });
    socket.on("case_admitted", (p: { case: CaseRow }) => {
      if (p?.case?.id) {
        setCases((c) =>
          c.map((x) => (String(x.id) === String(p.case.id) ? { ...x, ...p.case } : x))
        );
      }
    });
    socket.on("vitals_update", (reading: Record<string, unknown>) => {
      const cid = (reading.case_id as string) || "";
      if (cid && cid === selectedCaseIdRef.current) {
        caseIdxRef.current += 1;
        const row: VitalRow = {
          idx: caseIdxRef.current,
          t: typeof reading.timestamp === "string" ? reading.timestamp : undefined,
          heart_rate: Number(reading.heart_rate ?? 0),
          bp_systolic: Number(reading.bp_systolic ?? 0),
          bp_diastolic: Number(reading.bp_diastolic ?? 0),
          temperature_c: Number(reading.temperature_c ?? 0),
          glucose_mg_dl: Number(reading.glucose_mg_dl ?? 0),
          ml_abnormal: Boolean(reading.ml_abnormal),
          alerts: (reading.alerts as string[]) ?? [],
        };
        setCaseChart((v) => [...v.slice(-120), row]);
      }

      idxRef.current += 1;
      const row: VitalRow = {
        idx: idxRef.current,
        heart_rate: Number(reading.heart_rate ?? 0),
        bp_systolic: Number(reading.bp_systolic ?? 0),
        bp_diastolic: Number(reading.bp_diastolic ?? 0),
        temperature_c: Number(reading.temperature_c ?? 0),
        glucose_mg_dl: Number(reading.glucose_mg_dl ?? 0),
        ml_abnormal: Boolean(reading.ml_abnormal),
        alerts: (reading.alerts as string[]) ?? [],
      };
      setLatest(reading);
      setVitals((v) => [...v.slice(-80), row]);
    });
    socket.on("error", (e: { message?: string }) => {
      console.warn("socket error", e);
    });
    return () => {
      socket.disconnect();
    };
  }, [token]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<{ cases: CaseRow[] }>("/api/cases");
        setCases(data.cases);
      } catch {
        /* require verified hospital */
      }
    })();
  }, []);

  const persistSession = (sid: string) => {
    localStorage.setItem("ambusync_vitals_session", sid);
    setSessionId(sid);
  };

  const pushSimulatedVital = async () => {
    let sid = sessionId;
    if (!sid) {
      sid = crypto.randomUUID?.() ?? `sess-${Date.now()}`;
      persistSession(sid);
    }
    const { data } = await api.post<{ reading: Record<string, unknown> }>(
      "/api/health/vitals/simulated",
      {},
      { params: { bias: 0 } }
    );
    await api.post("/api/health/vitals", {
      ...data.reading,
      session_id: sid,
    });
  };

  useEffect(() => {
    if (!demoOn) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    void pushSimulatedVital();
    timerRef.current = setInterval(() => {
      void pushSimulatedVital();
    }, 3000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- demo toggle only
  }, [demoOn]);

  const downloadPdf = async () => {
    if (!sessionId) {
      alert("Start demo stream or ingest vitals first to create a session.");
      return;
    }
    const { data } = await api.get("/api/health/report.pdf", {
      params: { session_id: sessionId },
      responseType: "blob",
    });
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ambusync-report.pdf";
    a.click();
    URL.revokeObjectURL(url);
  };

  const admit = async (caseId: string) => {
    await api.post(`/api/cases/${caseId}/admit`);
    setCases((c) =>
      c.map((x) =>
        String(x.id) === caseId ? { ...x, admission_status: "admitted" } : x
      )
    );
  };

  const abnormalFlash = useMemo(
    () => latest?.ml_abnormal || (latest?.alerts as string[] | undefined)?.length,
    [latest]
  );

  const upcoming = useMemo(() => {
    const inc = cases.filter((c) => (c.admission_status ?? "incoming") !== "admitted");
    const done = cases.filter((c) => (c.admission_status ?? "") === "admitted");
    return { inc, done };
  }, [cases]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Hospital command center
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Routed cases for your facility, live vitals, and admission handoff. Mark{" "}
            <strong className="text-slate-800 dark:text-slate-200">Admitted</strong> when the patient
            is received — this releases the ambulance for the next call.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const s = crypto.randomUUID?.() ?? `sess-${Date.now()}`;
              persistSession(s);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            New vitals session ID
          </button>
          <button
            type="button"
            onClick={() => setDemoOn((x) => !x)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              demoOn
                ? "bg-amber-600 text-white"
                : "bg-teal-700 text-white hover:bg-teal-600 dark:bg-teal-800"
            }`}
          >
            {demoOn ? "Stop demo vitals" : "Start demo vitals (3s)"}
          </button>
          <button
            type="button"
            onClick={() => void downloadPdf()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-slate-500 dark:text-slate-200"
          >
            Download PDF report
          </button>
        </div>
      </div>

      {abnormalFlash ? (
        <div className="rounded-xl border border-amber-500/50 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-600/50 dark:bg-amber-950/40 dark:text-amber-100">
          <strong>Alert:</strong> Latest sample flagged abnormal rules or ML anomaly.
          {((latest?.alerts as string[]) ?? []).map((a) => (
            <div key={a} className="text-sm">
              • {a}
            </div>
          ))}
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="card-panel p-4 lg:col-span-2">
          <h2 className="mb-3 text-lg font-semibold text-teal-700 dark:text-teal-300">
            Live vitals (demo stream)
          </h2>
          <div className="h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={vitals}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" className="dark:opacity-40" />
                <XAxis dataKey="idx" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "var(--tw-ring-offset-color, #f8fafc)",
                    border: "1px solid #cbd5e1",
                  }}
                  wrapperClassName="dark:!bg-slate-900 dark:!border-slate-600 dark:!text-slate-100"
                />
                <Legend />
                <Line type="monotone" dataKey="heart_rate" stroke="#db2777" dot={false} name="HR" />
                <Line
                  type="monotone"
                  dataKey="bp_systolic"
                  stroke="#0284c7"
                  dot={false}
                  name="BP sys"
                />
                <Line
                  type="monotone"
                  dataKey="temperature_c"
                  stroke="#65a30d"
                  dot={false}
                  name="Temp °C"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card-panel space-y-3 p-4">
          <h2 className="text-lg font-semibold text-teal-700 dark:text-teal-300">Current values</h2>
          {latest ? (
            <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
              <li>Heart rate: {String(latest.heart_rate)} bpm</li>
              <li>
                BP: {String(latest.bp_systolic)}/{String(latest.bp_diastolic)}
              </li>
              <li>Temp: {String(latest.temperature_c)} °C</li>
              <li>Glucose: {String(latest.glucose_mg_dl)} mg/dL</li>
              <li>ML abnormal: {String(latest.ml_abnormal)}</li>
              <li className="break-all text-xs text-slate-500">
                Session: {sessionId || "auto on first demo tick"}
              </li>
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Waiting for vitals…</p>
          )}
        </div>
      </section>

      {selectedCaseId && (
        <section className="card-panel p-4">
          <h2 className="mb-3 text-lg font-semibold text-teal-700 dark:text-teal-300">
            Patient vitals (case #{selectedCaseId.slice(-8)})
          </h2>
          {caseChart.length === 0 ? (
            <p className="text-sm text-slate-500">
              No readings yet — ask the crew to start the vitals stream after triage, or wait for the
              next sample.
            </p>
          ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={caseChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" />
                  <XAxis dataKey="idx" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={10} />
                  <Tooltip />
                  <Line type="monotone" dataKey="bp_systolic" stroke="#0284c7" dot={false} name="Sys" />
                  <Line
                    type="monotone"
                    dataKey="bp_diastolic"
                    stroke="#7c3aed"
                    dot={false}
                    name="Dia"
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-1 text-center text-xs text-slate-500">Blood pressure</p>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={caseChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" />
                  <XAxis dataKey="idx" stroke="#64748b" fontSize={10} />
                  <YAxis stroke="#64748b" fontSize={10} />
                  <Tooltip />
                  <Line type="monotone" dataKey="heart_rate" stroke="#db2777" dot={false} name="HR" />
                  <Line
                    type="monotone"
                    dataKey="temperature_c"
                    stroke="#65a30d"
                    dot={false}
                    name="Temp"
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-1 text-center text-xs text-slate-500">Heart rate & temperature</p>
            </div>
          </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-teal-700 dark:text-teal-300">
          Upcoming patients
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
            <thead className="bg-slate-100/80 text-slate-600 dark:bg-slate-900/80 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Patient</th>
                <th className="px-3 py-2">Urgency</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Summary</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {upcoming.inc.map((c) => (
                <tr key={String(c.id)} className="bg-white/50 dark:bg-slate-950/40">
                  <td className="px-3 py-2 text-slate-900 dark:text-white">
                    {String(c.patient_name ?? "")}
                  </td>
                  <td className="px-3 py-2 text-amber-700 dark:text-amber-300">
                    {String(c.urgency ?? "")}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {String(c.admission_status ?? "incoming")}
                  </td>
                  <td className="max-w-md truncate px-3 py-2 text-slate-600 dark:text-slate-400">
                    {String(c.summary ?? "")}
                  </td>
                  <td className="space-x-2 px-3 py-2">
                    <button
                      type="button"
                      className="rounded bg-teal-700 px-2 py-1 text-xs text-white hover:bg-teal-600"
                      onClick={() => setSelectedCaseId(String(c.id))}
                    >
                      Charts
                    </button>
                    <button
                      type="button"
                      className="rounded bg-emerald-700 px-2 py-1 text-xs text-white hover:bg-emerald-600"
                      onClick={() => void admit(String(c.id))}
                    >
                      Mark admitted
                    </button>
                  </td>
                </tr>
              ))}
              {upcoming.inc.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-slate-500">
                    No incoming patients. Waiting for routed cases from ambulances.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-teal-700 dark:text-teal-300">
          Admitted (recent)
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-800">
            <thead className="bg-slate-100/80 text-slate-600 dark:bg-slate-900/80 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Patient</th>
                <th className="px-3 py-2">Urgency</th>
                <th className="px-3 py-2">Summary</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.done.slice(0, 15).map((c) => (
                <tr key={String(c.id)} className="bg-white/50 dark:bg-slate-950/40">
                  <td className="px-3 py-2 text-slate-900 dark:text-white">
                    {String(c.patient_name ?? "")}
                  </td>
                  <td className="px-3 py-2 text-amber-700 dark:text-amber-300">
                    {String(c.urgency ?? "")}
                  </td>
                  <td className="max-w-md truncate px-3 py-2 text-slate-600 dark:text-slate-400">
                    {String(c.summary ?? "")}
                  </td>
                </tr>
              ))}
              {upcoming.done.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-slate-500">
                    No admitted records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
