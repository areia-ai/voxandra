# Contributing

Thanks for looking. Voxandra's web app is open in full: the Next.js frontend,
the Convex backend, and the realtime media worker that carries translated calls.

## Pull requests are open

Before anything gets merged, you'll need to sign a contributor license
agreement. [ICLA.md](ICLA.md) covers individuals, and [CCLA.md](CCLA.md) covers
contributing on behalf of an employer. Both are built on the
[ContributorAgreements.org](https://contributoragreements.org/) template.

In short:

- You keep a full right to reuse your own contribution.
- Voxandra gets the right to decide how the project is licensed going forward.
  That includes using contributions in other Voxandra products, such as the
  mobile apps, and offering them under other terms alongside the AGPL.
- Your contribution itself always stays available under the license Voxandra
  is using on the day you submit it. Today that's the AGPL-3.0.

Opening a pull request triggers a bot that asks you to sign by posting a
comment. There's no separate form or account. Signing doesn't mean your PR gets
merged; every pull request is still read and decided on its own merits.

## Where things go

- **Issues** are for bugs and self-hosting trouble.
- **Security** reports go to contact@voxandra.com, not a public issue.
- **Forks** for your own use are the point of the AGPL. Run it, change it, host
  it for other people; the license covers all of that, and if you run a
  modified version as a network service, you must offer its source to your
  users. What it doesn't cover is the Voxandra name and the brand assets in
  `public/brand`, so give your version its own name.

## Before you open a pull request

[AGENTS.md](AGENTS.md) is the working guide for anyone, human or AI agent,
changing this code. It covers the layout, the rules a change must not break,
and the verification steps. Several of its rules are enforced by `npm test`.
Read it first, then run `npm test`, `npm run lint` and `npm run build`.

Local setup is in the [README](README.md#getting-started). Never commit
secrets, real phone numbers, or customer data; use placeholder values in tests
and docs.

## About the agreement

ICLA.md and CCLA.md are a first draft and haven't had a formal legal review. If
something in them needs fixing, open an issue rather than assuming it's
settled.
