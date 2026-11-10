import { Navigate } from "react-router-dom";
import useAuthStore from "../store/authStore";
import useSessionExpiry from "../hooks/useSessionExpiry";
import { isTokenExpired } from "../lib/tokenExpiry";

/**
 * ProtectedRoute
 * Wraps routes that require authentication.
 * Redirects unauthenticated users to /login, and ends the session as soon as
 * the login token expires.
 */
const ProtectedRoute = ({ children }) => {
  const token = useAuthStore((state) => state.token);

  // Hooks must run on every render, so this comes before the early returns.
  useSessionExpiry();

  if (!token) return <Navigate to="/login" replace />;

  // A stale token left in localStorage from an earlier visit: render nothing
  // while useSessionExpiry clears it and redirects with an explanation.
  if (isTokenExpired(token)) return null;

  return children;
};

export default ProtectedRoute;
