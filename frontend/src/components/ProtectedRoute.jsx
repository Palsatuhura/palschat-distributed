import { Navigate } from "react-router-dom";
import useAuthStore from "../store/authStore";

/**
 * ProtectedRoute
 * Wraps routes that require authentication.
 * Redirects unauthenticated users to /login.
 */
const ProtectedRoute = ({ children }) => {
  const { token } = useAuthStore();
  return token ? children : <Navigate to="/login" replace />;
};

export default ProtectedRoute;
