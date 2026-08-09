import siteMetadata from '../static/site-metadata'

export function BrandingBar() {
  return (
    <div className="flex items-center gap-2">
      <a
        href="https://github.com/NewDeparture"
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0"
        title="NewDeparture"
      >
        <img src={siteMetadata.logo} alt="avatar" className="w-7 h-7 rounded-full transition-opacity hover:opacity-80" />
      </a>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold">LYX WORKOUT LOG</span>
        <a
          href="https://github.com/NewDeparture/workouts_log"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:underline transition-colors"
        >
          https://github.com/NewDeparture/workouts_log
        </a>
      </div>
    </div>
  )
}
