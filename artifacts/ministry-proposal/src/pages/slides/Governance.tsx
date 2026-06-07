export default function Governance() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.6vh] bg-primary" />

      <div className="absolute inset-0 px-[7vw] pt-[8vh]">
        <p className="font-mono text-primary text-[1.25vw] tracking-[0.3em] uppercase mb-[2.2vh]">
          Governance
        </p>
        <h2 className="font-display font-bold text-[2.5vw] leading-[1.14] tracking-tight max-w-[82vw] text-balance">
          Access is role-scoped and ministry dashboards expose only aggregates
        </h2>

        <ul className="mt-[4.5vh] space-y-[2.6vh] max-w-[82vw]">
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Every role — candidate, employer, institution, ministry, admin — sees only what its mandate allows.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Ministry routes are locked down to aggregate analytics — no access to personal records.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Sessions are secured, permissions enforced server-side, and sensitive data redacted in logs.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Audit logging and soft-delete protect against misuse and accidental loss.
            </span>
          </li>
          <li className="flex items-start gap-[1.6vw]">
            <span className="mt-[1.4vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
            <span className="text-[1.95vw] leading-[1.4] text-text text-pretty">
              Privacy and tenant boundaries are enforced in code, not by policy alone.
            </span>
          </li>
        </ul>
      </div>

      <div className="absolute bottom-[4.5vh] left-[7vw] right-[7vw] flex justify-between items-center">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em] uppercase">
          Jumerra — Ministry Adoption Proposal
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em]">09 / 12</p>
      </div>
    </div>
  );
}
