export default function Mandates() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.6vh] bg-primary" />

      <div className="absolute inset-0 px-[7vw] pt-[8vh]">
        <p className="font-mono text-primary text-[1.25vw] tracking-[0.3em] uppercase mb-[2.2vh]">
          Structure
        </p>
        <h2 className="font-display font-bold text-[2.5vw] leading-[1.14] tracking-tight max-w-[82vw] text-balance">
          The three ministries share one platform under separate mandates
        </h2>

        <table className="mt-[5vh] w-full border-collapse">
          <thead>
            <tr className="bg-panel">
              <th className="text-left font-display font-bold text-[1.5vw] text-text py-[2.4vh] px-[1.8vw]">
                Ministry
              </th>
              <th className="text-left font-display font-bold text-[1.5vw] text-text py-[2.4vh] px-[1.8vw]">
                Mandate
              </th>
              <th className="text-left font-display font-bold text-[1.5vw] text-text py-[2.4vh] px-[1.8vw]">
                What it gains
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="font-display font-bold text-[1.7vw] text-accent py-[3vh] px-[1.8vw]">
                Technology
              </td>
              <td className="text-[1.6vw] text-text py-[3vh] px-[1.8vw]">
                Owns and governs the platform
              </td>
              <td className="text-[1.6vw] text-text py-[3vh] px-[1.8vw]">
                Integration, security, and continuity
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="font-display font-bold text-[1.7vw] text-accent py-[3vh] px-[1.8vw]">
                Education
              </td>
              <td className="text-[1.6vw] text-text py-[3vh] px-[1.8vw]">
                Supplies and verifies talent
              </td>
              <td className="text-[1.6vw] text-text py-[3vh] px-[1.8vw]">
                Live placement and verification
              </td>
            </tr>
            <tr className="border-b border-border">
              <td className="font-display font-bold text-[1.7vw] text-accent py-[3vh] px-[1.8vw]">
                Labour
              </td>
              <td className="text-[1.6vw] text-text py-[3vh] px-[1.8vw]">
                Reads market intelligence
              </td>
              <td className="text-[1.6vw] text-text py-[3vh] px-[1.8vw]">
                Skills and employment policy insight
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-[5vh] text-[1.7vw] font-semibold text-text">
          Shared data, separate dashboards, no overlap in authority.
        </p>
      </div>

      <div className="absolute bottom-[4.5vh] left-[7vw] right-[7vw] flex justify-between items-center">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em] uppercase">
          Jumerra — Ministry Adoption Proposal
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em]">10 / 12</p>
      </div>
    </div>
  );
}
