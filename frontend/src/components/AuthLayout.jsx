import ThemeToggle from "./ThemeToggle";

const FEATURES = [
  ["Real-time delivery", "Messages, typing and read receipts arrive instantly."],
  ["You control your sessions", "See every device signed in and end any of them."],
  ["Built to stay online", "Runs on several servers so one failure does not stop the chat."],
];

/**
 * AuthLayout
 * The frame around the sign-in and register forms: a brand panel on wide
 * screens and the form card on the right. Works in light and dark mode.
 */
const AuthLayout = ({ title, subtitle, children, footer }) => (
  <div className="min-h-screen bg-canvas flex">
    {/* Brand panel (wide screens only) */}
    <aside className="hidden lg:flex lg:w-[44%] xl:w-[40%] relative overflow-hidden bg-brand text-white flex-col justify-between p-12">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 15%, rgba(255,255,255,.35), transparent 40%), radial-gradient(circle at 85% 85%, rgba(0,0,0,.35), transparent 45%)",
        }}
      />
      <div className="relative flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </span>
        <span className="text-xl font-semibold tracking-tight">PalsChat</span>
      </div>

      <div className="relative">
        <h2 className="text-4xl font-bold leading-tight tracking-tight">
          Private, fast messaging for your team.
        </h2>
        <ul className="mt-8 space-y-5">
          {FEATURES.map(([head, body]) => (
            <li key={head} className="flex gap-3">
              <span className="mt-1 w-5 h-5 rounded-full bg-white/25 flex items-center justify-center flex-shrink-0">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <span>
                <span className="block font-semibold">{head}</span>
                <span className="block text-sm text-white/80">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-sm text-white/70">Encrypted in transit (HTTPS and secure WebSockets).</p>
    </aside>

    {/* Form side */}
    <main className="flex-1 flex flex-col">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>
      <div className="flex-1 flex items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">
          {/* Small-screen brand */}
          <div className="lg:hidden flex items-center justify-center gap-2 mb-6">
            <span className="w-10 h-10 rounded-xl bg-brand text-white flex items-center justify-center shadow-soft">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </span>
            <span className="text-xl font-semibold text-ink tracking-tight">PalsChat</span>
          </div>

          <h1 className="text-3xl font-bold text-ink tracking-tight">{title}</h1>
          <p className="text-ink-3 mt-1 mb-6">{subtitle}</p>

          <div className="bg-surface border border-line rounded-2xl shadow-soft p-6 sm:p-8">{children}</div>

          {footer && <p className="text-center text-sm text-ink-3 mt-6">{footer}</p>}
        </div>
      </div>
    </main>
  </div>
);

export default AuthLayout;
