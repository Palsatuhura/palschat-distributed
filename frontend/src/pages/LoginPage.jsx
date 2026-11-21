import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../lib/axios";
import useAuthStore from "../store/authStore";
import AuthLayout from "../components/AuthLayout";
import PasswordInput from "../components/PasswordInput";
import { getSessionNotice } from "../lib/sessionNotice";

/**
 * LoginPage
 * Handles user authentication with email + password.
 * On success: stores JWT in auth store and navigates to chat.
 * On error: displays server error message inline.
 */
const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuthStore();

  // Set by endSession() when a session ended on its own (/login?reason=expired)
  const [searchParams] = useSearchParams();
  const sessionNotice = getSessionNotice(searchParams.get("reason"));

  const [formData, setFormData] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError(""); // clear error on input change
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Basic client-side validation
    if (!formData.email || !formData.password) {
      return setError("Please fill in all fields");
    }

    try {
      setIsLoading(true);
      const { data } = await api.post("/auth/login", formData);
      login(data.user, data.token);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.message || "Login failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your PalsChat account"
      footer={<>Don&apos;t have an account?{" "}
        <Link to="/register" className="text-brand-text hover:underline font-medium">
          Create one
        </Link></>}
    >
      {sessionNotice && (
        <div
          role="status"
          className="mb-5 bg-warn-soft border border-warn-line text-warn-text px-4 py-3 rounded-xl text-sm"
        >
          {sessionNotice}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div role="alert" className="bg-danger-soft border border-danger-line text-danger-text px-4 py-3 rounded-xl text-sm">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-ink-2 mb-1">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                className="w-full px-4 py-2.5 border border-line-strong rounded-xl text-ink placeholder-ink-4
                           focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-ink-2 mb-1">
                Password
              </label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Your password"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-brand hover:bg-brand-hover disabled:bg-brand/50 text-white font-semibold
                         py-2.5 px-4 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-brand
                         focus:ring-offset-2 focus:ring-offset-surface disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                "Sign in"
              )}
            </button>
      </form>
    </AuthLayout>
  );
};

export default LoginPage;
