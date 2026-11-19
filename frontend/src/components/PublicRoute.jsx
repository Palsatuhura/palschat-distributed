import { Navigate } from "react-router-dom";
import useAuthStore from "../store/authStore";
import { isTokenExpired } from "../lib/tokenExpiry";

/**
 * PublicRoute
 * Wraps pages meant for people who are NOT signed in (login, register).
 * Someone who is already signed in is sent to the chat instead, so opening
 * /login in a new tab never shows the sign-in form to a signed-in user.
 *
 * A token that has already expired does not count as signed in, so the
 * login page still shows (with the "session expired" message).
 */
const PublicRoute = ({ children }) => {
  const token = useAuthStore((state) => state.token);

  if (token && !isTokenExpired(token)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default PublicRoute;
