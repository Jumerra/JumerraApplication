export default function Technology() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute top-0 left-0 right-0 h-[0.6vh] bg-primary" />

      <div className="absolute inset-0 px-[7vw] pt-[8vh]">
        <p className="font-mono text-primary text-[1.25vw] tracking-[0.3em] uppercase mb-[2.2vh]">
          Ministry of Technology
        </p>
        <h2 className="font-display font-bold text-[2.5vw] leading-[1.14] tracking-tight max-w-[80vw] text-balance">
          The Ministry of Technology gains sovereign digital employment infrastructure
        </h2>

        <div className="mt-[5vh] grid grid-cols-[1fr_1fr] gap-[4vw] items-center">
          <ul className="space-y-[2.6vh]">
            <li className="flex items-start gap-[1.4vw]">
              <span className="mt-[1.3vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
              <span className="text-[1.7vw] leading-[1.38] text-text text-pretty">
                A nationally-owned platform for the labour market, not dependence on foreign job boards.
              </span>
            </li>
            <li className="flex items-start gap-[1.4vw]">
              <span className="mt-[1.3vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
              <span className="text-[1.7vw] leading-[1.38] text-text text-pretty">
                A modern, maintainable stack with secure sessions, audit logging, and recoverable data.
              </span>
            </li>
            <li className="flex items-start gap-[1.4vw]">
              <span className="mt-[1.3vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
              <span className="text-[1.7vw] leading-[1.38] text-text text-pretty">
                A single integration point that other agencies and services can build on.
              </span>
            </li>
            <li className="flex items-start gap-[1.4vw]">
              <span className="mt-[1.3vh] h-[0.3vh] w-[1.8vw] shrink-0 bg-primary" />
              <span className="text-[1.7vw] leading-[1.38] text-text text-pretty">
                A flagship example of digital public infrastructure delivering measurable public value.
              </span>
            </li>
          </ul>

          <div className="flex justify-center">
            <svg
              viewBox="0 0 640 540"
              className="w-full h-auto max-h-[56vh]"
              role="img"
              aria-label="Diagram: candidates, employers, and institutions connect through the Jumerra platform to the ministries of Technology, Education, and Labour"
            >
              <line x1="170" y1="92" x2="232" y2="270" stroke="#cbd3cf" strokeWidth="2.5" />
              <line x1="170" y1="270" x2="232" y2="270" stroke="#cbd3cf" strokeWidth="2.5" />
              <line x1="170" y1="448" x2="232" y2="270" stroke="#cbd3cf" strokeWidth="2.5" />
              <line x1="408" y1="270" x2="470" y2="92" stroke="#cbd3cf" strokeWidth="2.5" />
              <line x1="408" y1="270" x2="470" y2="270" stroke="#cbd3cf" strokeWidth="2.5" />
              <line x1="408" y1="270" x2="470" y2="448" stroke="#cbd3cf" strokeWidth="2.5" />

              <g fontFamily="IBM Plex Sans, sans-serif">
                <rect x="20" y="60" width="150" height="64" rx="8" fill="#ffffff" stroke="#d7ddd9" strokeWidth="2" />
                <text x="95" y="98" textAnchor="middle" fontSize="20" fill="#0f172a">Candidates</text>
                <rect x="20" y="238" width="150" height="64" rx="8" fill="#ffffff" stroke="#d7ddd9" strokeWidth="2" />
                <text x="95" y="276" textAnchor="middle" fontSize="20" fill="#0f172a">Employers</text>
                <rect x="20" y="416" width="150" height="64" rx="8" fill="#ffffff" stroke="#d7ddd9" strokeWidth="2" />
                <text x="95" y="454" textAnchor="middle" fontSize="20" fill="#0f172a">Institutions</text>

                <rect x="232" y="222" width="176" height="96" rx="12" fill="#0d9488" />
                <text x="320" y="264" textAnchor="middle" fontSize="23" fontWeight="700" fill="#ffffff">Jumerra</text>
                <text x="320" y="292" textAnchor="middle" fontSize="18" fill="#d7f0eb">Platform</text>

                <rect x="470" y="60" width="150" height="64" rx="8" fill="#e2f1ee" stroke="#0d9488" strokeWidth="2" />
                <text x="545" y="88" textAnchor="middle" fontSize="16" fill="#0f766e">Ministry of</text>
                <text x="545" y="108" textAnchor="middle" fontSize="17" fontWeight="700" fill="#0f766e">Technology</text>
                <rect x="470" y="238" width="150" height="64" rx="8" fill="#e2f1ee" stroke="#0d9488" strokeWidth="2" />
                <text x="545" y="266" textAnchor="middle" fontSize="16" fill="#0f766e">Ministry of</text>
                <text x="545" y="286" textAnchor="middle" fontSize="17" fontWeight="700" fill="#0f766e">Education</text>
                <rect x="470" y="416" width="150" height="64" rx="8" fill="#e2f1ee" stroke="#0d9488" strokeWidth="2" />
                <text x="545" y="444" textAnchor="middle" fontSize="16" fill="#0f766e">Ministry of</text>
                <text x="545" y="464" textAnchor="middle" fontSize="17" fontWeight="700" fill="#0f766e">Labour</text>
              </g>
            </svg>
          </div>
        </div>
      </div>

      <div className="absolute bottom-[4.5vh] left-[7vw] right-[7vw] flex justify-between items-center">
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em] uppercase">
          Jumerra — Ministry Adoption Proposal
        </p>
        <p className="font-mono text-[1.2vw] text-muted tracking-[0.18em]">06 / 12</p>
      </div>
    </div>
  );
}
