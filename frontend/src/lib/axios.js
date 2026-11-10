import axios from "axios";
import useAuthStore from "../store/authStore";
import { endSession } from "./session";

/**
 * Axios instance pre-configured with the backend API base URL.
 * An interceptor automatically attaches the JWT Bearer token
 * from the auth store to every outgoing request.
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor: inject JWT token into Authorization header
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle 401 (token expired/invalid)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // A 401 from the login or register endpoints means "wrong credentials",
    // not "your session expired". Redirecting there would reload the page and
    // erase the error message before the user could read it.
    const isAuthRequest = /\/auth\/(login|register)$/.test(error.config?.url || "");

    if (error.response?.status === 401 && !isAuthRequest) {
      // Session expired or token invalid: clear auth state and go to login,
      // telling the user which of the two it was.
      endSession(error.response.data?.code === "TOKEN_EXPIRED" ? "expired" : "invalid");
    }
    return Promise.reject(error);
  }
);

export default api;
