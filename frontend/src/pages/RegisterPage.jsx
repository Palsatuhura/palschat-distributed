import GenderPicker from "../components/GenderPicker";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../lib/axios";
import useAuthStore from "../store/authStore";
import AuthLayout from "../components/AuthLayout";
import PasswordInput from "../components/PasswordInput";

/**
 * RegisterPage
 * Handles new user registration with name, email, and password.
 * Password confirmation is validated client-side.
 * On success: stores JWT and navigates to chat.
 */
const RegisterPage = () => {
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    gender: "",
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Client-side validation
    if (!formData.name || !formData.email || !formData.password || !formData.confirmPassword) {
      return setError("Please fill in all fields");
    }
    if (!formData.gender) {
      return setError("Please choose male, female or prefer not to say");
    }
    if (formData.name.length < 2) {
      return setError("Name must be at least 2 characters");
    }
    if (formData.password.length < 8) {
      return setError("Password must be at least 8 characters");
    }
    if (formData.password !== formData.confirmPassword) {
      return setError("Passwords do not match");
    }

    try {
      setIsLoading(true);
      const { data } = await api.post("/auth/register", {
        name: formData.name,
        email: formData.email,
        gender: formData.gender,
        password: formData.password,
      });
      login(data.user, data.token);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.message || "Registration failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join PalsChat and start messaging"
      footer={<>Already have an account?{" "}
        <Link to="/login" className="text-brand-text hover:underline font-medium">
          Sign in
        </Link></>}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div role="alert" className="bg-danger-soft border border-danger-line text-danger-text px-4 py-3 rounded-xl text-sm">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-ink-2 mb-1">
                Full name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Jane Doe"
                className="w-full px-4 py-2.5 border border-line-strong rounded-xl text-ink placeholder-ink-4
                           focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
              />
            </div>
            <div>
              <span className="block text-sm font-medium text-ink-2 mb-1">Gender</span>
              <GenderPicker
                value={formData.gender}
                onChange={(gender) => {
                  setFormData((prev) => ({ ...prev, gender }));
                  setError("");
                }}
              />
              <p className="text-xs text-ink-4 mt-1">Used only to choose your default profile picture.</p>
            </div>
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
                autoComplete="new-password"
                value={formData.password}
                onChange={handleChange}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-ink-2 mb-1">
                Confirm password
              </label>
              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                autoComplete="new-password"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="Repeat your password"
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
                  Creating account...
                </span>
              ) : (
                "Create account"
              )}
            </button>
      </form>
    </AuthLayout>
  );
};

export default RegisterPage;
