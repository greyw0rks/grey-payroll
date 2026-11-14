import { Arrow, Brand, internalLink, type PageNavigation } from './Landing';

const pages = {
  privacy: {
    title: 'Your data, clearly explained.',
    sections: [
      ['What GreyFinance stores', 'Your Nostr public key identifies your account. The service stores company names, team memberships and roles, spending policies, expense details, Lightning invoices, payment proofs, and workspace audit records. It does not ask for a wallet seed phrase or identity document.'],
      ['Your wallet connection', 'A delegated Nostr Wallet Connect connection is encrypted on the server. It is used only for wallet operations permitted by your connection and the application controls. It stays stored until you disconnect the wallet or delete the company. Your wallet provider controls its own data and permission settings.'],
      ['Sessions and your browser', 'Sign-in uses a signed Nostr request and an HttpOnly, secure application cookie. Sessions last up to twelve hours. The database stores a hash of the session token. Temporary Nostr keys exist only in tab memory; they are not stored in localStorage or sessionStorage. This service uses no advertising trackers or third-party marketing analytics.'],
      ['Hosting and retention', 'The public application is hosted on Vercel and its durable backend runs on Convex. These providers process application and connection data under their own policies. Company financial records remain until the owner deletes the workspace or the deployment operator removes them. Your identity, active sessions, and personal wallet payment history remain after company deletion. Deletion is blocked while a payment result is in progress or uncertain.'],
      ['Your controls', 'You can export your company ledger, disconnect the delegated wallet connection, remove team access, sign out, and delete your company from Settings. Deleting a company removes its records and disconnects the application wallet; it does not delete the Nostr identity, move wallet funds, or erase a record held by the wallet provider. App disconnection does not revoke provider permissions or cancel outstanding invoices. Revoke the delegated connection in your wallet provider when appropriate.'],
      ['Open source and self-hosting', 'The source code and setup instructions are public. A self-hosted deployment is managed by its own operator, who is responsible for retention, access, and hosting configuration. The public demonstration uses builder-controlled test data and private-network sats with no monetary value.'],
    ],
  },
  security: {
    title: 'Clear controls. Checkable payments.',
    sections: [
      ['Identity and access', 'Nostr sign-in verifies the exact signed request, its timestamp, and its payload. Used signatures cannot create another session. Owners, finance reviewers, employees, and viewers have separate server-enforced permissions. Company data is checked against membership on every protected operation.'],
      ['Independent spending decisions', 'A requester cannot approve or pay their own expense. Company and employee budgets are reserved atomically before payment. The server checks a separate per-payment ceiling. Each identity can own one company and join others; older ambiguous treasury bindings are blocked.'],
      ['Restricted wallet access', 'Delegated NWC credentials are encrypted at rest and are never sent to employees or finance reviewers. Only configured secure relays are allowed. Set the smallest useful permissions and a spending budget in your wallet provider. Application approvals are not cryptographic multisignature and do not prevent an authorized server operator from using a delegated spending connection.'],
      ['Settlement and recovery', 'A paid receipt requires a payment preimage matching the invoice payment hash. A payment has one attempt; an uncertain result keeps its budget reservation. Reconciliation uses the original wallet connection. Invoice expiry alone cannot release an in-progress or uncertain payment.'],
      ['Validation and practical limits', 'The project includes authorization, replay, race, spending-policy, expiry, and forged-proof regressions, plus real NWC settlement through LND on a private Bitcoin test network. These are builder validations, not an independent security audit or evidence of mainnet adoption. Routing fees are managed by the wallet provider and are not part of invoice-amount budgets.'],
      ['Report a vulnerability', 'Use the repository’s private security reporting channel for vulnerabilities. Never include a seed phrase, delegated wallet URI, private signing key, session cookie, or customer payment data in a public issue. General bugs and improvement requests belong in the repository issue tracker.'],
    ],
  },
  terms: {
    title: 'A straightforward way to use Grey.',
    sections: [
      ['The service', 'GreyFinance is an open-source company treasury interface for Bitcoin Lightning wallets. It helps organize permissions, expense approvals, payments, and receipts. It does not provide fiat banking, an exchange, escrow, or cryptographic multisignature custody.'],
      ['Your account and company', 'Use a Nostr identity you control and connect only a wallet you are authorized to manage. Company owners are responsible for granting team access and choosing spending policies. A temporary signing identity is intended for trying the product; its key is lost when the tab memory is discarded.'],
      ['Payments', 'Review the invoice, amount, requester, and approver before confirming a payment. Lightning payments can be irreversible. Your wallet provider determines routing and service fees. An uncertain result should be reconciled with the original wallet rather than sent again.'],
      ['Costs and availability', 'The code is free to use under the MIT license. Running a deployment may involve hosting expenses, and wallet providers may charge fees. Availability depends on hosting, Nostr relays, and the connected wallet. The public instance is provided for the project demonstration without a service-level guarantee.'],
      ['License and responsibility', 'The MIT license provides the software as is, without warranty. Keep control of your wallet and signing keys, use appropriate provider-enforced budgets, and assess the software for your company’s needs before wider financial use. The complete license and source are available in the repository.'],
    ],
  },
} as const;

export default function Legal({ page, navigate }: { page: keyof typeof pages; navigate: PageNavigation }) {
  const content = pages[page];
  return <div className="marketing-page"><a className="marketing-skip-link" href="#main-content">Skip to content</a><header className="marketing-header marketing-width"><Brand navigate={navigate} /><a className="marketing-button marketing-button-small marketing-button-dark" href="/app" onClick={event => internalLink(event, navigate, '/app')}>Open workspace <Arrow /></a></header><main id="main-content" className="marketing-legal marketing-width" tabIndex={-1}><p className="marketing-eyebrow">GreyFinance · {page}</p><h1>{content.title}</h1><p className="legal-date">Last updated November 14, 2026</p>{content.sections.map(([title, text]) => <section key={title}><h2>{title}</h2><p>{text}</p></section>)}{page === 'security' && <p><a href="https://github.com/greyw0rks/grey-payroll/security/advisories/new" target="_blank" rel="noopener noreferrer">Report a vulnerability privately</a></p>}<a className="marketing-text-action" href="/" onClick={event => internalLink(event, navigate, '/')}>Back to GreyFinance <Arrow /></a></main><footer className="marketing-footer marketing-width"><Brand navigate={navigate} /><nav aria-label="Footer">{(['security', 'privacy', 'terms'] as const).map(item => <a key={item} href={`/${item}`} onClick={event => internalLink(event, navigate, `/${item}`)}>{item[0].toUpperCase() + item.slice(1)}</a>)}<a href="https://github.com/greyw0rks/grey-payroll" target="_blank" rel="noopener noreferrer">Open source <Arrow /></a></nav></footer></div>;
}
