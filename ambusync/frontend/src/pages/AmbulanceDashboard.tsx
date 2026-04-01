import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { LiveMap, type MapMarker } from "../components/LiveMap";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";

type Req = {
  id?: string;
  status?: string;
  brief_symptoms?: string;
  latitude?: number;
  longitude?: number;
  address_hint?: string;
};

export function AmbulanceDashboard() {
  const { token, profile } = useAuth();
  const ambId = String((profile as { ambulance_id?: string })?.ambulance_id ?? "");
  const [requests, setRequests] = useState<Req[]>([]);
  const [activeCase, setActiveCase] = useState<Req | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [triaging, setTriaging] = useState<Req | null>(null);
  const [streamCase, setStreamCase] = useState<{
    id: string;
    vitals_session_id: string;
  } | null>(null);
  const [vitalsOn, setVitalsOn] = useState(false);
  const [crewPos, setCrewPos] = useState<{ lat: number; lng: number } | null>(null);
  const vitalsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [form, setForm] = useState({
    patient_name: "",
    age: "40",
    sex: "",
    symptoms: "",
    bp_systolic: "120",
    bp_diastolic: "80",
    pulse: "80",
    spo2: "98",
    consciousness: "Alert",
  });

  const pushCrewLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        setCrewPos({ lat, lng });
        try {
          await api.post("/api/ambulances/me/location", { latitude: lat, longitude: lng });
        } catch {
          /* ignore */
        }
      },
      () => {
        /* permission denied */
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  };

  useEffect(() => {
    if (!token) return;
    const socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
    socket.on("connect", () => socket.emit("join_ambulance", { token }));
    socket.on("requests_snapshot", (p: { requests: Req[] }) =>
      setRequests(p.requests ?? [])
    );
    socket.on("new_emergency_request", (r: Req) =>
      setRequests((x) => [r, ...x.filter((y) => y.id !== r.id)])
    );
    return () => {
      socket.disconnect();
    };
  }, [token]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get<{ requests: Req[] }>("/api/emergency-requests", {
          params: { status: "pending" },
        });
        setRequests(data.requests);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    const busy = Boolean(activeCase || triaging);
    if (!token || !busy) {
      if (locTimerRef.current) clearInterval(locTimerRef.current);
      locTimerRef.current = null;
      return;
    }
    pushCrewLocation();
    locTimerRef.current = setInterval(() => pushCrewLocation(), 12000);
    return () => {
      if (locTimerRef.current) clearInterval(locTimerRef.current);
    };
  }, [token, activeCase, triaging]);

  useEffect(() => {
    if (!vitalsOn || !streamCase) {
      if (vitalsTimerRef.current) clearInterval(vitalsTimerRef.current);
      vitalsTimerRef.current = null;
      return;
    }
    const tick = async () => {
      try {
        const { data } = await api.post<{ reading: Record<string, unknown> }>(
          "/api/health/vitals/simulated",
          {},
          { params: { bias: 0 } }
        );
        await api.post("/api/health/vitals", {
          ...data.reading,
          session_id: streamCase.vitals_session_id,
          case_id: streamCase.id,
        });
      } catch {
        /* ignore */
      }
    };
    void tick();
    vitalsTimerRef.current = setInterval(() => void tick(), 4000);
    return () => {
      if (vitalsTimerRef.current) clearInterval(vitalsTimerRef.current);
    };
  }, [vitalsOn, streamCase]);

  const accept = async (id: string) => {
    setMsg(null);
    try {
      await api.post(`/api/emergency-requests/${id}/accept`, { ambulance_id: ambId });
      const picked = requests.find((x) => x.id === id) ?? { id };
      setActiveCase(picked);
      setRequests((r) => r.filter((x) => x.id !== id));
      setMsg(
        `Accepted request ${id}. Complete triage — you stay assigned until the hospital admits the patient.`
      );
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { error?: string } } };
      setMsg(ax.response?.data?.error ?? "Accept failed");
    }
  };

  const submitTriage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!triaging?.id) return;
    setMsg(null);
    try {
      const { data } = await api.post<{
        case: { id?: string; vitals_session_id?: string };
      }>("/api/triage-submit", {
        request_id: triaging.id,
        ambulance_id: ambId,
        ...form,
        age: parseInt(form.age, 10),
        bp_systolic: parseInt(form.bp_systolic, 10),
        bp_diastolic: parseInt(form.bp_diastolic, 10),
        pulse: parseInt(form.pulse, 10),
        spo2: parseInt(form.spo2, 10),
      });
      const cid = data.case?.id ? String(data.case.id) : "";
      const sid = data.case?.vitals_session_id ? String(data.case.vitals_session_id) : "";
      if (cid && sid) {
        setStreamCase({ id: cid, vitals_session_id: sid });
        setVitalsOn(true);
      }
      setMsg(
        "Triage submitted — hospital notified. Stay on assignment until they mark the patient admitted. Optional: demo vitals stream to the hospital below."
      );
      setTriaging(null);
      setActiveCase(null);
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { error?: string } } };
      setMsg(ax.response?.data?.error ?? "Triage failed");
    }
  };

  const openTriage = (r: Req) => {
    setTriaging(r);
    setForm((f) => ({
      ...f,
      symptoms: r.brief_symptoms ?? "",
    }));
  };

  const mapCenter: [number, number] = crewPos
    ? [crewPos.lat, crewPos.lng]
    : activeCase?.latitude != null && activeCase?.longitude != null
      ? [Number(activeCase.latitude), Number(activeCase.longitude)]
      : [22.5726, 88.3639];

  const markers: MapMarker[] = [];
  if (activeCase?.latitude != null && activeCase?.longitude != null) {
    markers.push({
      id: "patient",
      lat: Number(activeCase.latitude),
      lng: Number(activeCase.longitude),
      label: "Patient pickup",
    });
  }
  if (crewPos) {
    markers.push({
      id: "crew",
      lat: crewPos.lat,
      lng: crewPos.lng,
      label: `Ambulance ${ambId}`,
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Ambulance dispatch</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Logged in as <span className="text-teal-700 dark:text-teal-300">{ambId}</span>. Location is
          shared periodically while you have an active pickup or triage. Complete triage to route to
          a hospital; the crew stays busy until the hospital marks the patient{" "}
          <strong className="text-slate-800 dark:text-slate-200">admitted</strong>.
        </p>
      </div>
      {msg && (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {msg}
        </p>
      )}

      <section className="card-panel p-4">
        <h2 className="mb-2 text-lg font-semibold text-teal-700 dark:text-teal-300">Live map</h2>
        <p className="mb-3 text-xs text-slate-500">
          Patient marker (when assigned) and your GPS position. Enable location for real-time
          tracking.
        </p>
        <LiveMap center={mapCenter} zoom={14} markers={markers} />
        <button
          type="button"
          className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200"
          onClick={() => pushCrewLocation()}
        >
          Update my location now
        </button>
      </section>

      {streamCase && (
        <section className="card-panel p-4">
          <h2 className="text-lg font-semibold text-teal-700 dark:text-teal-300">Hospital vitals stream</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Sends simulated vitals to the routed case so the hospital dashboard can plot BP,
            temperature, and HR in real time.
          </p>
          <button
            type="button"
            className={`mt-3 rounded-lg px-4 py-2 text-sm font-medium text-white ${
              vitalsOn ? "bg-amber-600 hover:bg-amber-500" : "bg-teal-700 hover:bg-teal-600"
            }`}
            onClick={() => setVitalsOn((v) => !v)}
          >
            {vitalsOn ? "Stop vitals stream" : "Start vitals stream (demo)"}
          </button>
        </section>
      )}

      {activeCase && (
        <section className="rounded-xl border border-amber-500/50 bg-amber-50 p-4 dark:border-amber-700/50 dark:bg-amber-950/20">
          <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-200">
            Your active assignment
          </h2>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            #{activeCase.id} — {activeCase.brief_symptoms}
          </p>
          <button
            type="button"
            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
            onClick={() => openTriage(activeCase)}
          >
            Open triage form
          </button>
        </section>
      )}

      <section className="card-panel p-4">
        <h2 className="mb-3 text-lg font-semibold text-teal-700 dark:text-teal-300">Pending requests</h2>
        <ul className="space-y-3">
          {requests.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white/60 p-4 dark:border-slate-700/80 dark:bg-slate-950/50 md:flex-row md:items-center md:justify-between"
            >
              <div className="text-sm">
                <div className="font-mono text-teal-700 dark:text-teal-300">#{r.id}</div>
                <div className="text-slate-800 dark:text-slate-200">{r.brief_symptoms}</div>
                <div className="text-xs text-slate-500">
                  {r.latitude}, {r.longitude} {r.address_hint ? `· ${r.address_hint}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void accept(String(r.id))}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Accept
              </button>
            </li>
          ))}
          {requests.length === 0 && (
            <li className="text-sm text-slate-500">No pending requests in queue.</li>
          )}
        </ul>
      </section>

      {triaging && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 md:items-center">
          <form
            onSubmit={submitTriage}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Field triage — #{triaging.id}
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["patient_name", "text"],
                  ["age", "number"],
                  ["sex", "text"],
                  ["symptoms", "text"],
                  ["bp_systolic", "number"],
                  ["bp_diastolic", "number"],
                  ["pulse", "number"],
                  ["spo2", "number"],
                  ["consciousness", "text"],
                ] as const
              ).map(([k, t]) => (
                <label key={k} className="block text-xs sm:col-span-2">
                  <span className="text-slate-600 dark:text-slate-400">{k.replace(/_/g, " ")}</span>
                  {k === "symptoms" ? (
                    <textarea
                      required
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      rows={3}
                      value={form[k]}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [k]: e.target.value }))
                      }
                    />
                  ) : (
                    <input
                      type={t}
                      required={k !== "sex"}
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      value={form[k]}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [k]: e.target.value }))
                      }
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                className="flex-1 rounded-lg bg-teal-600 py-2 text-sm font-semibold text-white dark:bg-teal-700"
              >
                Submit & route to hospital
              </button>
              <button
                type="button"
                onClick={() => setTriaging(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
