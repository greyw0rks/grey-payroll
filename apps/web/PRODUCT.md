# Grey Finance

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Employers administer their own company payroll and staff. Employees access only their employer's company space.

## Product Purpose

Grey gives each company its own payroll dashboard. Both roles see the company name followed by “by Grey”, such as “Labtech by Grey”. Labtech is the user's example, not a claimed customer.

## Operating Context

An employer registers a company, adds an employee and generates an invitation code. The employee redeems that code to join that company. Employers see employee totals, remaining treasury funds, approved leave, daily attendance, outstanding invitations and employee requests. Employees see their own balance, refunds, leave requests and one check-in per company-local calendar day. Leave requests reach the owning employer.

## Capabilities and Constraints

- Use the existing Grey Next.js app, Clerk accounts and Prisma/PostgreSQL database.
- Arc payroll belongs inside the employer dashboard; it is not a separate company platform.
- The user configured Neon PostgreSQL on 2026-10-24 after initially choosing local development. Neon holds the app’s existing tables; the local cluster remains for isolated integration tests.
- Company ownership is checked on the server. Invitation redemption cannot move an existing employee between companies.
- Attendance recording and confirmed payroll settlement are distinct facts.
- Arc payments still require employer wallet signatures and the previously requested actual testnet rehearsal before mainnet.

## Brand Commitments

Keep the Grey name and the existing warm neutral, mint and dark ink identity from the completed Arc redesign.

## Evidence on Hand

The existing database schema models employer membership, employees, attendance, salary releases, refunds, leave and advances. Local validation fixtures must be identified as examples and must not be presented as actual payroll or customer evidence.
