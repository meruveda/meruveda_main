# @meruveda/shared

This directory contains shared types and utility functions used by \rontend\, \dmin\, and \ackend\.

## Vercel Deployment Note

To speed up deployments and prevent build errors related to workspaces dependencies under Vercel, the compiled output in \dist/\ is committed directly to Git. Vercel builds use the committed \dist\ output and **do not** recompile this package during the installation lifecycle.

## Rebuilding

After modifying any file in \src/\, you must rebuild the package before committing:

\\\ash
# Run from the root directory
npm run build:shared
\\\

Remember to stage and commit both your \src/\ changes and the updated files inside \dist/\.
