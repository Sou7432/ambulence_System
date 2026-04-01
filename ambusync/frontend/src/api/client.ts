import axios from "axios";

/**
 * Empty baseURL uses Vite dev proxy (see vite.config.ts).
 * Production: set VITE_API_URL to your Render/Railway backend origin.
 */
const baseURL = import.meta.env.VITE_API_URL ?? "";

export const api = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

// FormData must not use the JSON Content-Type; otherwise Flask gets an empty request.form.
api.interceptors.request.use((config) => {
  if (config.data instanceof FormData && config.headers?.delete) {
    config.headers.delete("Content-Type");
  }
  return config;
});

export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}
