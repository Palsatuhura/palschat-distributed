/**
 * Grey placeholder shapes shown while something loads, so the screen keeps
 * its shape instead of showing a spinner on a blank page.
 */
const Bar = ({ className = "" }) => <div className={`bg-surface-3 rounded-md ${className}`} />;

export const SkeletonRows = ({ count = 5 }) => (
  <div className="animate-pulse space-y-1 py-1" role="status" aria-label="Loading">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="flex items-center gap-3 px-3 py-2.5">
        <div className="w-10 h-10 rounded-full bg-surface-3 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Bar className="h-3 w-1/2" />
          <Bar className="h-3 w-4/5" />
        </div>
      </div>
    ))}
  </div>
);

export const SkeletonMessages = () => (
  <div className="animate-pulse space-y-4 py-2" role="status" aria-label="Loading messages">
    {[["w-1/2", false], ["w-2/5", true], ["w-3/5", false], ["w-1/3", true], ["w-1/2", false]].map(([w, mine], i) => (
      <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <div className={`${w} h-11 rounded-2xl ${mine ? "bg-brand/20" : "bg-surface-3"}`} />
      </div>
    ))}
  </div>
);
