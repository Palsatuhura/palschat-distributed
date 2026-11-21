import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../lib/axios";
import AuthLayout from "../components/AuthLayout";

/** Asks for an email address and requests a reset link. */
const ForgotPasswordPage = () => {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return setError("Please enter your email address");
    try {
      setIsLoading(true);
      await api.post("/auth/forgot-password", { email });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="We will email you a link to choose a new one"
      footer={
        <Link to="/login" className="text-brand-text hover:underline font-medium">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <div role="status" className="bg-success-soft border border-success-line text-success-text px-4 py-3 rounded-xl text-sm">
          If an account exists for <strong>{email}</strong>, a link is on its way. It works for 30 minutes.
          Check your spam folder if you do not see it.
        </div>
      ) : (
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
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              placeholder="you@example.com"
              className="w-full px-4 py-2.5 border border-line-strong rounded-xl text-ink placeholder-ink-4
                         focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-brand hover:bg-brand-hover disabled:bg-brand/50 text-white font-semibold
                       py-2.5 px-4 rounded-xl shadow-sm disabled:cursor-not-allowed"
          >
            {isLoading ? "Sending..." : "Send reset link"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
};

export default ForgotPasswordPage;
