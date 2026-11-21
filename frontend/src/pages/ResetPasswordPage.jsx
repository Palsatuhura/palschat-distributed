import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api from "../lib/axios";
import AuthLayout from "../components/AuthLayout";
import PasswordInput from "../components/PasswordInput";

/** Opened from the emailed link: /reset-password?token=... */
const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8) return setError("Password must be at least 8 characters");
    if (password !== confirm) return setError("The two passwords do not match");
    try {
      setIsLoading(true);
      await api.post("/auth/reset-password", { token, newPassword: password });
      setDone(true);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const footer = (
    <Link to="/login" className="text-brand-text hover:underline font-medium">
      Back to sign in
    </Link>
  );

  if (!token) {
    return (
      <AuthLayout title="Link not valid" subtitle="This page needs the link from your email" footer={footer}>
        <Link to="/forgot-password" className="text-brand-text hover:underline font-medium">
          Ask for a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Pick something you have not used before" footer={footer}>
      {done ? (
        <div role="status" className="bg-success-soft border border-success-line text-success-text px-4 py-3 rounded-xl text-sm">
          Password changed. Taking you to sign in...
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div role="alert" className="bg-danger-soft border border-danger-line text-danger-text px-4 py-3 rounded-xl text-sm">
              {error}{" "}
              {/link/i.test(error) && (
                <Link to="/forgot-password" className="underline font-medium">
                  Get a new link
                </Link>
              )}
            </div>
          )}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-ink-2 mb-1">
              New password
            </label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-ink-2 mb-1">
              Confirm new password
            </label>
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError("");
              }}
              placeholder="Repeat your password"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-brand hover:bg-brand-hover disabled:bg-brand/50 text-white font-semibold
                       py-2.5 px-4 rounded-xl shadow-sm disabled:cursor-not-allowed"
          >
            {isLoading ? "Saving..." : "Change password"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
};

export default ResetPasswordPage;
