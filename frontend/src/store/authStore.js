import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Auth Store (Zustand)
 * Manages the authenticated user's session.
 * Persisted to localStorage so the user stays logged in on page refresh.
 *
 * State:
 *   - user: the logged-in user object (name, email, _id, avatar)
 *   - token: JWT string for API authorization
 *
 * Actions:
 *   - login(user, token): stores credentials after successful auth
 *   - logout(): clears session
 *   - updateUser(updates): partial update for profile changes
 */
const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      token: null,

      /**
       * Called after successful login or register API response.
       * Stores the user object and JWT token.
       */
      login: (user, token) => set({ user, token }),

      /**
       * Clears authentication state.
       * The socket connection is disconnected separately in useSocket hook.
       */
      logout: () => set({ user: null, token: null }),

      /**
       * Allows partial updates to the user object (e.g., avatar change).
       */
      updateUser: (updates) =>
        set((state) => ({ user: { ...state.user, ...updates } })),
    }),
    {
      name: "chat-auth", // localStorage key
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);

export default useAuthStore;
