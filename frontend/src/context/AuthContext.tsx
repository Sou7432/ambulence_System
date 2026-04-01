import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, setAuthToken } from "../api/client";

type Role = "admin" | "hospital" | "ambulance" | null;

type Profile = Record<string, unknown> | null;

type AuthState = {
  token: string | null;
  role: Role;
  profile: Profile;
  loading: boolean;
  login: (email: string, password: string) => Promise<string>;
  logout: () => void;
};

const Ctx = createContext<AuthState | undefined>(undefined);

const STORAGE_KEY = "ambusync_token";
const PROFILE_KEY = "ambusync_profile";
const ROLE_KEY = "ambusync_role";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY)
  );
  const [role, setRole] = useState<Role>(
    () => (localStorage.getItem(ROLE_KEY) as Role) || null
  );
  const [profile, setProfile] = useState<Profile>(() => {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setAuthToken(token);
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await api.post("/api/auth/login", { email, password });
      const t = data.token as string;
      const r = data.role as string;
      const p = data.profile as Profile;
      localStorage.setItem(STORAGE_KEY, t);
      localStorage.setItem(ROLE_KEY, r ?? "");
      localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
      setToken(t);
      setRole(r as Role);
      setProfile(p);
      setAuthToken(t);
      return (r as string) || "";
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(PROFILE_KEY);
    setToken(null);
    setRole(null);
    setProfile(null);
    setAuthToken(null);
  }, []);

  const value = useMemo(
    () => ({ token, role, profile, loading, login, logout }),
    [token, role, profile, loading, login, logout]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const x = useContext(Ctx);
  if (!x) throw new Error("useAuth inside provider");
  return x;
}
