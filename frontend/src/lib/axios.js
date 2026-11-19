import axios from "axios";
import useAuthStore from "../store/authStore";
import { endSession } from "./session";
import { isSessionProblemCode } from "./sessionNotice";

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

    // Requests that handle a 401 themselves (the logout call) opt out.
    //
    // Only a 401 that carries one of the server's session codes means "your
    // login is no longer good". A 401 without a code is something else, for
    // example a wrong CURRENT PASSWORD when changing the password, and must
    // not sign the user out.
    const code = error.response?.data?.code;
    const isSessionProblem = isSessionProblemCode(code);

    if (
      error.response?.status === 401 &&
      isSessionProblem &&
      !isAuthRequest &&
      !error.config?.skipAuthRedirect
    ) {
      // Session expired or token invalid: clear auth state and go to login,
      // telling the user which of the two it was.
      endSession(
        code === "TOKEN_EXPIRED" ? "expired" : code === "SESSION_ENDED" ? "ended" : "invalid"
      );
    }
    return Promise.reject(error);
  }
);

export default api;
