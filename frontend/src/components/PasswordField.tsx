import { useId, useState } from "react";

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  className?: string;
};

export function PasswordField({
  label,
  value,
  onChange,
  required,
  autoComplete = "current-password",
  className = "",
}: Props) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <label className={`block text-sm ${className}`}>
      <span className="text-slate-600 dark:text-slate-400">{label}</span>
      <div className="relative mt-1">
        <input
          id={id}
          type={show ? "text" : "password"}
          required={required}
          autoComplete={autoComplete}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-24 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          onClick={() => setShow((s) => !s)}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}
