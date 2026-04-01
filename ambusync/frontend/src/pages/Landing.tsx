import { Link } from "react-router-dom";

export function Landing() {
  return (
    <div className="space-y-12">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-100 p-8 shadow-xl dark:border-slate-800 dark:from-slate-900 dark:to-slate-950 md:p-12">
        <p className="text-sm font-medium uppercase tracking-widest text-teal-700 dark:text-teal-400">
          Trusted network operations
        </p>
        <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight text-slate-900 dark:text-white md:text-4xl">
          Live health monitoring, AI risk signals, and verified emergency partners — in one control
          plane.
        </h1>
        <p className="mt-4 max-w-2xl text-slate-600 dark:text-slate-400">
          Hospitals and ambulances are onboarded through admin verification. Patients can request help
          instantly with no login — built for speed in emergencies.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            to="/request"
            className="inline-flex items-center justify-center rounded-xl bg-red-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-red-900/20 hover:bg-red-500"
          >
            Request ambulance — no login
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-6 py-3 font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Staff login
          </Link>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        {[
          {
            t: "Verified hospitals",
            d: "Only approved providers receive routed cases and live vitals streams.",
          },
          {
            t: "Verified ambulances",
            d: "Documented crews with BLS/ALS classification — inactive until admin approval.",
          },
          {
            t: "AI-assisted vitals",
            d: "Threshold alerts plus sklearn anomaly scoring for rapid escalation cues.",
          },
        ].map((x) => (
          <div
            key={x.t}
            className="rounded-xl border border-slate-200 bg-white/80 p-6 backdrop-blur dark:border-slate-800 dark:bg-slate-900/50"
          >
            <h3 className="text-lg font-semibold text-teal-700 dark:text-teal-300">{x.t}</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{x.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
